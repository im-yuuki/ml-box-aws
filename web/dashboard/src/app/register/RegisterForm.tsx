"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import {
  Button,
  Description,
  Form,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import { UserPlus } from "lucide-react";
import { VERIFICATION_EMAIL_STORAGE_KEY } from "@/lib/verification";
import { useBffErrorMessage } from "@/lib/useBffErrorMessage";
import FeedbackAlert from "@/components/FeedbackAlert";

export default function RegisterForm() {
  const router = useRouter();
  const t = useTranslations("register");
  const errorMessage = useBffErrorMessage();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitRegistration = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const nextEmail = String(data.get("email") ?? "")
      .trim()
      .toLowerCase();
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
        setError(await errorMessage(response, t("requestFailed")));
        return;
      }
      try {
        window.sessionStorage.setItem(
          VERIFICATION_EMAIL_STORAGE_KEY,
          nextEmail,
        );
      } catch {
        // Continue to the verification screen even when storage is unavailable.
      }
      router.replace("/verify");
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
          autoComplete="new-password"
          variant="secondary"
          fullWidth
        />
        <Description>{t("passwordHint")}</Description>
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
        <UserPlus aria-hidden="true" size={16} />
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
