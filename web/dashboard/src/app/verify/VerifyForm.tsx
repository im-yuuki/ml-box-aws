"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Button, Form, InputOTP, Label } from "@heroui/react";
import { Check, RefreshCw } from "lucide-react";
import { bffFetch } from "@/lib/bffFetch";
import { VERIFICATION_EMAIL_STORAGE_KEY } from "@/lib/verification";

export default function VerifyForm() {
  const t = useTranslations("verify");
  const router = useRouter();
  const params = useSearchParams();
  const queryEmail = (params.get("email") ?? "").trim().toLowerCase();
  const [code, setCode] = useState(() => params.get("code") ?? "");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let storedEmail = "";
    try {
      storedEmail = (
        window.sessionStorage.getItem(VERIFICATION_EMAIL_STORAGE_KEY) ?? ""
      )
        .trim()
        .toLowerCase();
    } catch {
      // Fall back to the legacy query parameter below.
    }

    const nextEmail = storedEmail || queryEmail;
    const task = window.setTimeout(() => setEmail(nextEmail), 0);

    if (!storedEmail && queryEmail) {
      try {
        window.sessionStorage.setItem(
          VERIFICATION_EMAIL_STORAGE_KEY,
          queryEmail,
        );
      } catch {
        // Storage may be unavailable in private browsing.
      }
    }

    if (queryEmail) router.replace("/verify");
    return () => window.clearTimeout(task);
  }, [queryEmail, router]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmedCode = code.trim();
    if (!email || !trimmedCode) {
      setError(t("missingFields"));
      return;
    }
    setPending(true);
    try {
      const response = await bffFetch("/api/bff/auth/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code: trimmedCode }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        setError(body.message ?? t("requestFailed"));
      } else {
        try {
          window.sessionStorage.removeItem(VERIFICATION_EMAIL_STORAGE_KEY);
        } catch {
          // Storage may be unavailable in private browsing.
        }
        router.replace("/login");
      }
    } catch {
      setError(t("requestFailed"));
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(
      () => setResendSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);
  async function resend() {
    if (!email) return;
    setError(null);
    try {
      const response = await bffFetch("/api/bff/auth/resend-confirmation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        setError(body.message ?? t("requestFailed"));
      } else setResendSeconds(60);
    } catch {
      setError(t("requestFailed"));
    }
  }
  return (
    <Form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {email || t("emailLabel")}
      </p>
      <div className="flex flex-col gap-2">
        <Label>{t("codeLabel")}</Label>
        <InputOTP
          name="code"
          autoComplete="one-time-code"
          value={code}
          onChange={setCode}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          aria-label={t("codeLabel")}
          isInvalid={Boolean(error)}
          variant="secondary">
          <InputOTP.Group>
            <InputOTP.Slot index={0} />
            <InputOTP.Slot index={1} />
            <InputOTP.Slot index={2} />
          </InputOTP.Group>
          <InputOTP.Separator />
          <InputOTP.Group>
            <InputOTP.Slot index={3} />
            <InputOTP.Slot index={4} />
            <InputOTP.Slot index={5} />
          </InputOTP.Group>
        </InputOTP>
      </div>
      {error ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        isPending={pending}
        isDisabled={pending}
        fullWidth>
        <Check aria-hidden="true" size={16} />
        {t("confirm")}
      </Button>
      <Button
        type="button"
        variant="tertiary"
        isDisabled={pending || resendSeconds > 0 || !email}
        onPress={resend}
        fullWidth>
        <RefreshCw aria-hidden="true" size={14} />
        {resendSeconds > 0
          ? t("resendCooldown", { seconds: resendSeconds })
          : t("resend")}
      </Button>
    </Form>
  );
}
