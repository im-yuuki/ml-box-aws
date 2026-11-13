"use client";

import { useState } from "react";
import { Button, Card, Form, Input, Label, TextField } from "@heroui/react";
import { LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import BrandMark from "@/components/BrandMark";
import FeedbackAlert from "@/components/FeedbackAlert";
import SettingsDrawer from "@/components/SettingsDrawer";
import { useSession } from "@/components/SessionProvider";
import { ApiError } from "@/lib/api";

/** The only way in: a single administrator, outside Cognito. The wording never says which of the two fields was wrong. */
export default function LoginForm() {
  const t = useTranslations("login");
  const { signIn } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (!username || !password) {
      setError(t("missingFields"));
      return;
    }
    setPending(true);
    try {
      await signIn(username, password);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 429) {
        const seconds = Number(failure.data.retryAfter ?? 900);
        setError(t("locked", { minutes: Math.max(1, Math.ceil(seconds / 60)) }));
      } else if (failure instanceof ApiError && failure.status === 401) {
        setError(t("invalid"));
      } else {
        setError(t("failed"));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="workspace-frame">
      <div className="admin-login">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex items-center justify-between">
            <span className="workspace-brand">
              <BrandMark />
              <span className="workspace-brand-copy">
                <strong>MLBox</strong>
              </span>
            </span>
            <SettingsDrawer />
          </div>
          <Card className="flex flex-col gap-5 p-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {t("subtitle")}
              </p>
            </div>
            <Form onSubmit={onSubmit} className="flex flex-col gap-4">
              <TextField isRequired>
                <Label>{t("username")}</Label>
                <Input name="username" autoComplete="username" variant="secondary" fullWidth autoFocus />
              </TextField>
              <TextField isRequired>
                <Label>{t("password")}</Label>
                <Input name="password" type="password" autoComplete="current-password" variant="secondary" fullWidth />
              </TextField>
              {error ? <FeedbackAlert status="danger">{error}</FeedbackAlert> : null}
              <Button type="submit" variant="primary" size="lg" isPending={pending} isDisabled={pending} fullWidth>
                <LogIn aria-hidden="true" size={16} />
                {t("submit")}
              </Button>
            </Form>
          </Card>
        </div>
      </div>
    </div>
  );
}
