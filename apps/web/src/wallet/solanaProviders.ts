import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { NativeTransferRequest, TransferReceipt, WalletAccount, WalletBalance } from "@next/types";
import type { NativeTransferSimulation } from "./providers";
import { parseTokenAmount } from "./providers";

interface SolanaWalletProvider {
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey?: { toBase58(): string } } | void>;
  disconnect(): Promise<void>;
  signAndSendTransaction(transaction: Transaction): Promise<string | { signature: string }>;
  signTransaction?(transaction: VersionedTransaction): Promise<VersionedTransaction>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTokenAccount(value: unknown): {
  mint: string;
  amount: bigint;
  decimals: number;
} {
  if (!isRecord(value) || !isRecord(value.account) || !isRecord(value.account.data)) {
    throw new Error("Solana RPC returned an invalid token account.");
  }
  const data = value.account.data;
  if (!isRecord(data.parsed) || !isRecord(data.parsed.info)) {
    throw new Error("Solana RPC returned an invalid parsed token account.");
  }
  const info = data.parsed.info;
  if (!isRecord(info.tokenAmount)) throw new Error("Solana RPC returned an invalid token amount.");
  const tokenAmount = info.tokenAmount;
  if (
    typeof info.mint !== "string" ||
    typeof tokenAmount.amount !== "string" ||
    !/^(?:0|[1-9]\d{0,19})$/.test(tokenAmount.amount) ||
    typeof tokenAmount.decimals !== "number" ||
    !Number.isInteger(tokenAmount.decimals) ||
    tokenAmount.decimals < 0 ||
    tokenAmount.decimals > 255
  ) throw new Error("Solana RPC returned an invalid token amount.");
  const rawAmount = BigInt(tokenAmount.amount);
  if (rawAmount > 18_446_744_073_709_551_615n) {
    throw new Error("Solana RPC returned an unsupported token amount.");
  }
  try {
    new PublicKey(info.mint);
  } catch {
    throw new Error("Solana RPC returned an invalid token mint.");
  }
  return { mint: info.mint, amount: rawAmount, decimals: tokenAmount.decimals };
}

function formatTokenUnits(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
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

export async function fetchSolanaTokenBalances(account: WalletAccount): Promise<WalletBalance[]> {
  if (account.chain !== "solana") throw new Error("Connect a Solana wallet to read SPL token balances.");
  let owner: PublicKey;
  try {
    owner = new PublicKey(account.address);
  } catch {
    throw new Error("Connected wallet returned an invalid Solana address.");
  }
  const connectedAddress = getSolanaProvider().publicKey?.toBase58();
  if (connectedAddress !== account.address) {
    throw new Error("The connected Solana account changed. Reconnect your wallet before refreshing.");
  }
  const connection = getConnection();
  const tokenPrograms = [
    new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
  ];
  const accounts = await Promise.all(tokenPrograms.map((programId) =>
    connection.getParsedTokenAccountsByOwner(owner, { programId }),
  ));
  if (getSolanaProvider().publicKey?.toBase58() !== account.address) {
    throw new Error("The connected Solana account changed. Reconnect your wallet before refreshing.");
  }
  const balances = new Map<string, { amount: bigint; decimals: number }>();
  for (const response of accounts) {
    for (const accountInfo of response.value) {
      const token = parseTokenAccount(accountInfo);
      if (token.amount === 0n) continue;
      const current = balances.get(token.mint);
      if (current && current.decimals !== token.decimals) {
        throw new Error("Solana RPC returned inconsistent token decimals.");
      }
      balances.set(token.mint, {
        amount: (current?.amount ?? 0n) + token.amount,
        decimals: token.decimals,
      });
    }
  }
  return [...balances.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mint, token]) => ({
      address: account.address,
      chain: "solana",
      asset: `${mint.slice(0, 4)}…${mint.slice(-4)}`,
      amount: formatTokenUnits(token.amount, token.decimals),
      decimals: token.decimals,
      tokenAddress: mint,
      kind: "token",
    }));
}

export async function sendSolanaNativeTransfer(
  account: WalletAccount,
  request: NativeTransferRequest,
): Promise<TransferReceipt> {
  const { provider, transaction } = await prepareSolanaNativeTransfer(account, request);
  if (provider.publicKey?.toBase58() !== account.address) {
    throw new Error("The connected Solana account changed. Reconnect your wallet before sending.");
  }
  const result = await provider.signAndSendTransaction(transaction);
  const transactionId = typeof result === "string" ? result : result.signature;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(transactionId)) {
    throw new Error("Wallet returned an invalid Solana transaction identifier.");
  }
  return { chain: "solana", transactionId, status: "submitted" };
}

export async function simulateSolanaNativeTransfer(
  account: WalletAccount,
  request: NativeTransferRequest,
): Promise<NativeTransferSimulation> {
  const { simulation } = await prepareSolanaNativeTransfer(account, request);
  return simulation;
}

async function prepareSolanaNativeTransfer(
  account: WalletAccount,
  request: NativeTransferRequest,
): Promise<{
  provider: SolanaWalletProvider;
  transaction: Transaction;
  simulation: NativeTransferSimulation;
}> {
  if (account.chain !== "solana" || request.chain !== "solana") {
    throw new Error("Connect a Solana wallet to simulate this transfer.");
  }
  if (request.chainId && request.chainId !== account.chainId) {
    throw new Error("The selected chain does not match the connected wallet.");
  }
  const lamports = parseTokenAmount(request.amount, 9);
  let owner: PublicKey;
  let destination: PublicKey;
  try {
    owner = new PublicKey(account.address);
    destination = new PublicKey(request.to);
  } catch {
    throw new Error("Enter valid source and destination Solana addresses.");
  }
  const provider = getSolanaProvider();
  if (provider.publicKey?.toBase58() !== account.address) {
    throw new Error("The connected Solana account changed. Reconnect your wallet before simulating.");
  }
  const connection = getConnection();
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: destination, lamports }),
  );
  transaction.feePayer = owner;
  transaction.recentBlockhash = blockhash;
  const simulationResult = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  if (simulationResult.value.err !== null) {
    throw new Error("Solana RPC simulation rejected the transfer. No wallet transaction was requested.");
  }
  const [feeResult, balance] = await Promise.all([
    connection.getFeeForMessage(transaction.compileMessage(), "confirmed"),
    connection.getBalance(owner, "confirmed"),
  ]);
  const fee = feeResult.value;
  if (fee === null || !Number.isSafeInteger(fee) || fee < 0 || !Number.isSafeInteger(balance) || balance < 0) {
    throw new Error("Solana RPC returned invalid transfer fee or balance data.");
  }
  const totalDebit = lamports + BigInt(fee);
  if (BigInt(balance) < totalDebit) {
    throw new Error("Insufficient SOL balance for the transfer and estimated network fee.");
  }
  if (provider.publicKey?.toBase58() !== account.address) {
    throw new Error("The connected Solana account changed. Reconnect your wallet before continuing.");
  }
  return {
    provider,
    transaction,
    simulation: {
      chain: "solana",
      asset: "SOL",
      recipient: request.to,
      amount: formatTokenUnits(lamports, 9),
      estimatedFee: formatTokenUnits(BigInt(fee), 9),
      totalEstimatedDebit: formatTokenUnits(totalDebit, 9),
    },
  };
}

export async function signSolanaVersionedTransaction(
  account: WalletAccount,
  encodedTransaction: string,
): Promise<string> {
  const provider = getSolanaProvider();
  const connectedAddress = provider.publicKey?.toBase58();
  if (!connectedAddress || connectedAddress !== account.address) {
    throw new Error("The connected Solana account changed. Reconnect your wallet before signing.");
  }
  if (!provider.signTransaction) {
    throw new Error("This wallet does not support signing versioned Solana transactions.");
  }

  let serialized: Uint8Array;
  try {
    const binary = atob(encodedTransaction);
    serialized = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("Swap provider returned an invalid transaction.");
  }
  if (serialized.length === 0 || serialized.length > 1232) {
    throw new Error("Swap transaction exceeds the Solana packet size limit.");
  }
  const transaction = VersionedTransaction.deserialize(serialized);
  const originalMessage = transaction.message.serialize();
  const signed = await provider.signTransaction(transaction);
  const currentAddress = provider.publicKey?.toBase58();
  if (currentAddress !== account.address) {
    throw new Error("The connected Solana account changed while signing.");
  }
  const signedMessage = signed.message.serialize();
  if (
    originalMessage.length !== signedMessage.length ||
    originalMessage.some((byte, index) => byte !== signedMessage[index])
  ) {
    throw new Error("Wallet changed the quoted swap transaction. Request a fresh order.");
  }
  const signerIndex = signed.message.staticAccountKeys.findIndex(
    (key) => key.toBase58() === account.address,
  );
  const takerSignature = signed.signatures[signerIndex];
  if (
    signerIndex < 0 ||
    signerIndex >= signed.message.header.numRequiredSignatures ||
    !takerSignature ||
    takerSignature.every((byte) => byte === 0)
  ) {
    throw new Error("Wallet did not provide the required taker signature.");
  }
  const signedBytes = signed.serialize();
  if (signedBytes.length > 1232) {
    throw new Error("Signed swap transaction exceeds the Solana packet size limit.");
  }
  let binary = "";
  for (let offset = 0; offset < signedBytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...signedBytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
