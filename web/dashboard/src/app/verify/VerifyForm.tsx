"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Form, Input, Label, TextField } from "@heroui/react";
import { bffFetch } from "@/lib/bffFetch";

export default function VerifyForm() {
  const t = useTranslations("verify");
  const router = useRouter();
  const params = useSearchParams();
  const [pending, setPending] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "").trim().toLowerCase();
    const code = String(values.get("code") ?? "").trim();
    if (!email || !code) { setError(t("missingFields")); return; }
    setPending(true);
    try {
      const response = await bffFetch("/api/bff/auth/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code }) });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? t("requestFailed"));
      } else router.replace(`/login?email=${encodeURIComponent(email)}`);
    } catch { setError(t("requestFailed")); }
    finally { setPending(false); }
  }
  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);
  async function resend() {
    const email = (params.get("email") ?? "").trim().toLowerCase();
    if (!email) return;
    setError(null);
    try {
      const response = await bffFetch("/api/bff/auth/resend-confirmation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? t("requestFailed"));
      } else setResendSeconds(60);
    } catch { setError(t("requestFailed")); }
  }
  return <Form onSubmit={onSubmit} className="flex flex-col gap-4">
    <TextField isRequired><Label>{t("emailLabel")}</Label><Input name="email" type="email" autoComplete="email" defaultValue={params.get("email") ?? ""} variant="secondary" fullWidth /></TextField>
    <TextField isRequired><Label>{t("codeLabel")}</Label><Input name="code" autoComplete="one-time-code" defaultValue={params.get("code") ?? ""} variant="secondary" fullWidth /></TextField>
    {error ? <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>{error}</p> : null}
    <Button type="submit" variant="primary" size="lg" isPending={pending} isDisabled={pending}>{t("confirm")}</Button>
    <Button type="button" variant="tertiary" isDisabled={pending || resendSeconds > 0 || !params.get("email")} onPress={resend}>
      {resendSeconds > 0 ? t("resendCooldown", { seconds: resendSeconds }) : t("resend")}
    </Button>
  </Form>;
}
