"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Form, Input, Label, TextField } from "@heroui/react";
import { bffFetch } from "@/lib/bffFetch";

export default function PasswordRecoveryForm({ mode }: { mode: "forgot" | "reset" }) {
  const t = useTranslations("forgotPassword");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "").trim().toLowerCase();
    const payload = mode === "forgot"
      ? { email }
      : { email, code: String(values.get("code") ?? "").trim(), newPassword: String(values.get("password") ?? "") };
    if (!email || (mode === "reset" && (!payload.code || !payload.newPassword))) {
      setError(t("missingFields"));
      return;
    }
    setPending(true);
    try {
      const response = await bffFetch(`/api/bff/auth/${mode === "forgot" ? "forgot-password" : "reset-password"}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? t("requestFailed"));
      } else setSuccess(true);
    } catch { setError(t("requestFailed")); }
    finally { setPending(false); }
  }

  return <Form onSubmit={onSubmit} className="flex flex-col gap-4">
    {success ? <p className="text-sm" role="status" style={{ color: "var(--muted)" }}>{t(mode === "forgot" ? "sent" : "resetComplete")}</p> : <>
      <TextField isRequired><Label>{t("emailLabel")}</Label><Input name="email" type="email" autoComplete="email" variant="secondary" fullWidth /></TextField>
      {mode === "reset" ? <><TextField isRequired><Label>{t("codeLabel")}</Label><Input name="code" autoComplete="one-time-code" variant="secondary" fullWidth /></TextField><TextField isRequired><Label>{t("newPasswordLabel")}</Label><Input name="password" type="password" autoComplete="new-password" variant="secondary" fullWidth /></TextField></> : null}
      {error ? <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>{error}</p> : null}
      <Button type="submit" variant="primary" size="lg" isPending={pending} isDisabled={pending}>{t(mode === "forgot" ? "send" : "reset")}</Button>
    </>}
    <p className="text-sm text-center"><a className="underline" href="/login">{t("backToLogin")}</a></p>
  </Form>;
}
