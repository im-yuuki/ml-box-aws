"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import {
  Button,
  Form,
  Input,
  Label,
  TextField,
  Description,
} from "@heroui/react";
function safeNext(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/sandboxes";
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const t = useTranslations("login");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (!email || !password) {
      setError(t("missingFields"));
      return;
    }

    setIsPending(true);
    try {
      const response = await bffFetch("/api/bff/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setError(await responseMessage(response, t("requestFailed")));
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError(t("requestFailed"));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Form onSubmit={onSubmit} className="flex flex-col gap-4">
      <TextField isRequired>
        <Label>{t("emailLabel")}</Label>
        <Input name="email" type="email" autoComplete="email" placeholder={t("emailPlaceholder")} variant="secondary" fullWidth />
        <Description>{t("emailHint")}</Description>
      </TextField>
      <TextField isRequired>
        <Label>{t("passwordLabel")}</Label>
        <Input name="password" type="password" autoComplete="current-password" variant="secondary" fullWidth />
      </TextField>
      {error ? <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error}</p> : null}
      <Button type="submit" variant="primary" size="lg" isPending={isPending} isDisabled={isPending}>
        {t("submit")}
      </Button>
      <p className="text-sm text-center"><a className="underline" href="/forgot-password">{t("forgotPassword")}</a></p>
      <p className="text-sm text-center" style={{ color: "var(--muted)" }}>
        {t("newHere")} <a className="underline" href="/register">{t("createAccountCta")}</a>.
      </p>
    </Form>
  );
}
