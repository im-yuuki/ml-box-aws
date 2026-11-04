"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card } from "@heroui/react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { canManageTeams, type SpaceSummary } from "@/lib/spaces";

type Invitation = { id: string; email: string; role: "admin" | "member" | "viewer"; status: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function InvitationsPanel({ space }: { space: SpaceSummary }) {
  const t = useTranslations("invitations");
  const [pending, setPending] = useState<Invitation[]>([]);
  const [mine, setMine] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manager = canManageTeams(space.role);

  const load = useCallback(async () => {
    setError(null);
    const mineResponse = await bffFetch("/api/bff/invitations", { cache: "no-store" });
    if (mineResponse.ok) {
      const body = await mineResponse.json() as { invitations?: Invitation[] };
      setMine(body.invitations ?? []);
    }
    if (manager) {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(space.id)}/invitations`, { cache: "no-store" });
      if (response.ok) {
        const body = await response.json() as { invitations?: Invitation[] };
        setPending(body.invitations ?? []);
      }
    }
  }, [manager, space.id]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(value)) {
      setError(t("emailInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(space.id)}/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value, role }),
      });
      if (!response.ok) {
        setError(response.status === 403 ? t("forbidden") : t("inviteFailed"));
        return;
      }
      setEmail("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(space.id)}/invitations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) setError(t("revokeFailed"));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const accept = async (id: string) => {
    setBusy(true);
    try {
      const response = await bffFetch(`/api/bff/invitations/${encodeURIComponent(id)}/accept`, { method: "POST" });
      if (!response.ok) setError(t("acceptFailed"));
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="workspace-detail-section">
      <span className="workspace-section-index">{t("section")}</span>
      <h2>{t("title")}</h2>
      <p>{t("body")}</p>

      {manager ? (
        <>
          <form className="workspace-create-form" onSubmit={invite}>
            <label className="sr-only" htmlFor="invite-email">{t("email")}</label>
            <input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("emailPlaceholder")} />
            <label className="sr-only" htmlFor="invite-role">{t("role")}</label>
            <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="member">{t("roleMember")}</option>
              <option value="viewer">{t("roleViewer")}</option>
              <option value="admin">{t("roleAdmin")}</option>
            </select>
            <Button type="submit" variant="primary" isPending={busy} isDisabled={busy}>{t("invite")}</Button>
          </form>
          <ul aria-label={t("pendingList")} className="flex flex-col gap-2">
            {pending.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-4">
                <span>{invitation.email} · {invitation.role}</span>
                <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void revoke(invitation.id)}>{t("revoke")}</Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {mine.length > 0 ? (
        <ul aria-label={t("incomingList")} className="flex flex-col gap-2">
          {mine.map((invitation) => (
            <li key={invitation.id} className="flex items-center justify-between gap-4">
              <span>{t("incoming", { role: invitation.role })}</span>
              <Button variant="primary" size="sm" isDisabled={busy} onPress={() => void accept(invitation.id)}>{t("accept")}</Button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="workspace-form-error" role="alert">{error}</p> : null}
    </Card>
  );
}
