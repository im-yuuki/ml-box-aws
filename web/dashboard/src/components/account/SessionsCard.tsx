"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Chip, Spinner } from "@heroui/react";
import { LogOut, MonitorSmartphone, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { bffFetch } from "@/lib/bffFetch";
import type { LoginSession } from "@/lib/account";

type SessionsResponse = { sessions?: LoginSession[] };

/** Devices signed in to the account. Signing out a session revokes its refresh token at Cognito. */
export default function SessionsCard() {
  const t = useTranslations("account");
  const locale = useLocale();
  const router = useRouter();
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await bffFetch("/api/bff/account/sessions", { cache: "no-store" });
      if (!response.ok) throw new Error("sessions");
      const body = (await response.json()) as SessionsResponse;
      setSessions(Array.isArray(body.sessions) ? body.sessions : []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  const revoke = async (session: LoginSession) => {
    setBusyId(session.id);
    setError(null);
    try {
      const response = await bffFetch(`/api/bff/account/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (!response.ok) {
        setError(t("revokeFailed"));
        return;
      }
      if (session.current) {
        // This browser's own session is gone: send it back to sign-in.
        router.push("/login");
        return;
      }
      await load();
    } catch {
      setError(t("revokeFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async () => {
    setBusyId("others");
    setError(null);
    try {
      const response = await bffFetch("/api/bff/account/sessions/revoke-others", { method: "POST" });
      if (!response.ok) {
        setError(t("revokeFailed"));
        return;
      }
      await load();
    } catch {
      setError(t("revokeFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const others = sessions.filter((session) => !session.current);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{t("securityHeading")}</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t("securityBody")}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm" role="status">
          <Spinner size="sm" />
          <span>{t("loading")}</span>
        </div>
      ) : null}

      {loadError ? (
        <div className="flex flex-wrap items-center gap-3">
          <Alert status="danger">
            <Alert.Content>
              <Alert.Description>{t("loadFailed")}</Alert.Description>
            </Alert.Content>
          </Alert>
          <Button size="sm" variant="secondary" onPress={() => void load()}>
            <RotateCcw aria-hidden="true" size={14} />
            {t("retry")}
          </Button>
        </div>
      ) : null}

      {!loading && !loadError && sessions.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t("noSessions")}</p>
      ) : null}

      {sessions.length > 0 ? (
        <ul aria-label={t("securityHeading")} className="flex flex-col divide-y" style={{ borderColor: "var(--border)" }}>
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <MonitorSmartphone aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {session.label}
                    {session.current ? <Chip size="sm" variant="soft" color="success">{t("currentSession")}</Chip> : null}
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {t("lastSeen", { time: formatTime(session.lastSeenAt) })} · {t("signedInAt", { time: formatTime(session.createdAt) })}
                  </span>
                </div>
              </div>
              {session.current ? null : (
                <Button size="sm" variant="secondary" isDisabled={busyId !== null} isPending={busyId === session.id} onPress={() => void revoke(session)}>
                  <LogOut aria-hidden="true" size={14} />
                  {t("revokeSession")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {others.length > 0 ? (
        <Button variant="danger-soft" size="sm" className="w-fit" isDisabled={busyId !== null} isPending={busyId === "others"} onPress={() => void revokeOthers()}>
          {t("revokeOthers")}
        </Button>
      ) : null}

      {error ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <p className="text-xs" style={{ color: "var(--muted)" }}>{t("sessionsLegacyNote")}</p>
    </Card>
  );
}
