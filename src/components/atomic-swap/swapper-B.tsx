import React, { useCallback, useEffect } from "react";
import BigNumber from "bignumber.js";
import {
  Button,
  Heading,
  Select,
  Profile,
  Loader,
  IconButton,
  Icon,
  Card,
} from "@stellar/design-system";
import {
  Transaction,
  TransactionBuilder,
  Memo,
  MemoType,
  Operation,
} from "@stellar/stellar-sdk";
import {
  ISupportedWallet,
  StellarWalletsKit,
} from "@creit.tech/stellar-wallets-kit";
import { useLocation } from "react-router-dom";

import { NetworkDetails } from "../../helpers/network";
import {
  getArgsFromEnvelope,
  getServer,
  getTokenSymbol,
  getTxBuilder,
  signContractAuth,
  BASE_FEE,
} from "../../helpers/soroban";
import { ERRORS } from "../../helpers/error";
import { formatTokenAmount } from "../../helpers/format";
import { copyContent } from "../../helpers/dom";

type StepCount = 1 | 2 | 3;

interface SwapperBProps {
  decimals: number;
  basePath: string;
  networkDetails: NetworkDetails;
  setError: (error: string | null) => void;
  setPubKey: (pubKey: string) => void;
  swkKit: StellarWalletsKit;
  pubKey: string;
}

export const SwapperB = (props: SwapperBProps) => {
  const [signedTx, setSignedTx] = React.useState("");
  const [contractID, setContractID] = React.useState("");
  const [creatorFootprint, setCreatorFootprint] = React.useState("");
  const [swapArgs, setSwapArgs] = React.useState(
    {} as ReturnType<typeof getArgsFromEnvelope>,
  );
  const [tokenASymbol, setTokenASymbol] = React.useState("");
  const [tokenBSymbol, setTokenBSymbol] = React.useState("");
  const [stepCount, setStepCount] = React.useState(1 as StepCount);

  const [urlToShare, setUrlToShare] = React.useState("");

  const location = useLocation();

  const parseData = useCallback(
    async (address: string) => {
      const server = getServer(props.networkDetails);
      const tx = TransactionBuilder.fromXDR(
        signedTx,
        props.networkDetails.networkPassphrase,
      ) as Transaction<Memo<MemoType>, Operation[]>;

      const args = getArgsFromEnvelope(
        tx.toEnvelope().toXDR("base64"),
        props.networkDetails.networkPassphrase,
      );
      const formattedArgs = {
        ...args,
        amountA: formatTokenAmount(new BigNumber(args.amountA), props.decimals),
        amountB: formatTokenAmount(new BigNumber(args.amountB), props.decimals),
        minAForB: formatTokenAmount(
          new BigNumber(args.minAForB),
          props.decimals,
        ),
        minBForA: formatTokenAmount(
          new BigNumber(args.minBForA),
          props.decimals,
        ),
      };
      setSwapArgs(formattedArgs);

      const tokenASymbolBuilder = await getTxBuilder(
        address,
        BASE_FEE,
        server,
        props.networkDetails.networkPassphrase,
      );
      const symbolA = await getTokenSymbol(
        args.tokenA,
        tokenASymbolBuilder,
        server,
      );
      setTokenASymbol(symbolA);

      const tokenBSymbolBuilder = await getTxBuilder(
        address,
        BASE_FEE,
        server,
        props.networkDetails.networkPassphrase,
      );
      const symbolB = await getTokenSymbol(
        args.tokenB,
        tokenBSymbolBuilder,
        server,
      );
      setTokenBSymbol(symbolB);
    },
    [props.decimals, props.networkDetails, signedTx],
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);

    const xdr = params.get("xdr");
    const contractId = params.get("contractId");
    const account = params.get("account");
    const footprint = params.get("creatorFootprint");

    if (!xdr || !contractId || !account || !footprint) {
      console.error("Params not found");
      return;
    }

    setSignedTx(decodeURIComponent(xdr));
    setContractID(contractId);
    setCreatorFootprint(decodeURIComponent(footprint));

    parseData(account);
  }, [location, parseData]);

  const signAuthEntry = async () => {
    props.setError(null);

    const server = getServer(props.networkDetails);
    const tx = TransactionBuilder.fromXDR(
      signedTx,
      props.networkDetails.networkPassphrase,
    ) as Transaction<Memo<MemoType>, Operation[]>;

    const auth = await signContractAuth(
      contractID,
      props.pubKey,
      tx,
      server,
      props.networkDetails.networkPassphrase,
      props.swkKit,
    );
    return auth.toEnvelope().toXDR("base64");
  };

  const connect = () => {
    props.setError(null);

    // See https://github.com/Creit-Tech/Stellar-Wallets-Kit/tree/main for more options
    props.swkKit.openModal({
      onWalletSelected: async (option: ISupportedWallet) => {
        try {
          // Set selected wallet,  network, and public key
          props.swkKit.setWallet(option.id);
          const { address } = await props.swkKit.getAddress();

          props.setPubKey(address);
          setStepCount((stepCount + 1) as StepCount);
        } catch (error) {
          console.log(error);
          props.setError(ERRORS.WALLET_CONNECTION_REJECTED);
        }
      },
    });
  };

  function renderStep(step: StepCount) {
    switch (step) {
      case 3: {
        return (
          <Card>
            <Heading as="h1" size="sm">
              Send this link to Swap Creator
            </Heading>
            <div className="xdr-copy">
              <IconButton
                altText="copy result xdr data"
                icon={<Icon.ContentCopy key="copy-icon" />}
                onClick={() => copyContent(urlToShare)}
              />
              Copy link
            </div>
            <a href={urlToShare} target="_blank" rel="noreferrer">
              Link
            </a>
          </Card>
        );
      }
      case 2: {
        const signWithWallet = async () => {
          try {
            const _signedTx = await signAuthEntry();

            console.log(_signedTx);

            const url = `${props.basePath}?xdr=${encodeURIComponent(
              _signedTx,
            )}&creatorFootprint=${encodeURIComponent(creatorFootprint)}`;

            setUrlToShare(url);
            setStepCount((stepCount + 1) as StepCount);
          } catch (e) {
            console.log("e: ", e);
            props.setError(ERRORS.UNABLE_TO_SIGN_TX);
          }
        };

        return (
          <>
            <Heading as="h1" size="sm">
              Confirm Swap Transaction
            </Heading>
            <div className="tx-details">
              {Object.keys(swapArgs).length > 0 && (
                <>
                  <div className="tx-detail-item">
                    <p className="detail-header">Network</p>
                    <p className="detail-value">
                      {props.networkDetails.network}
                    </p>
                  </div>
                  <div className="tx-detail-item">
                    <p className="detail-header">
                      Your account
                      <br />
                      (Send {tokenBSymbol} → Receive {tokenASymbol})
                    </p>
                    <div className="address-a-identicon">
                      <Profile
                        isShort
                        publicAddress={swapArgs.addressB}
                        size="sm"
                      />
                    </div>
                  </div>
                  <div className="tx-detail-item">
                    <p className="detail-header">
                      Amount <br /> (sent by you)
                    </p>
                    <p className="detail-value">
                      {+swapArgs.amountB / 1e7} {tokenBSymbol}
                    </p>
                  </div>
                  <div className="tx-detail-item">
                    <p className="detail-header">
                      Minimum amount <br /> (Swap creator wants for{" "}
                      {tokenASymbol})
                    </p>
                    <p className="detail-value">
                      {+swapArgs.minBForA / 1e7} {tokenBSymbol}
                    </p>
                  </div>
                  <div className="tx-detail-item">
                    <p className="detail-header">
                      Swap creator <br /> (Send {tokenASymbol} → Receive{" "}
                      {tokenBSymbol})
                    </p>
                    <div className="address-b-identicon">
                      <Profile
                        isShort
                        publicAddress={swapArgs.addressA}
                        size="sm"
                      />
                    </div>
                  </div>
                  <div className="tx-detail-item">
                    <p className="detail-header">
                      Amount <br /> (send by Swap Creator)
                    </p>
                    <p className="detail-value">
                      {+swapArgs.amountA / 1e7} {tokenASymbol}
                    </p>
                  </div>
                  <div className="tx-detail-item">
                    <p className="detail-header">
                      Minimum amount <br /> (You wants for {tokenBSymbol})
                    </p>
                    <p className="detail-value">
                      {+swapArgs.minAForB / 1e7} {tokenASymbol}
                    </p>
                  </div>
                </>
              )}
            </div>
            <div className="submit-row">
              <Button
                size="md"
                variant="tertiary"
                isFullWidth
                onClick={signWithWallet}
              >
                Sign with Wallet
              </Button>
            </div>
          </>
        );
      }
      case 1:
      default: {
        if (!swapArgs.addressA) {
          return <Loader />;
        }
        return (
          <>
            <Heading as="h1" size="sm">
              Connect signer for{" "}
              <Profile publicAddress={swapArgs.addressB} isShort size="md" />
            </Heading>
            <p>
              Now, in your wallet, switch to another address that owns{" "}
              {tokenBSymbol} token.
            </p>
            <Select
              disabled
              fieldSize="md"
              id="selected-network"
              label="Select your Network"
              value={props.networkDetails.network}
            >
              <option>{props.networkDetails.network}</option>
            </Select>
            <div className="submit-row">
              <Button
                size="md"
                variant="tertiary"
                isFullWidth
                onClick={connect}
              >
                Connect Wallet
              </Button>
            </div>
          </>
        );
      }
    }
  }
  return renderStep(stepCount);
};
