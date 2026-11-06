"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { Alert, Button, Description, Form, Input, Label, TextField } from "@heroui/react";
import { UserPlus } from "lucide-react";

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
      const response = await bffFetch("/api/bff/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: nextEmail, password }),
      });
      if (!response.ok) {
        setError(await responseMessage(response, t("requestFailed")));
        return;
      }
      router.replace(`/verify?email=${encodeURIComponent(nextEmail)}`);
    } catch {
      setError(t("requestFailed"));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Form onSubmit={submitRegistration} className="flex flex-col gap-4">
      <TextField isRequired>
        <Label>{t("emailLabel")}</Label>
        <Input name="email" type="email" autoComplete="email" placeholder={t("emailPlaceholder")} variant="secondary" fullWidth />
      </TextField>
      <TextField isRequired>
        <Label>{t("passwordLabel")}</Label>
        <Input name="password" type="password" autoComplete="new-password" variant="secondary" fullWidth />
        <Description>{t("passwordHint")}</Description>
      </TextField>
      {error ? <Alert status="danger"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}
      <Button type="submit" variant="primary" size="lg" isPending={isPending} isDisabled={isPending}><UserPlus aria-hidden="true" size={16} />{t("submit")}</Button>
      <p className="text-sm text-center" style={{ color: "var(--muted)" }}>
        {t("haveAccount")} <a className="underline" href="/login">{t("signInCta")}</a>.
      </p>
    </Form>
  );
}
