"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Form,
  Input,
  Label,
  TextField,
  Description,
} from "@heroui/react";
async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

export default function RegisterForm() {
  const router = useRouter();
  const t = useTranslations("register");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(false);

  const submitRegistration = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const nextEmail = String(data.get("email") ?? "").trim().toLowerCase();
    const password = String(data.get("password") ?? "");
    if (!nextEmail || !password) {
      setError(t("missingFields"));
      return;
    }

    setIsPending(true);
    try {
      const response = await fetch("/api/bff/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: nextEmail, password }),
      });
      if (!response.ok) {
        setError(await responseMessage(response, t("requestFailed")));
        return;
      }
      setEmail(nextEmail);
      setConfirmationSent(true);
    } catch {
      setError(t("requestFailed"));
    } finally {
      setIsPending(false);
    }
  };

  const confirmRegistration = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const code = String(data.get("code") ?? "").trim();
    if (!code) {
      setError(t("missingCode"));
      return;
    }

    setIsPending(true);
    try {
      const response = await fetch("/api/bff/auth/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (!response.ok) {
        setError(await responseMessage(response, t("requestFailed")));
        return;
      }
      router.replace(`/login?email=${encodeURIComponent(email)}`);
    } catch {
      setError(t("requestFailed"));
    } finally {
      setIsPending(false);
    }
  };

  if (confirmationSent) {
    return (
      <Form onSubmit={confirmRegistration} className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t("confirmationSent", { email })}</p>
        <TextField isRequired>
          <Label>{t("codeLabel")}</Label>
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" variant="secondary" fullWidth />
        </TextField>
        {error ? <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" isPending={isPending} isDisabled={isPending}>{t("confirm")}</Button>
      </Form>
    );
  }

  return (
    <Form onSubmit={submitRegistration} className="flex flex-col gap-4">
      <TextField isRequired>
        <Label>{t("emailLabel")}</Label>
        <Input name="email" type="email" autoComplete="email" placeholder={t("emailPlaceholder")} variant="secondary" fullWidth />
        <Description>{t("emailHint")}</Description>
      </TextField>
      <TextField isRequired>
        <Label>{t("passwordLabel")}</Label>
        <Input name="password" type="password" autoComplete="new-password" variant="secondary" fullWidth />
        <Description>{t("passwordHint")}</Description>
      </TextField>
      {error ? <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error}</p> : null}
      <Button type="submit" variant="primary" size="lg" isPending={isPending} isDisabled={isPending}>{t("submit")}</Button>
      <p className="text-sm text-center" style={{ color: "var(--muted)" }}>
        {t("haveAccount")} <a className="underline" href="/login">{t("signInCta")}</a>.
      </p>
    </Form>
  );
}
