import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import type { NativeTransferRequest, TransferReceipt, WalletAccount, WalletBalance } from "@next/types";
import { parseTokenAmount } from "./providers";

interface SolanaWalletProvider {
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey?: { toBase58(): string } } | void>;
  disconnect(): Promise<void>;
  signAndSendTransaction(transaction: Transaction): Promise<string | { signature: string }>;
}

declare global {
  interface Window {
    solana?: SolanaWalletProvider;
    solflare?: SolanaWalletProvider;
  }
}

function getSolanaProvider(): SolanaWalletProvider {
  const provider = typeof window === "undefined" ? undefined : (window.solana ?? window.solflare);
  if (!provider) throw new Error("No Solana wallet detected. Install Phantom or Solflare and try again.");
  return provider;
}

function getConnection(): Connection {
  return new Connection(
    import.meta.env.VITE_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
}

export async function connectSolanaWallet(): Promise<WalletAccount> {
  const provider = getSolanaProvider();
  const connected = await provider.connect();
  const publicKey = connected?.publicKey ?? provider.publicKey;
  if (!publicKey) throw new Error("Wallet did not return a Solana account.");
  return {
    address: publicKey.toBase58(),
    chain: "solana",
    chainId: "mainnet-beta",
    connectedAt: new Date().toISOString(),
  };
}

export async function disconnectSolanaWallet(): Promise<void> {
  await getSolanaProvider().disconnect();
}

export async function fetchSolanaNativeBalance(account: WalletAccount): Promise<WalletBalance> {
  const lamports = await getConnection().getBalance(new PublicKey(account.address));
  return {
    address: account.address,
    chain: account.chain,
    asset: "SOL",
    amount: (lamports / LAMPORTS_PER_SOL).toString(),
    decimals: 9,
  };
}

export async function sendSolanaNativeTransfer(
  account: WalletAccount,
  request: NativeTransferRequest,
): Promise<TransferReceipt> {
  let destination: PublicKey;
  try {
    destination = new PublicKey(request.to);
  } catch {
    throw new Error("Enter a valid destination Solana address.");
  }
  const provider = getSolanaProvider();
  const connection = getConnection();
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(account.address),
      toPubkey: destination,
      lamports: parseTokenAmount(request.amount, 9),
    }),
  );
  transaction.feePayer = new PublicKey(account.address);
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const result = await provider.signAndSendTransaction(transaction);
  const transactionId = typeof result === "string" ? result : result.signature;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(transactionId)) {
    throw new Error("Wallet returned an invalid Solana transaction identifier.");
  }
  return { chain: "solana", transactionId, status: "submitted" };
}
