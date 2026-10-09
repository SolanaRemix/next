import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";
import { fetchSolanaTokenBalances, signSolanaVersionedTransaction } from "./solanaProviders";

const account = Keypair.generate();
const walletAccount = {
  address: account.publicKey.toBase58(),
  chain: "solana" as const,
  chainId: "mainnet-beta",
  connectedAt: new Date().toISOString(),
};
const originalProvider = window.solana;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalProvider) window.solana = originalProvider;
  else delete window.solana;
});

function mockTransaction(): VersionedTransaction {
  return {
    message: {
      serialize: () => new Uint8Array([1, 2, 3]),
      staticAccountKeys: [account.publicKey],
      header: { numRequiredSignatures: 1 },
    },
    signatures: [new Uint8Array(64)],
    serialize: () => new Uint8Array([4, 5, 6]),
  } as unknown as VersionedTransaction;
}

function base64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("signSolanaVersionedTransaction", () => {
  it("signs a versioned transaction without changing the wallet-approved message", async () => {
    const unsigned = mockTransaction();
    vi.spyOn(VersionedTransaction, "deserialize").mockReturnValue(unsigned);
    window.solana = {
      publicKey: account.publicKey,
      connect: vi.fn(),
      disconnect: vi.fn(),
      signAndSendTransaction: vi.fn(),
      signTransaction: vi.fn(async (transaction) => {
        transaction.signatures[0] = new Uint8Array(64).fill(1);
        return transaction;
      }),
    };

    const signedBase64 = await signSolanaVersionedTransaction(
      walletAccount,
      "AQ==",
    );

    expect(unsigned.message.serialize()).toEqual(new Uint8Array([1, 2, 3]));
    expect(unsigned.signatures[0]?.every((byte) => byte === 1)).toBe(true);
    expect(signedBase64).toBe(base64(new Uint8Array([4, 5, 6])));
  });

  it("rejects a changed connected account before requesting a signature", async () => {
    const signTransaction = vi.fn();
    window.solana = {
      publicKey: Keypair.generate().publicKey,
      connect: vi.fn(),
      disconnect: vi.fn(),
      signAndSendTransaction: vi.fn(),
      signTransaction,
    };

    await expect(
      signSolanaVersionedTransaction(walletAccount, "AQ=="),
    ).rejects.toThrow(/account changed/i);
    expect(signTransaction).not.toHaveBeenCalled();
  });
});

describe("fetchSolanaTokenBalances", () => {
  it("combines non-zero SPL and Token-2022 accounts by mint using exact integer arithmetic", async () => {
    const mint = Keypair.generate().publicKey.toBase58();
    const secondMint = Keypair.generate().publicKey.toBase58();
    window.solana = {
      publicKey: account.publicKey,
      connect: vi.fn(),
      disconnect: vi.fn(),
      signAndSendTransaction: vi.fn(),
    };
    const request = vi.spyOn(Connection.prototype, "getParsedTokenAccountsByOwner")
      .mockImplementation(async (_owner, filter) => ({
        context: { slot: 1 },
        value: "programId" in filter &&
          filter.programId.toBase58() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          ? [
            { account: { data: { parsed: { info: {
              mint,
              tokenAmount: { amount: "1234567", decimals: 6 },
            } } } } },
            { account: { data: { parsed: { info: {
              mint: secondMint,
              tokenAmount: { amount: "0", decimals: 9 },
            } } } } },
          ]
          : [{ account: { data: { parsed: { info: {
            mint,
            tokenAmount: { amount: "33", decimals: 6 },
          } } } } }],
      }) as never);

    await expect(fetchSolanaTokenBalances(walletAccount)).resolves.toEqual([{
      address: walletAccount.address,
      chain: "solana",
      asset: `${mint.slice(0, 4)}…${mint.slice(-4)}`,
      amount: "1.2346",
      decimals: 6,
      tokenAddress: mint,
      kind: "token",
    }]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects stale connected accounts and malformed token account data", async () => {
    window.solana = {
      publicKey: Keypair.generate().publicKey,
      connect: vi.fn(),
      disconnect: vi.fn(),
      signAndSendTransaction: vi.fn(),
    };
    const request = vi.spyOn(Connection.prototype, "getParsedTokenAccountsByOwner");
    await expect(fetchSolanaTokenBalances(walletAccount)).rejects.toThrow(/account changed/i);
    expect(request).not.toHaveBeenCalled();

    window.solana.publicKey = account.publicKey;
    request.mockImplementation(async () => ({
      context: { slot: 1 },
      value: [{ account: { data: { parsed: { info: {} } } } }],
    }) as never);
    await expect(fetchSolanaTokenBalances(walletAccount)).rejects.toThrow(/invalid token amount/i);
  });
});
