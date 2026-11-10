"use client";

import { useState } from "react";
import { Button, Input, Modal, TextField } from "@heroui/react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { notifySpacesChanged } from "@/lib/spaces";
import { useActiveSpace } from "@/hooks/useActiveSpace";
import FeedbackAlert from "@/components/FeedbackAlert";

const NAME_MAX_LENGTH = 60;

/** Creates an organization (Space) and switches to it. The creator becomes its owner. */
export default function CreateOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("navbar");
  const { setActiveSpaceId } = useActiveSpace();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (close: () => void) => {
    const value = name.trim();
    if (!value || value.length > NAME_MAX_LENGTH) {
      setError(t("createOrganizationInvalid"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await bffFetch("/api/bff/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      if (!response.ok) {
        setError(t("createOrganizationFailed"));
        return;
      }
      const body = (await response.json()) as { space?: { id?: string } };
      if (body.space?.id) setActiveSpaceId(body.space.id);
      notifySpacesChanged();
      setName("");
      close();
    } catch {
      setError(t("createOrganizationFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            {({ close }) => (
              <>
                <Modal.Header>
                  <Modal.Heading>{t("createOrganizationTitle")}</Modal.Heading>
                </Modal.Header>
                <Modal.Body className="flex flex-col gap-3">
                  <TextField value={name} onChange={setName} aria-label={t("organizationName")} className="w-full">
                    <Input placeholder={t("organizationNamePlaceholder")} variant="secondary" fullWidth />
                  </TextField>
                  {error ? (
                    <FeedbackAlert status="danger">{error}</FeedbackAlert>
                  ) : null}
                </Modal.Body>
                <Modal.Footer className="flex justify-end gap-2">
                  <Button variant="tertiary" onPress={close}>{t("cancel")}</Button>
                  <Button variant="primary" isPending={pending} isDisabled={pending} onPress={() => void create(close)}>
                    {t("createOrganizationAction")}
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
