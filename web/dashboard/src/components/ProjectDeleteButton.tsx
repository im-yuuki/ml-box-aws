"use client";

import { useState } from "react";
import { Button, Modal } from "@heroui/react";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import FeedbackAlert from "@/components/FeedbackAlert";

/** Deletes a Project after confirmation. Artifacts, usage history and the sandbox record go with it. */
export default function ProjectDeleteButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const t = useTranslations("workspace");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (close: () => void) => {
    setPending(true);
    setError(null);
    try {
      const response = await bffFetch(`/api/bff/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(t(body.error === "SANDBOX_RUNNING" ? "deleteRunning" : body.error === "FORBIDDEN" ? "deleteForbidden" : "deleteFailed"));
        return;
      }
      close();
      router.push("/projects");
      router.refresh();
    } catch {
      setError(t("deleteFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal>
      <Modal.Trigger>
        <Button variant="danger-soft" size="sm">
          <Trash2 aria-hidden="true" size={14} />
          {t("deleteProject")}
        </Button>
      </Modal.Trigger>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            {({ close }) => (
              <>
                <Modal.Header>
                  <Modal.Heading>{t("deleteConfirmTitle")}</Modal.Heading>
                </Modal.Header>
                <Modal.Body className="flex flex-col gap-3">
                  <p className="text-sm">{t("deleteConfirmBody", { name: projectName })}</p>
                  {error ? (
                    <FeedbackAlert status="danger">{error}</FeedbackAlert>
                  ) : null}
                </Modal.Body>
                <Modal.Footer className="flex justify-end gap-2">
                  <Button variant="tertiary" onPress={close}>{t("deleteCancel")}</Button>
                  <Button variant="danger" isPending={pending} isDisabled={pending} onPress={() => void remove(close)}>
                    {t("deleteConfirmAction")}
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
