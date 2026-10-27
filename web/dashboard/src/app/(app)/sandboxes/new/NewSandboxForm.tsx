"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, TextField } from "@heroui/react";
import { useTranslations } from "next-intl";

function messageFrom(response: Response, fallback: string): Promise<string> {
  return response.json().then((body: { message?: string }) => body.message ?? fallback).catch(() => fallback);
}

export default function NewSandboxForm() {
  const t = useTranslations("sandboxes");
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /^[a-z0-9][a-z0-9-]{0,62}$/i.test(name);

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/bff/sandboxes/${encodeURIComponent(name)}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error(await messageFrom(response, t("createFailed")));
      router.push("/sandboxes");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("createFailed"));
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

      {error ? <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error}</p> : null}

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