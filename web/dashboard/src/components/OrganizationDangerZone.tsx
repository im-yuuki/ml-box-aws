"use client";

import { useState } from "react";
import { Button, Card, Input, Modal, TextField } from "@heroui/react";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { notifySpacesChanged, type SpaceSummary } from "@/lib/spaces";
import FeedbackAlert from "@/components/FeedbackAlert";

const ERROR_KEYS: Record<string, string> = {
  SANDBOX_RUNNING: "deleteRunning",
  CONFIRMATION_MISMATCH: "deleteMismatch",
  FORBIDDEN: "memberForbidden",
};

/** Owner-only: deletes the whole organization after the owner types its name. Not reversible. */
export default function OrganizationDangerZone({ space }: { space: SpaceSummary }) {
  const t = useTranslations("teams");
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === space.name.trim();

  const remove = async (close: () => void) => {
    setPending(true);
    setError(null);
    try {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(space.id)}/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: typed }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(t(ERROR_KEYS[body.error ?? ""] ?? "deleteFailed"));
        return;
      }
      setTyped("");
      close();
      notifySpacesChanged();
      router.replace("/projects");
      router.refresh();
    } catch {
      setError(t("deleteFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card aria-labelledby="org-danger-title">
      <Card.Header>
        <Card.Title id="org-danger-title">{t("dangerTitle")}</Card.Title>
        <Card.Description>{t("dangerBody", { name: space.name })}</Card.Description>
      </Card.Header>
      <Card.Content>
        <Modal onOpenChange={(open) => { if (!open) { setTyped(""); setError(null); } }}>
          <Modal.Trigger>
            <Button variant="danger-soft">
              <Trash2 aria-hidden="true" size={14} />
              {t("dangerAction")}
            </Button>
          </Modal.Trigger>
          <Modal.Backdrop>
            <Modal.Container>
              <Modal.Dialog>
                {({ close }) => (
                  <>
                    <Modal.Header>
                      <Modal.Heading>{t("dangerConfirmTitle", { name: space.name })}</Modal.Heading>
                    </Modal.Header>
                    <Modal.Body className="flex flex-col gap-3">
                      <p className="text-sm">{t("dangerConfirmBody")}</p>
                      <TextField value={typed} onChange={setTyped} aria-label={t("dangerConfirmLabel", { name: space.name })} className="w-full">
                        <Input placeholder={space.name} variant="secondary" fullWidth />
                      </TextField>
                      {error ? (
                        <FeedbackAlert status="danger">{error}</FeedbackAlert>
                      ) : null}
                    </Modal.Body>
                    <Modal.Footer className="flex justify-end gap-2">
                      <Button variant="tertiary" onPress={close}>{t("cancel")}</Button>
                      <Button variant="danger" isPending={pending} isDisabled={pending || !matches} onPress={() => void remove(close)}>
                        {t("dangerAction")}
                      </Button>
                    </Modal.Footer>
                  </>
                )}
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </Card.Content>
    </Card>
  );
}
