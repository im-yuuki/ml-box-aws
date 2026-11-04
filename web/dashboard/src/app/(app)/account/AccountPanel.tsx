"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";

type SessionResponse = { user?: { email?: string } };

export default function AccountPanel() {
  const t = useTranslations("account");
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await bffFetch("/api/bff/auth/session", { cache: "no-store" });
      if (!response.ok) throw new Error("session");
      const body = await response.json() as SessionResponse;
      if (!body.user?.email) throw new Error("session");
      setEmail(body.user.email);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => { void loadSession(); }, 0);
    return () => window.clearTimeout(task);
  }, [loadSession]);

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setFormError(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setFormError(t("missingFields"));
      return;
    }
    if (newPassword.length < 12) {
      setFormError(t("passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError(t("passwordMismatch"));
      return;
    }
    setPending(true);
    try {
      const response = await bffFetch("/api/bff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(["NotAuthorizedException", "InvalidPasswordException"].includes(body.error ?? "") ? "invalidPassword" : "requestFailed");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(t("passwordChanged"));
    } catch (error) {
      setFormError(t(error instanceof Error ? error.message : "requestFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="account-grid">
      <section className="panel">
        <h2 className="panel-title">{t("emailHeading")}</h2>
        {loading ? <p className="muted">{t("loading")}</p>
          : loadError ? <div className="runtime-actions"><p className="form-error" role="alert">{t("loadFailed")}</p><Button size="sm" variant="secondary" onPress={() => void loadSession()}>{t("retry")}</Button></div>
            : <p className="email-value">{email}</p>}
      </section>
      <section className="panel">
        <div className="stack-tight">
          <h2 className="panel-title">{t("passwordHeading")}</h2>
          <p className="muted">{t("passwordBody")}</p>
        </div>
        <form className="stack-form" onSubmit={changePassword}>
          <label className="field">{t("currentPasswordLabel")}<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label className="field">{t("newPasswordLabel")}<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><span className="muted small">{t("passwordHint")}</span></label>
          <label className="field">{t("confirmPasswordLabel")}<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          {formError ? <p className="form-error" role="alert">{formError}</p> : null}
          {message ? <p className="form-success" role="status">{message}</p> : null}
          <Button type="submit" variant="primary" isPending={pending} isDisabled={pending}>{t("changePassword")}</Button>
        </form>
      </section>
    </div>
  );
}
