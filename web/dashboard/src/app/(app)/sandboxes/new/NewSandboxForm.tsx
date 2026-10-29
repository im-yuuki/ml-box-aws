"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, TextField } from "@heroui/react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import HubActivationCard from "../HubActivationCard";

type ErrorResult = { key: string; activationUrl?: string };

async function errorKey(response: Response): Promise<ErrorResult> {
  const body = await response.json().catch(() => ({})) as { error?: string; activationUrl?: string };
  return {
    key: ({ HUB_TIMEOUT: "hubTimeout", HUB_UNAVAILABLE: "hubUnavailable", QUOTA_EXCEEDED: "quotaExceeded", FORBIDDEN: "forbidden", BAD_REQUEST: "badRequest", SANDBOX_CONFLICT: "conflict", HUB_USER_UNKNOWN: "hubUserUnknown", INVALID_SANDBOX_NAME: "badRequest" } as Record<string, string>)[body.error ?? ""] ?? "createFailed",
    activationUrl: body.activationUrl,
  };
}

export default function NewSandboxForm() {
  const t = useTranslations("sandboxes");
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activationUrl, setActivationUrl] = useState<string | null>(null);

  const valid = /^[a-z0-9][a-z0-9-]{0,62}$/i.test(name);

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    setActivationUrl(null);
    try {
      const response = await bffFetch(`/api/bff/sandboxes/${encodeURIComponent(name)}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const failure = await errorKey(response);
        setActivationUrl(failure.activationUrl ?? null);
        throw new Error(failure.key);
      }
      const result = await response.json().catch(() => ({})) as { enforcement?: string };
      router.push(result.enforcement === "degraded" ? "/sandboxes?enforcement=degraded" : "/sandboxes");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? t(`errors.${reason.message}`) : t("errors.createFailed"));
      setSubmitting(false);
    }
  };

  return (
    <Card className="flex max-w-md flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">{t("newTitle")}</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t("newDescription")}</p>
      </div>

      <TextField value={name} onChange={setName} isDisabled={submitting}>
        <Label>{t("nameLabel")}</Label>
        <Input name="name" placeholder={t("namePlaceholder")} variant="secondary" fullWidth />
      </TextField>
      {name && !valid ? (
        <p className="text-sm" style={{ color: "var(--danger)" }}>{t("nameInvalid")}</p>
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="text-sm" style={{ color: "var(--muted)" }}>{t("profileLabel")}</span>
        <span className="text-sm font-medium">{t("profileCpu")}</span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>{t("profileCpuHint")}</span>
      </div>

      {activationUrl ? <HubActivationCard activationUrl={activationUrl} compact onCheck={() => router.push("/sandboxes")} /> : null}
      {error ? <div className="flex flex-col gap-2" role="alert"><p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>{!activationUrl ? <Button variant="secondary" onPress={() => router.push("/sandboxes")}>{t("checkStatus")}</Button> : null}</div> : null}

      <div className="flex gap-3">
        <Button variant="primary" onPress={() => void submit()} isPending={submitting} isDisabled={!valid || submitting}>
          {t("create")}
        </Button>
        <Button variant="secondary" onPress={() => router.push("/sandboxes")} isDisabled={submitting}>
          {t("cancel")}
        </Button>
      </div>
    </Card>
  );
}
