import {
  StellarWalletsKit,
  // IStellarWalletsKitSignParams,
} from "@creit.tech/stellar-wallets-kit";

export interface NetworkDetails {
  network: string;
  networkUrl: string;
  networkPassphrase: string;
}

export const MAINNET_DETAILS = {
  network: "MAINNET",
  networkUrl: "https://horizon.stellar.org",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
};

export const signData = async (
  entryXdr: string,
  publicKey: string,
  kit: StellarWalletsKit,
) => {
  const { signedAuthEntry } = await kit.signAuthEntry(entryXdr, {
    address: publicKey,
  });
  return signedAuthEntry;
};

export const signTx = async (
  xdr: string,
  publicKey: string,
  kit: StellarWalletsKit,
) => {
  const { signedTxXdr } = await kit.signTransaction(xdr, {
    address: publicKey,
  });
  return signedTxXdr;
};
