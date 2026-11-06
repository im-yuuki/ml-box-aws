"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Card,
  Description,
  Form,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import { KeyRound, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";

type SessionResponse = { user?: { email?: string } };

export default function AccountPanel() {
  const t = useTranslations("account");
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await bffFetch("/api/bff/auth/session", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("session");
      const body = (await response.json()) as SessionResponse;
      if (!body.user?.email) throw new Error("session");
      setEmail(body.user.email);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => {
      void loadSession();
    }, 0);
    return () => window.clearTimeout(task);
  }, [loadSession]);

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setFormError(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setFormError(t("missingFields"));
      return;
    }
    if (newPassword.length < 12) {
      setFormError(t("passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError(t("passwordMismatch"));
      return;
    }
    setPending(true);
    try {
      const response = await bffFetch("/api/bff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          ["NotAuthorizedException", "InvalidPasswordException"].includes(
            body.error ?? "",
          )
            ? "invalidPassword"
            : "requestFailed",
        );
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(t("passwordChanged"));
    } catch (error) {
      setFormError(t(error instanceof Error ? error.message : "requestFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-medium">{t("emailHeading")}</h2>
        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {t("loading")}
          </p>
        ) : loadError ? (
          <div className="flex flex-wrap items-center gap-3">
            <Alert status="danger">
              <Alert.Content>
                <Alert.Description>{t("loadFailed")}</Alert.Description>
              </Alert.Content>
            </Alert>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => void loadSession()}>
              <RotateCcw aria-hidden="true" size={14} />
              {t("retry")}
            </Button>
          </div>
        ) : (
          <p className="text-sm">{email}</p>
        )}
      </Card>
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">{t("passwordHeading")}</h2>
        </div>
        <Form
          className="flex max-w-md flex-col gap-4"
          onSubmit={changePassword}>
          <TextField
            type="password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password">
            <Label>{t("currentPasswordLabel")}</Label>
            <Input variant="secondary" fullWidth />
          </TextField>
          <TextField
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password">
            <Label>{t("newPasswordLabel")}</Label>
            <Input variant="secondary" fullWidth />
            <Description>{t("passwordHint")}</Description>
          </TextField>
          <TextField
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password">
            <Label>{t("confirmPasswordLabel")}</Label>
            <Input variant="secondary" fullWidth />
          </TextField>
          {formError ? (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Description>{formError}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          {message ? (
            <Alert status="success">
              <Alert.Content>
                <Alert.Description>{message}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            isPending={pending}
            isDisabled={pending}
            fullWidth>
            <KeyRound aria-hidden="true" size={16} />
            {t("changePassword")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
