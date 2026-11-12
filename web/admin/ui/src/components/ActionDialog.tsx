"use client";

import { useState, type ReactNode } from "react";
import { Button, Input, Label, Modal, TextField, toast } from "@heroui/react";
import { useTranslations } from "next-intl";
import FeedbackAlert from "@/components/FeedbackAlert";
import { actionErrorKey, reasonIsValid, REASON_MAX, REASON_MIN } from "@/lib/actions";

export type ActionRequest = {
  /** Changes with every request, so the form starts empty each time. */
  id: string;
  title: string;
  body: ReactNode;
  confirm: string;
  danger?: boolean;
  run: (reason: string) => Promise<void>;
};

/**
 * Every change goes through this dialog: what will happen, a written reason that is stored in the audit log, and a
 * button that names the action. Nothing is sent until the reason is long enough.
 */
export default function ActionDialog({ request, onClose }: { request: ActionRequest | null; onClose: () => void }) {
  if (!request) return null;
  return <Form key={request.id} request={request} onClose={onClose} />;
}

function Form({ request, onClose }: { request: ActionRequest; onClose: () => void }) {
  const t = useTranslations("actions");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reasonIsValid(reason)) {
      setError(t("errors.invalidReason", { min: REASON_MIN, max: REASON_MAX }));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await request.run(reason);
      toast.success(t("done"));
      onClose();
    } catch (failure) {
      setError(t(`errors.${actionErrorKey(failure)}`, { min: REASON_MIN, max: REASON_MAX }));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal isOpen onOpenChange={(open) => (open ? undefined : onClose())}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            {({ close }) => (
              <>
                <Modal.Header>
                  <Modal.Heading>{request.title}</Modal.Heading>
                </Modal.Header>
                <Modal.Body className="flex flex-col gap-4">
                  <div className="text-sm">{request.body}</div>
                  <TextField value={reason} onChange={setReason} isRequired className="w-full">
                    <Label>{t("reasonLabel")}</Label>
                    <Input placeholder={t("reasonPlaceholder")} variant="secondary" fullWidth autoFocus maxLength={REASON_MAX} />
                  </TextField>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {t("reasonHint", { min: REASON_MIN, max: REASON_MAX })}
                  </p>
                  {error ? <FeedbackAlert status="danger">{error}</FeedbackAlert> : null}
                </Modal.Body>
                <Modal.Footer className="flex justify-end gap-2">
                  <Button variant="tertiary" onPress={close} isDisabled={pending}>
                    {t("cancel")}
                  </Button>
                  <Button variant={request.danger ? "danger" : "primary"} isPending={pending} isDisabled={pending || !reasonIsValid(reason)} onPress={() => void submit()}>
                    {request.confirm}
                  </Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
