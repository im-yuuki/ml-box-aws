import { getTranslations } from "next-intl/server";
import { Button, Card, Surface } from "@heroui/react";
import Link from "next/link";

export async function generateMetadata() {
  const t = await getTranslations("sandboxes");
  return { title: `${t("title")} · ML Box` };
}

const mockServers = [
  {
    name: "default",
    state: "running",
    lastActivity: "just now",
    url: "/hub/user/mlbox-test@mlbox.june8th.me/lab",
  },
  {
    name: "experiment-x",
    state: "stopped",
    lastActivity: "yesterday",
    url: null,
  },
] as const;

export default async function SandboxesPage() {
  const t = await getTranslations("sandboxes");
  const tCommon = await getTranslations("common");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {t("subtitle")}
          </p>
        </div>
        <Link href="/sandboxes/new">
          <Button variant="primary">{t("new")}</Button>
        </Link>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {mockServers.map((server) => {
          const running = server.state === "running";
          return (
            <Card key={server.name} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-sm" style={{ color: "var(--muted)" }}>
                    {t("profileCpu")}
                  </span>
                  <span className="text-lg font-medium">{server.name}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {t("lastActivity", { when: server.lastActivity })}
                  </span>
                </div>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                  style={{
                    background: running
                      ? "color-mix(in srgb, var(--success) 18%, transparent)"
                      : "color-mix(in srgb, var(--default) 70%, transparent)",
                    color: running ? "var(--success)" : "var(--muted)",
                  }}
                >
                  {running ? t("stateRunning") : t("stateStopped")}
                </span>
              </div>
              <Surface className="mt-4 flex gap-2 p-3">
                {running && server.url ? (
                  <Link href={server.url}>
                    <Button variant="primary" size="sm">
                      {tCommon("openLab")}
                    </Button>
                  </Link>
                ) : (
                  <Button variant="primary" size="sm" isDisabled>
                    {tCommon("start")}
                  </Button>
                )}
                <Button size="sm" variant="secondary" isDisabled>
                  {tCommon("rename")}
                </Button>
                <Button size="sm" variant="danger" isDisabled>
                  {tCommon("delete")}
                </Button>
              </Surface>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
