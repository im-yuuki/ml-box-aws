"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { useBffErrorMessage } from "@/lib/useBffErrorMessage";
import { Button, Form, Input, Label, TextField } from "@heroui/react";
import { LogIn } from "lucide-react";
import FeedbackAlert from "@/components/FeedbackAlert";

function safeNext(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : "/sandboxes";
}

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const t = useTranslations("login");
  const errorMessage = useBffErrorMessage();
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
        setError(await errorMessage(response, t("requestFailed")));
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
        <Input
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          variant="secondary"
          fullWidth
        />
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
        <FeedbackAlert status="danger">{error}</FeedbackAlert>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        isPending={isPending}
        isDisabled={isPending}
        fullWidth>
        <LogIn aria-hidden="true" size={16} />
        {t("submit")}
      </Button>
      <p className="text-sm text-center">
        <a className="underline" href="/forgot-password">
          {t("forgotPassword")}
        </a>
      </p>
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
