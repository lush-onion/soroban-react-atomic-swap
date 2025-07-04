import {
  Address,
  Contract,
  Memo,
  MemoType,
  Operation,
  scValToNative,
  StrKey,
  rpc,
  TimeoutInfinite,
  Transaction,
  TransactionBuilder,
  xdr,
  scValToBigInt,
  ScInt,
} from "@stellar/stellar-sdk";
import BigNumber from "bignumber.js";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";

import { NetworkDetails, signData } from "./network";
import { ERRORS } from "./error";
import { authorizeEntry } from "./sign-auth-entry";

export const SendTxStatus: {
  [index: string]: rpc.Api.SendTransactionStatus;
} = {
  Pending: "PENDING",
  Duplicate: "DUPLICATE",
  Retry: "TRY_AGAIN_LATER",
  Error: "ERROR",
};

export const BASE_FEE = "10000";

export const RPC_URLS: { [key: string]: string } = {
  MAINNET: "https://mainnet.sorobanrpc.com",
};

// Given a display value for a token and a number of decimals, return the corresponding BigNumber
export const parseTokenAmount = (value: string, decimals: number) => {
  const comps = value.split(".");

  let whole = comps[0];
  let fraction = comps[1];
  if (!whole) {
    whole = "0";
  }
  if (!fraction) {
    fraction = "0";
  }

  // Trim trailing zeros
  while (fraction[fraction.length - 1] === "0") {
    fraction = fraction.substring(0, fraction.length - 1);
  }

  // If decimals is 0, we have an empty string for fraction
  if (fraction === "") {
    fraction = "0";
  }

  // Fully pad the string with zeros to get to value
  while (fraction.length < decimals) {
    fraction += "0";
  }

  const wholeValue = new BigNumber(whole);
  const fractionValue = new BigNumber(fraction);

  return wholeValue.shiftedBy(decimals).plus(fractionValue);
};

export const accountToScVal = (account: string) =>
  new Address(account).toScVal();

export const valueToI128String = (value: xdr.ScVal) =>
  scValToBigInt(value).toString();

// Get a server configfured for a specific network
export const getServer = (networkDetails: NetworkDetails) =>
  new rpc.Server(RPC_URLS[networkDetails.network], {
    allowHttp: networkDetails.networkUrl.startsWith("http://"),
  });

//  Can be used whenever we need to perform a "read-only" operation
//  Used in getTokenSymbol, getTokenName, and getTokenDecimals
export const simulateTx = async <ArgType>(
  tx: Transaction<Memo<MemoType>, Operation[]>,
  server: rpc.Server,
): Promise<ArgType> => {
  const response = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationSuccess(response) && response.result !== undefined) {
    return scValToNative(response.result.retval);
  }

  throw new Error("simulation returned no result");
};

// Get the tokens decimals, decoded as a number
export const getTokenDecimals = async (
  tokenId: string,
  txBuilder: TransactionBuilder,
  server: rpc.Server,
) => {
  const contract = new Contract(tokenId);
  const tx = txBuilder
    .addOperation(contract.call("decimals"))
    .setTimeout(TimeoutInfinite)
    .build();

  const result = await simulateTx<number>(tx, server);
  return result;
};

// Get a TransactionBuilder configured with our public key
export const getTxBuilder = async (
  pubKey: string,
  fee: string,
  server: rpc.Server,
  networkPassphrase: string,
) => {
  const source = await server.getAccount(pubKey);
  return new TransactionBuilder(source, {
    fee,
    networkPassphrase,
  });
};

export const buildSwap = async (
  contractID: string,
  tokenA: {
    id: string;
    amount: string;
    minAmount: string;
  },
  tokenB: {
    id: string;
    amount: string;
    minAmount: string;
  },
  swapperAPubKey: string,
  swapperBPubKey: string,
  memo: string,
  server: rpc.Server,
  txBuilder: TransactionBuilder,
) => {
  const swapContract = new Contract(contractID);
  const contractA = new Contract(tokenA.id);
  const contractB = new Contract(tokenB.id);

  const tx = txBuilder
    .addOperation(
      swapContract.call(
        "swap",
        ...[
          accountToScVal(swapperAPubKey),
          accountToScVal(swapperBPubKey),
          accountToScVal(contractA.contractId()),
          accountToScVal(contractB.contractId()),
          new ScInt(tokenA.amount).toI128(),
          new ScInt(tokenA.minAmount).toI128(),
          new ScInt(tokenB.amount).toI128(),
          new ScInt(tokenB.minAmount).toI128(),
        ],
      ),
    )
    .setTimeout(TimeoutInfinite);

  if (memo.length > 0) {
    tx.addMemo(Memo.text(memo));
  }

  const built = tx.build();
  const sim = (await server.simulateTransaction(
    built,
  )) as rpc.Api.SimulateTransactionSuccessResponse;
  const preparedTransaction = rpc.assembleTransaction(built, sim);

  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(ERRORS.TX_SIM_FAILED);
  }

  return {
    preparedTransaction,
    footprint: sim.transactionData.getFootprint(),
  };
};

// Get the tokens symbol, decoded as a string
export const getTokenSymbol = async (
  tokenId: string,
  txBuilder: TransactionBuilder,
  server: rpc.Server,
) => {
  const contract = new Contract(tokenId);

  const tx = txBuilder
    .addOperation(contract.call("symbol"))
    .setTimeout(TimeoutInfinite)
    .build();

  const result = await simulateTx<string>(tx, server);
  return result;
};

export const buildContractAuth = async (
  authEntries: xdr.SorobanAuthorizationEntry[],
  signerPubKey: string,
  networkPassphrase: string,
  contractID: string,
  server: rpc.Server,
  kit: StellarWalletsKit,
) => {
  const signedAuthEntries = [];

  for (const entry of authEntries) {
    if (
      entry.credentials().switch() !==
      xdr.SorobanCredentialsType.sorobanCredentialsAddress()
    ) {
      signedAuthEntries.push(entry);
    } else {
      const entryAddress = entry.credentials().address().address().accountId();

      if (
        signerPubKey === StrKey.encodeEd25519PublicKey(entryAddress.ed25519())
      ) {
        let expirationLedgerSeq = 0;

        const key = xdr.LedgerKey.contractData(
          new xdr.LedgerKeyContractData({
            contract: new Address(contractID).toScAddress(),
            key: xdr.ScVal.scvLedgerKeyContractInstance(),
            durability: xdr.ContractDataDurability.persistent(),
          }),
        );

        // Fetch the current contract ledger seq
        // eslint-disable-next-line no-await-in-loop
        const entryRes = await server.getLedgerEntries(key);
        if (entryRes.entries && entryRes.entries.length) {
          // set auth entry to expire when contract data expires, but could any number of blocks in the future
          expirationLedgerSeq = entryRes.entries[0].liveUntilLedgerSeq || 0;
        } else {
          throw new Error(ERRORS.CANNOT_FETCH_LEDGER_ENTRY);
        }

        const signingMethod = async (input: Buffer) => {
          // eslint-disable-next-line no-await-in-loop
          const signature = await signData(
            input.toString("base64"),
            signerPubKey,
            kit,
          );
          return Buffer.from(signature, "base64");
        };

        try {
          // eslint-disable-next-line no-await-in-loop
          const authEntry = await authorizeEntry(
            entry,
            signingMethod,
            expirationLedgerSeq,
            networkPassphrase,
          );

          signedAuthEntries.push(authEntry);
        } catch (error) {
          console.log(error);
        }
      } else {
        signedAuthEntries.push(entry);
      }
    }
  }

  return signedAuthEntries;
};

export const signContractAuth = async (
  contractID: string,
  signerPubKey: string,
  tx: Transaction,
  server: rpc.Server,
  networkPassphrase: string,
  kit: StellarWalletsKit,
) => {
  const builder = TransactionBuilder.cloneFrom(tx);

  // Soroban transaction can only have 1 operation
  const rawInvokeHostFunctionOp = tx
    .operations[0] as Operation.InvokeHostFunction;

  const auth = rawInvokeHostFunctionOp.auth ? rawInvokeHostFunctionOp.auth : [];
  const signedAuth = await buildContractAuth(
    auth,
    signerPubKey,
    networkPassphrase,
    contractID,
    server,
    kit,
  );

  builder.clearOperations().addOperation(
    Operation.invokeHostFunction({
      ...rawInvokeHostFunctionOp,
      auth: signedAuth,
    }),
  );

  return builder.build();
};

export const getArgsFromEnvelope = (
  envelopeXdr: string,
  networkPassphrase: string,
) => {
  const txEnvelope = TransactionBuilder.fromXDR(
    envelopeXdr,
    networkPassphrase,
  ) as Transaction<Memo<MemoType>, Operation.InvokeHostFunction[]>;

  // only one op per tx in Soroban
  const op = txEnvelope.operations[0].func;

  if (!op) {
    throw new Error(ERRORS.BAD_ENVELOPE);
  }

  const args = op.invokeContract().args();
  const tokenA = StrKey.encodeContract(args[2].address().contractId());
  const tokenB = StrKey.encodeContract(args[3].address().contractId());

  return {
    addressA: StrKey.encodeEd25519PublicKey(
      args[0].address().accountId().ed25519(),
    ),
    addressB: StrKey.encodeEd25519PublicKey(
      args[1].address().accountId().ed25519(),
    ),
    tokenA,
    tokenB,
    amountA: valueToI128String(args[4]),
    minBForA: valueToI128String(args[5]),
    amountB: valueToI128String(args[6]),
    minAForB: valueToI128String(args[7]),
  };
};

// Build and submits a transaction to the Soroban RPC
// Polls for non-pending state, returns result after status is updated
export const submitTx = async (
  signedXDR: string,
  networkPassphrase: string,
  server: rpc.Server,
) => {
  const tx = TransactionBuilder.fromXDR(signedXDR, networkPassphrase);

  const sendResponse = await server.sendTransaction(tx);

  if (sendResponse.errorResult) {
    throw new Error(ERRORS.UNABLE_TO_SUBMIT_TX);
  }

  if (sendResponse.status === SendTxStatus.Pending) {
    let txResponse = await server.getTransaction(sendResponse.hash);

    // Poll this until the status is not "NOT_FOUND"
    while (txResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      // See if the transaction is complete
      // eslint-disable-next-line no-await-in-loop
      txResponse = await server.getTransaction(sendResponse.hash);
      // Wait a second
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return txResponse.resultXdr.toXDR("base64");
    }

    throw new Error(
      `Unabled to submit transaction, status: ${sendResponse.status}`,
    );
  }
  return null;
};
