"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler } from "@/lib/api";
import type { SessionInfo } from "@/lib/types";

type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: string; features: SessionInfo["features"] };

type SessionContextValue = {
  session: SessionState;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

export default function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  const readSession = useCallback(async () => {
    try {
      const info = await api<SessionInfo>("/api/session");
      setSession(info.authenticated && info.user ? { status: "authenticated", user: info.user, features: info.features } : { status: "anonymous" });
    } catch {
      setSession({ status: "anonymous" });
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession({ status: "anonymous" }));
    const task = window.setTimeout(readSession, 0);
    return () => {
      window.clearTimeout(task);
      setUnauthorizedHandler(null);
    };
  }, [readSession]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      await api("/api/login", { method: "POST", body: { username, password } });
      await readSession();
    },
    [readSession],
  );

  const signOut = useCallback(async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } finally {
      setSession({ status: "anonymous" });
    }
  }, []);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
