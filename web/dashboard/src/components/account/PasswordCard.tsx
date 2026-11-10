"use client";

import { useState, type FormEvent } from "react";
import {
  Button,
  Card,
  Description,
  Form,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import FeedbackAlert from "@/components/FeedbackAlert";

/** Change the sign-in password. Lives on the Security page next to the sessions list. */
export default function PasswordCard() {
  const t = useTranslations("account");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
    <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">{t("passwordHeading")}</h2>
        </div>
        <Form
          className="flex flex-col gap-4"
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
            <FeedbackAlert status="danger">{formError}</FeedbackAlert>
          ) : null}
          {message ? (
            <FeedbackAlert status="success">{message}</FeedbackAlert>
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
  );
}
