"use client";

import { useState, useTransition } from "react";
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
import { cognitoConfigured } from "@/lib/auth/cognitoConfig";

export default function RegisterForm() {
  const router = useRouter();
  const t = useTranslations("register");
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
    // TODO: POST to /api/bff/auth/register; the BFF calls SignUp + sends
    // the verification code, then redirects to /verify.
    startTransition(() => router.push("/verify"));
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
          autoComplete="new-password"
          variant="secondary"
          fullWidth
        />
        <Description>{t("passwordHint")}</Description>
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
        {t("haveAccount")}{" "}
        <a className="underline" href="/login">
          {t("signInCta")}
        </a>
        .
      </p>
    </Form>
  );
}
