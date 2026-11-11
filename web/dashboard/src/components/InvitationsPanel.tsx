"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, Form, Input, ListBox, Select, TextField } from "@heroui/react";
import { Check, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { useBffErrorMessage } from "@/lib/useBffErrorMessage";
import FeedbackAlert from "@/components/FeedbackAlert";
import { canManageTeams, type SpaceSummary } from "@/lib/spaces";

type Invitation = { id: string; email: string; role: "admin" | "member" | "viewer"; status: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Owners and admins invite people with a role. Anyone can see and accept invitations sent to their email. */
export default function InvitationsPanel({ space }: { space: SpaceSummary }) {
  const t = useTranslations("invitations");
  const errorMessage = useBffErrorMessage();
  const [pending, setPending] = useState<Invitation[]>([]);
  const [mine, setMine] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const manager = canManageTeams(space.role);
  // Roles are stored as ids ("member"); people know them by name.
  const roleLabel = (value: string) =>
    value === "admin" ? t("roleAdmin") : value === "viewer" ? t("roleViewer") : t("roleMember");

  const load = useCallback(async () => {
    setError(null);
    const mineResponse = await bffFetch("/api/bff/invitations", { cache: "no-store" });
    if (mineResponse.ok) {
      const body = (await mineResponse.json()) as { invitations?: Invitation[] };
      setMine(body.invitations ?? []);
    }
    if (manager) {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(space.id)}/invitations`, { cache: "no-store" });
      if (response.ok) {
        const body = (await response.json()) as { invitations?: Invitation[] };
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
    setNotice(null);
    try {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(space.id)}/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value, role }),
      });
      if (!response.ok) {
        // The Space may have no seat left for another member; the BFF says so with its own code.
        setError(
          response.status === 403
            ? t("forbidden")
            : (await errorMessage(response, t("inviteFailed"))),
        );
        return;
      }
      setEmail("");
      setNotice(t("inviteSent", { email: value }));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(space.id)}/invitations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) setError(t("revokeFailed"));
      else setNotice(t("invitationRevoked"));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const accept = async (id: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bffFetch(`/api/bff/invitations/${encodeURIComponent(id)}/accept`, { method: "POST" });
      if (!response.ok) setError(t("acceptFailed"));
      else setNotice(t("invitationAccepted"));
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("title")}</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {manager ? (
          <>
            <Form className="flex flex-wrap items-end gap-3" onSubmit={invite}>
              <TextField type="email" value={email} onChange={setEmail} aria-label={t("email")} className="min-w-64">
                <Input placeholder={t("emailPlaceholder")} variant="secondary" fullWidth />
              </TextField>
              <Select selectedKey={role} onSelectionChange={(key) => key && setRole(String(key))} aria-label={t("role")} className="w-40">
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="member" textValue={t("roleMember")}>{t("roleMember")}<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="viewer" textValue={t("roleViewer")}>{t("roleViewer")}<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="admin" textValue={t("roleAdmin")}>{t("roleAdmin")}<ListBox.ItemIndicator /></ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Button type="submit" variant="primary" isPending={busy} isDisabled={busy}><Send aria-hidden="true" size={16} />{t("invite")}</Button>
            </Form>
            <ul aria-label={t("pendingList")} className="flex flex-col gap-2">
              {pending.map((invitation) => (
                <li key={invitation.id} className="flex items-center justify-between gap-4">
                  <span>
                    {invitation.email} · {roleLabel(invitation.role)}
                  </span>
                  <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void revoke(invitation.id)}><X aria-hidden="true" size={14} />{t("revoke")}</Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {mine.length > 0 ? (
          <ul aria-label={t("incomingList")} className="flex flex-col gap-2">
            {mine.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-4">
                <span>{t("incoming", { role: roleLabel(invitation.role) })}</span>
                <Button variant="primary" size="sm" isDisabled={busy} onPress={() => void accept(invitation.id)}><Check aria-hidden="true" size={14} />{t("accept")}</Button>
              </li>
            ))}
          </ul>
        ) : null}

        {notice ? <FeedbackAlert status="success">{notice}</FeedbackAlert> : null}
        {error ? <FeedbackAlert status="danger">{error}</FeedbackAlert> : null}
      </Card.Content>
    </Card>
  );
}
