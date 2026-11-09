"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, FieldError, Form, Input, Label, Modal, TextField } from "@heroui/react";
import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";

type Step = "address" | "code";

/** Shows the sign-in email and changes it in two steps: send a code to the new address, then confirm it. */
export default function EmailCard({ email, onChanged }: { email: string; onChanged: (email: string) => void }) {
  const t = useTranslations("account");
  const [step, setStep] = useState<Step>("address");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = () => {
    setStep("address");
    setNewEmail("");
    setCode("");
    setPending(false);
    setError(null);
    setNotice(null);
  };

  const errorKeyFor = (body: { error?: string }): string => {
    if (["AliasExistsException", "UsernameExistsException"].includes(body.error ?? "")) return "emailInUse";
    if (["CodeMismatchException", "ExpiredCodeException"].includes(body.error ?? "")) return "codeInvalid";
    return "profileFailed";
  };

  const requestCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = newEmail.trim();
    setError(null);
    if (candidate.toLowerCase() === email.toLowerCase()) {
      setError(t("emailSameAsCurrent"));
      return;
    }
    setPending(true);
    try {
      const response = await bffFetch("/api/bff/account/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: candidate }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(t(errorKeyFor(body)));
        return;
      }
      setNotice(t("emailCodeSent", { email: candidate }));
      setStep("code");
    } catch {
      setError(t("profileFailed"));
    } finally {
      setPending(false);
    }
  };

  const confirmCode = async (event: FormEvent<HTMLFormElement>, close: () => void) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await bffFetch("/api/bff/account/email/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(t(errorKeyFor(body)));
        return;
      }
      const body = (await response.json()) as { user?: { email?: string } };
      onChanged(body.user?.email ?? newEmail.trim());
      close();
      reset();
    } catch {
      setError(t("profileFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t pt-5" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("emailHeading")}</span>
          <span className="flex items-center gap-2 text-sm">
            <Mail aria-hidden="true" size={14} />
            {email}
          </span>
        </div>
        <Modal onOpenChange={(open) => { if (!open) reset(); }}>
          <Modal.Trigger>
            <Button size="sm" variant="secondary">{t("emailChange")}</Button>
          </Modal.Trigger>
          <Modal.Backdrop>
            <Modal.Container>
              <Modal.Dialog>
                {({ close }) => (
                  <Form
                    className="flex flex-col gap-4"
                    onSubmit={(event: FormEvent<HTMLFormElement>) => (step === "address" ? void requestCode(event) : void confirmCode(event, close))}>
                    <Modal.Header>
                      <Modal.Heading>{t("emailChange")}</Modal.Heading>
                    </Modal.Header>
                    <Modal.Body className="flex flex-col gap-4">
                      <p className="text-sm" style={{ color: "var(--muted)" }}>{t("emailChangeBody")}</p>
                      {step === "address" ? (
                        <TextField value={newEmail} onChange={setNewEmail} type="email" autoComplete="email" isInvalid={Boolean(error)}>
                          <Label>{t("newEmailLabel")}</Label>
                          <Input variant="secondary" fullWidth autoFocus />
                          {error ? <FieldError>{error}</FieldError> : null}
                        </TextField>
                      ) : (
                        <TextField value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" isInvalid={Boolean(error)}>
                          <Label>{t("codeLabel")}</Label>
                          <Input variant="secondary" fullWidth autoFocus />
                          {error ? <FieldError>{error}</FieldError> : null}
                        </TextField>
                      )}
                      {notice && step === "code" ? (
                        <Alert status="success">
                          <Alert.Content>
                            <Alert.Description>{notice}</Alert.Description>
                          </Alert.Content>
                        </Alert>
                      ) : null}
                    </Modal.Body>
                    <Modal.Footer className="flex justify-end gap-2">
                      <Button variant="tertiary" onPress={() => { close(); reset(); }}>{t("cancel")}</Button>
                      <Button type="submit" variant="primary" isPending={pending} isDisabled={pending}>
                        {step === "address" ? t("sendCode") : t("confirmEmail")}
                      </Button>
                    </Modal.Footer>
                  </Form>
                )}
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </div>
    </div>
  );
}
