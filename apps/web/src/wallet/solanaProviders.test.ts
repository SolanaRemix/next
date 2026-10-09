import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { signSolanaVersionedTransaction } from "./solanaProviders";

const account = Keypair.generate();
const walletAccount = {
  address: account.publicKey.toBase58(),
  chain: "solana" as const,
  chainId: "mainnet-beta",
  connectedAt: new Date().toISOString(),
};
const originalProvider = window.solana;

afterEach(() => {
  if (originalProvider) window.solana = originalProvider;
  else delete window.solana;
});

function makeTransaction(): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: account.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function base64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("signSolanaVersionedTransaction", () => {
  it("signs a versioned transaction without changing the wallet-approved message", async () => {
    const unsigned = makeTransaction();
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
      base64(unsigned.serialize()),
    );
    const signed = VersionedTransaction.deserialize(
      Uint8Array.from(atob(signedBase64), (character) => character.charCodeAt(0)),
    );

    expect(signed.message.serialize()).toEqual(unsigned.message.serialize());
    expect(signed.signatures[0]?.every((byte) => byte === 1)).toBe(true);
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
      signSolanaVersionedTransaction(walletAccount, base64(makeTransaction().serialize())),
    ).rejects.toThrow(/account changed/i);
    expect(signTransaction).not.toHaveBeenCalled();
  });
});
