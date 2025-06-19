import React from "react";
import BigNumber from "bignumber.js";
import {
  Memo,
  MemoType,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  Button,
  Heading,
  Select,
  Profile,
  Card,
  IconButton,
  Icon,
  Loader,
} from "@stellar/design-system";
import {
  ISupportedWallet,
  StellarWalletsKit,
} from "@creit.tech/stellar-wallets-kit";

import { bc, ChannelMessageType } from "../../helpers/channel";
import {
  getServer,
  signContractAuth,
  getArgsFromEnvelope,
  getTxBuilder,
  BASE_FEE,
  getTokenSymbol,
} from "../../helpers/soroban";
import { NetworkDetails } from "../../helpers/network";
import { ERRORS } from "../../helpers/error";
import { formatTokenAmount } from "../../helpers/format";
import { copyContent } from "../../helpers/dom";

type StepCount = 1 | 2;

interface SwapperAProps {
  decimals: number;
  basePath: string;
  networkDetails: NetworkDetails;
  setError: (error: string | null) => void;
  setPubKey: (pubKey: string) => void;
  swkKit: StellarWalletsKit;
  pubKey: string;
}

export const SwapperA = (props: SwapperAProps) => {
  const [baseTx, setBaseTx] = React.useState(
    {} as Transaction<Memo<MemoType>, Operation[]>,
  );
  const [contractID, setContractID] = React.useState("");
  const [stepCount, setStepCount] = React.useState(1 as StepCount);
  const [creatorFootprint, setCreatorFootprint] = React.useState("");
  const [swapArgs, setSwapArgs] = React.useState(
    {} as ReturnType<typeof getArgsFromEnvelope>,
  );
  const [tokenASymbol, setTokenASymbol] = React.useState("");
  const [tokenBSymbol, setTokenBSymbol] = React.useState("");

  const [urlToShare, setUrlToShare] = React.useState("");

  const connect = async () => {
    props.setError(null);

    await props.swkKit.openModal({
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

  bc.onmessage = async (messageEvent) => {
    const { data, type } = messageEvent.data;
    switch (type) {
      case ChannelMessageType.ContractID: {
        setContractID(data.contractID);
        const tx = TransactionBuilder.fromXDR(
          data.baseTx,
          props.networkDetails.networkPassphrase,
        ) as Transaction<Memo<MemoType>, Operation[]>;
        setBaseTx(tx);
        setCreatorFootprint(data.creatorFootprint);

        const server = getServer(props.networkDetails);

        const args = getArgsFromEnvelope(
          tx.toEnvelope().toXDR("base64"),
          props.networkDetails.networkPassphrase,
        );
        const formattedArgs = {
          ...args,
          amountA: formatTokenAmount(
            new BigNumber(args.amountA),
            props.decimals,
          ),
          amountB: formatTokenAmount(
            new BigNumber(args.amountB),
            props.decimals,
          ),
          minAForB: formatTokenAmount(
            new BigNumber(args.minAForB),
            props.decimals,
          ),
          minBForA: formatTokenAmount(
            new BigNumber(args.minBForA),
            props.decimals,
          ),
        };
        const tokenASymbolBuilder = await getTxBuilder(
          args.addressA,
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
          args.addressA,
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

        setSwapArgs(formattedArgs);

        return;
      }
      default:
        console.log(`message type unknown, ignoring ${type}`);
    }
  };

  function renderStep(step: StepCount) {
    switch (step) {
      case 2: {
        const signWithWallet = async () => {
          const server = getServer(props.networkDetails);

          try {
            const signedTx = await signContractAuth(
              contractID,
              props.pubKey,
              baseTx,
              server,
              props.networkDetails.networkPassphrase,
              props.swkKit,
            );
            const url = `${props.basePath}/swapper-b?xdr=${encodeURIComponent(
              signedTx.toEnvelope().toXDR("base64"),
            )}&contractId=${contractID}&account=${swapArgs.addressB}&creatorFootprint=${creatorFootprint}`;
            setUrlToShare(url);
          } catch (e) {
            console.log("e: ", e);
            props.setError(ERRORS.UNABLE_TO_SIGN_TX);
          }
        };
        return urlToShare ? (
          <Card>
            <Heading as="h1" size="sm">
              Send this link to Swapper B
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
        ) : (
          <>
            <Heading as="h1" size="sm">
              Confirm Swap Transaction
            </Heading>

            <div className="tx-details">
              <div className="tx-detail-item">
                <p className="detail-header">Network</p>
                <p className="detail-value">{props.networkDetails.network}</p>
              </div>
              <div className="tx-detail-item address-a">
                <p className="detail-header">
                  Your account
                  <br />
                  (Send {tokenASymbol} → Receive {tokenBSymbol})
                </p>
                <div className="address-a-identicon">
                  <Profile
                    isShort
                    publicAddress={swapArgs.addressA}
                    size="sm"
                  />
                </div>
              </div>
              <div className="tx-detail-item">
                <p className="detail-header">
                  Amount <br /> (sent by you)
                </p>
                <p className="detail-value">
                  {+swapArgs.amountA / 1e7} {tokenASymbol}
                </p>
              </div>
              <div className="tx-detail-item">
                <p className="detail-header">
                  Minimum amount <br /> (Account B wants for {tokenBSymbol})
                </p>
                <p className="detail-value">
                  {+swapArgs.minAForB / 1e7} {tokenASymbol}
                </p>
              </div>
              <div className="tx-detail-item address-b">
                <p className="detail-header">
                  Account B <br /> (Send {tokenBSymbol} → Receive {tokenASymbol}
                  )
                </p>
                <div className="address-b-identicon">
                  <Profile
                    isShort
                    publicAddress={swapArgs.addressB}
                    size="sm"
                  />
                </div>
              </div>
              <div className="tx-detail-item">
                <p className="detail-header">
                  Amount <br /> (send by Account B)
                </p>
                <p className="detail-value">
                  {+swapArgs.amountB / 1e7} {tokenBSymbol}
                </p>
              </div>
              <div className="tx-detail-item">
                <p className="detail-header">
                  Minimum amount <br /> (You wants for {tokenASymbol})
                </p>
                <p className="detail-value">
                  {+swapArgs.minBForA / 1e7} {tokenBSymbol}
                </p>
              </div>
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
              <Profile publicAddress={swapArgs.addressA} isShort size="md" />
            </Heading>
            <p>
              When swapping tokens, you generally have two addresses involved.
            </p>
            <p>Connect an address that owns {tokenASymbol} token.</p>
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
