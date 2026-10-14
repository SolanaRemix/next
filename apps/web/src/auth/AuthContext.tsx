import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UserRole } from "@next/types";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

interface AuthContextValue {
  accessToken: string | null;
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateAccessToken: (accessToken: string, expiresIn: number) => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const apiUrl = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/+$/, "");
let refreshInFlight: Promise<SessionResponse | null> | null = null;

function isSessionResponse(value: unknown): value is SessionResponse {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if (
    typeof data.accessToken !== "string" ||
    data.accessToken.length === 0 ||
    typeof data.expiresIn !== "number" ||
    !Number.isSafeInteger(data.expiresIn) ||
    data.expiresIn < 1 ||
    data.expiresIn > 900
  ) return false;
  if (!data.user || typeof data.user !== "object") return false;
  const user = data.user as Record<string, unknown>;
  return typeof user.id === "string" &&
    typeof user.email === "string" &&
    ["SuperAdmin", "EnterpriseAdmin", "Trader", "Viewer", "Guest"].includes(String(user.role));
}

async function readSession(response: Response): Promise<SessionResponse> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data
      ? (data as { message?: unknown }).message
      : null;
    throw new Error(typeof message === "string" ? message : "Authentication request failed.");
  }
  if (!isSessionResponse(data)) throw new Error("Authentication service returned an invalid response.");
  return data;
}

function refreshSession(): Promise<SessionResponse | null> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${apiUrl}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (response) => response.ok ? readSession(response) : null)
      .catch(() => null)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void refreshSession().then((session) => {
      if (!active) return;
      if (session) {
        setAccessToken(session.accessToken);
        setUser(session.user);
        setExpiresIn(session.expiresIn);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!accessToken || !expiresIn) return;
    const timeout = window.setTimeout(() => {
      void refreshSession().then((session) => {
        if (session) {
          setAccessToken(session.accessToken);
          setUser(session.user);
          setExpiresIn(session.expiresIn);
        } else {
          setAccessToken(null);
          setUser(null);
          setExpiresIn(null);
        }
      });
    }, Math.max(5_000, (expiresIn - 30) * 1_000));
    return () => window.clearTimeout(timeout);
  }, [accessToken, expiresIn]);

  const authenticate = useCallback(async (
    action: "login" | "register",
    email: string,
    password: string,
  ) => {
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/auth/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(10_000),
      });
      const session = await readSession(response);
      setAccessToken(session.accessToken);
      setUser(session.user);
      setExpiresIn(session.expiresIn);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Authentication request failed.";
      setError(message);
      throw cause instanceof Error ? cause : new Error(message);
    }
  }, []);

  const login = useCallback((email: string, password: string) =>
    authenticate("login", email, password), [authenticate]);
  const register = useCallback((email: string, password: string) =>
    authenticate("register", email, password), [authenticate]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${apiUrl}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    } finally {
      setAccessToken(null);
      setUser(null);
      setExpiresIn(null);
    }
  }, []);

  const updateAccessToken = useCallback((token: string, tokenExpiresIn: number) => {
    setAccessToken(token);
    setExpiresIn(tokenExpiresIn);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    accessToken,
    user,
    loading,
    error,
    login,
    register,
    logout,
    updateAccessToken,
    clearError: () => setError(null),
  }), [accessToken, user, loading, error, login, register, logout, updateAccessToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
