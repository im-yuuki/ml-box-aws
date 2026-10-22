"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Form,
  Input,
  Label,
  TextField,
  Description,
} from "@heroui/react";
import { cognitoConfigured } from "@/lib/auth/cognitoConfig";

/**
 * Email + password sign-in.
 *
 * In production this drives the Cognito SRP flow via the BFF. For now
 * the form validates locally and surfaces the env-not-set banner so the
 * dashboard still renders before Cognito is wired up.
 */
export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/sandboxes";
  const t = useTranslations("login");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!cognitoConfigured) {
      setError(t("cognitoUnconfigured"));
      return;
    }
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    if (!email || !password) {
      setError(t("missingFields"));
      return;
    }
    startTransition(() => {
      // TODO: POST to /api/bff/auth/login; the BFF performs SRP and
      // sets an httpOnly session cookie, then redirects.
      void email;
      void password;
      router.push(next);
    });
  };

  return (
    <Form onSubmit={onSubmit} className="flex flex-col gap-4">
      <TextField isRequired>
        <Label>{t("emailLabel")}</Label>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          variant="secondary"
          fullWidth
        />
        <Description>{t("emailHint")}</Description>
      </TextField>
      <TextField isRequired>
        <Label>{t("passwordLabel")}</Label>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          variant="secondary"
          fullWidth
        />
      </TextField>
      {error ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        isPending={isPending}
        isDisabled={isPending}
      >
        {t("submit")}
      </Button>
      <p className="text-sm text-center" style={{ color: "var(--muted)" }}>
        {t("newHere")}{" "}
        <a className="underline" href="/register">
          {t("createAccountCta")}
        </a>
        .
      </p>
    </Form>
  );
}
