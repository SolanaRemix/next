import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { NativeTransferRequest, TransferReceipt, WalletAccount, WalletBalance } from "@next/types";
import {
  connectEvmWallet,
  connectSolanaWallet,
  disconnectWallet,
  fetchNativeBalance,
  fetchPortfolioBalances,
  sendNativeTransfer,
} from "./providers";

interface WalletContextValue {
  account: WalletAccount | null;
  balance: WalletBalance | null;
  tokenBalances: WalletBalance[];
  busy: boolean;
  error: string | null;
  connect: (chain: WalletAccount["chain"]) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  refreshPortfolio: (tokenAddresses?: readonly string[]) => Promise<void>;
  transfer: (request: NativeTransferRequest) => Promise<TransferReceipt>;
  clearError: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [tokenBalances, setTokenBalances] = useState<WalletBalance[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Wallet request failed.";
      setError(message);
      throw cause instanceof Error ? cause : new Error(message);
    } finally {
      setBusy(false);
    }
  }, []);

  const connect = useCallback(async (chain: WalletAccount["chain"]) => {
    const next = await run(() => chain === "evm" ? connectEvmWallet() : connectSolanaWallet());
    setAccount(next);
    setBalance(null);
    setTokenBalances([]);
  }, [run]);

  const disconnect = useCallback(async () => {
    if (!account) return;
    await run(() => disconnectWallet(account.chain));
    setAccount(null);
    setBalance(null);
    setTokenBalances([]);
  }, [account, run]);

  const refreshBalance = useCallback(async () => {
    if (!account) throw new Error("Connect a wallet before refreshing balances.");
    const nextBalance = await run(() => fetchNativeBalance(account));
    setBalance(nextBalance);
  }, [account, run]);

  const refreshPortfolio = useCallback(async (tokenAddresses: readonly string[] = []) => {
    if (!account) throw new Error("Connect a wallet before refreshing balances.");
    const balances = await run(() => fetchPortfolioBalances(account, tokenAddresses));
    const [native, ...tokens] = balances;
    if (!native) throw new Error("Wallet provider returned an empty portfolio.");
    setBalance(native);
    setTokenBalances(tokens);
  }, [account, run]);

  const transfer = useCallback(async (request: NativeTransferRequest) => {
    if (!account) throw new Error("Connect a wallet before sending a transfer.");
    return run(() => sendNativeTransfer(account, request));
  }, [account, run]);

  const value = useMemo<WalletContextValue>(() => ({
    account,
    balance,
    tokenBalances,
    busy,
    error,
    connect,
    disconnect,
    refreshBalance,
    refreshPortfolio,
    transfer,
    clearError: () => setError(null),
  }), [account, balance, tokenBalances, busy, error, connect, disconnect, refreshBalance, refreshPortfolio, transfer]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within WalletProvider.");
  return context;
}
