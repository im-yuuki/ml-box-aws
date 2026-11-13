"use client";

import { useState } from "react";
import { Button, Card, Form, Label, SearchField } from "@heroui/react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import ActionButton from "@/components/ActionButton";
import CardSectionTitle from "@/components/CardSectionTitle";
import ChangePlanButton from "@/components/ChangePlanButton";
import DataTable from "@/components/DataTable";
import DateTime from "@/components/DateTime";
import FeedbackAlert from "@/components/FeedbackAlert";
import PageHeading from "@/components/PageHeading";
import RelativeTime from "@/components/RelativeTime";
import Section from "@/components/Section";
import StatusChip from "@/components/StatusChip";
import { sendAction } from "@/lib/actions";
import { api, ApiError } from "@/lib/api";
import { useActionsEnabled } from "@/components/ActionButton";
import type { Section as SectionResult, UserRow } from "@/lib/types";

function UserCard({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const t = useTranslations("users");
  const common = useTranslations("common");
  const revoke = useTranslations("actions.revokeSessions");
  const disable = useTranslations("actions.disableAccount");
  const enable = useTranslations("actions.enableAccount");
  const actions = useActionsEnabled();
  const accountEnabled = user.cognito?.enabled !== false;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <CardSectionTitle>{user.email}</CardSectionTitle>
        {user.full_name ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {user.full_name}
          </p>
        ) : null}
      </div>
      <dl className="admin-kv">
        <dt>{t("id")}</dt>
        <dd className="admin-mono">{user.id}</dd>
        <dt>{t("registered")}</dt>
        <dd>
          <DateTime value={user.created_at} />
        </dd>
        <dt>{t("lastActive")}</dt>
        <dd>{user.last_seen_at ? <RelativeTime value={user.last_seen_at} /> : t("noSession")}</dd>
        <dt>{t("logins")}</dt>
        <dd>{user.active_logins}</dd>
        <dt>{t("hubIdentity")}</dt>
        <dd>
          {user.hub_username ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="admin-mono">{user.hub_username}</span>
              <StatusChip status={user.hub_identity_status === "conflict" ? "error" : "ok"}>{user.hub_identity_status}</StatusChip>
            </span>
          ) : (
            t("hubNone")
          )}
        </dd>
        <dt>{t("account")}</dt>
        <dd>
          {user.cognito ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <StatusChip status={user.cognito.enabled ? "ok" : "error"}>{user.cognito.enabled ? t("accountActive") : t("accountDisabled")}</StatusChip>
              <span className="admin-mono">{user.cognito.status}</span>
            </span>
          ) : (
            t("accountUnknown")
          )}
        </dd>
      </dl>
      {actions ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("actions")}>
          <ActionButton
            trigger={revoke("trigger")}
            build={() => ({
              title: revoke("title"),
              body: revoke("body", { email: user.email }),
              confirm: revoke("confirm"),
              run: async (reason) => {
                await sendAction("/api/actions/user/revoke-sessions", { userId: user.id }, reason);
                onChanged();
              },
            })}
          />
          {accountEnabled ? (
            <ActionButton
              danger
              trigger={disable("trigger")}
              build={() => ({
                title: disable("title"),
                body: disable("body", { email: user.email }),
                confirm: disable("confirm"),
                run: async (reason) => {
                  await sendAction("/api/actions/user/account", { userId: user.id, enabled: false }, reason);
                  onChanged();
                },
              })}
            />
          ) : (
            <ActionButton
              trigger={enable("trigger")}
              build={() => ({
                title: enable("title"),
                body: enable("body", { email: user.email }),
                confirm: enable("confirm"),
                run: async (reason) => {
                  await sendAction("/api/actions/user/account", { userId: user.id, enabled: true }, reason);
                  onChanged();
                },
              })}
            />
          )}
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <h3 className="workspace-mono-label">{t("spaces")}</h3>
        <DataTable
          label={t("spaces")}
          rows={user.spaces}
          rowId={(space) => space.space_id}
          empty={common("none")}
          columns={[
            {
              key: "space",
              header: t("colSpace"),
              cell: (space) => (
                <div className="flex flex-col">
                  <span>{space.space_name}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{space.space_type === "organization" ? common("organization") : common("personal")}</span>
                </div>
              ),
            },
            { key: "role", header: t("colRole"), cell: (space) => `${space.role}${space.status === "active" ? "" : ` (${space.status})`}` },
            {
              key: "plan",
              header: t("colPlan"),
              cell: (space) =>
                space.plan ? <StatusChip status={space.plan_status === "active" ? "ok" : "warn"}>{space.plan}</StatusChip> : t("free"),
            },
            { key: "projects", header: t("colProjects"), cell: (space) => space.projects },
            { key: "units", header: t("colUnits"), cell: (space) => space.units_this_month },
            ...(actions
              ? [
                  {
                    key: "actions",
                    header: t("colActions"),
                    cell: (space: UserRow["spaces"][number]) => (
                      <ChangePlanButton spaceId={space.space_id} spaceName={space.space_name} currentPlan={space.plan && space.plan_status === "active" ? space.plan : "personal_free"} plans={space.alternatives} onDone={onChanged} />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
    </Card>
  );
}

export default function UsersPage() {
  const t = useTranslations("users");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SectionResult<UserRow[]> | null>(null);

  const search = async (text: string) => {
    setError(null);
    if (text.length < 2) {
      setError(t("tooShort"));
      return;
    }
    setPending(true);
    try {
      setResult(await api<SectionResult<UserRow[]>>(`/api/users?q=${encodeURIComponent(text)}`));
    } catch (failure) {
      setError(failure instanceof ApiError && failure.message === "QUERY_TOO_SHORT" ? t("tooShort") : failure instanceof Error ? failure.message : "error");
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search(query.trim());
  };

  return (
    <>
      <PageHeading eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      <div className="admin-stack">
        <Form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <SearchField name="q" value={query} onChange={setQuery} className="min-w-64 flex-1">
            <Label>{t("searchLabel")}</Label>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("searchPlaceholder")} autoComplete="off" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Button type="submit" variant="primary" isPending={pending} isDisabled={pending}>
            <Search aria-hidden="true" size={16} />
            {pending ? t("searching") : t("search")}
          </Button>
        </Form>
        {error ? <FeedbackAlert status="danger">{error}</FeedbackAlert> : null}
        {result ? (
          <Section title={t("results")} result={result}>
            {(users) =>
              users.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  {t("empty")}
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {users.map((user) => (
                    <UserCard key={user.id} user={user} onChanged={() => void search(query.trim())} />
                  ))}
                </div>
              )
            }
          </Section>
        ) : null}
      </div>
    </>
  );
}
