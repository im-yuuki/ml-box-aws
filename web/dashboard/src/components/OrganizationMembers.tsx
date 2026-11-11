"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar, Button, Card, Chip, ListBox, Modal, Select, Spinner } from "@heroui/react";
import { Crown, UserMinus } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import FeedbackAlert from "@/components/FeedbackAlert";
import { notifySpacesChanged, type SpaceRole, type SpaceSummary } from "@/lib/spaces";

export type OrganizationMember = { userId: string; role: SpaceRole; email: string | null };
type MemberListResponse = { role?: SpaceRole | null; members?: OrganizationMember[] };

// Mirrors the BFF rules (space-rules.ts). The server decides; these only hide actions that would fail.
function canManage(actor: SpaceRole | null): boolean {
  return actor === "owner" || actor === "admin";
}

function canRemove(actor: SpaceRole | null, target: SpaceRole): boolean {
  if (target === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && target !== "admin";
}

const ROLE_KEYS: Record<SpaceRole, string> = {
  owner: "roleOwner",
  admin: "roleAdmin",
  member: "roleMember",
  viewer: "roleViewer",
};

/** Members of the selected organization. Owners and admins manage roles; the owner can hand over ownership. */
export default function OrganizationMembers({ space }: { space: SpaceSummary }) {
  const t = useTranslations("teams");
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [actor, setActor] = useState<SpaceRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState<OrganizationMember | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OrganizationMember | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(space.id)}/members`, { cache: "no-store" });
      if (!response.ok) {
        setError(t("membersLoadFailed"));
        return;
      }
      const body = (await response.json()) as MemberListResponse;
      setActor(body.role ?? null);
      setMembers(Array.isArray(body.members) ? body.members : []);
    } catch {
      setError(t("membersLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [space.id, t]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  // Runs one member action; a failed response maps to a localized message.
  const run = async (request: () => Promise<Response>, failedKey: string, doneKey?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await request();
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(t(body.error === "FORBIDDEN" ? "memberForbidden" : failedKey));
        return false;
      }
      if (doneKey) setNotice(t(doneKey));
      await load();
      return true;
    } catch {
      setError(t(failedKey));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeRole = (member: OrganizationMember, role: string) => {
    if (role === member.role) return;
    void run(
      () => bffFetch(`/api/bff/spaces/${encodeURIComponent(space.id)}/members/${encodeURIComponent(member.userId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      }),
      "roleChangeFailed",
      "roleChanged",
    );
  };

  const remove = (member: OrganizationMember, close: () => void) =>
    run(
      () => bffFetch(`/api/bff/spaces/${encodeURIComponent(space.id)}/members/${encodeURIComponent(member.userId)}`, { method: "DELETE" }),
      "memberRemoveFailed",
      "memberRemoved",
    ).then((ok) => {
      if (ok) close();
    });

  const transfer = async (member: OrganizationMember, close: () => void) => {
    const ok = await run(
      () => bffFetch(`/api/bff/spaces/${encodeURIComponent(space.id)}/transfer-ownership`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: member.userId }),
      }),
      "transferFailed",
      "ownershipTransferred",
    );
    if (ok) {
      // The owner becomes an admin, so the workspace switcher has to learn the new role.
      notifySpacesChanged();
      close();
    }
  };

  const label = (member: OrganizationMember) => member.email ?? member.userId;

  return (
    <Card aria-labelledby="org-members-title">
      <Card.Header>
        <Card.Title id="org-members-title">{t("orgMembersTitle")}</Card.Title>
        <Card.Description>{t("orgMembersHint")}</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm" role="status"><Spinner size="sm" /><span>{t("loading")}</span></div>
        ) : (
          <ul aria-label={t("orgMembersTitle")} className="flex flex-col divide-y">
            {members.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar size="sm">
                    <Avatar.Fallback>{label(member).charAt(0).toUpperCase()}</Avatar.Fallback>
                  </Avatar>
                  <span className="truncate text-sm" title={label(member)}>
                    {label(member)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {member.role === "owner" ? (
                    <Chip size="sm" variant="soft" color="accent">
                      <Crown aria-hidden="true" size={12} />
                      {t(ROLE_KEYS.owner)}
                    </Chip>
                  ) : canManage(actor) ? (
                    <Select
                      selectedKey={member.role}
                      onSelectionChange={(key) => key && changeRole(member, String(key))}
                      aria-label={`${t("role")}: ${label(member)}`}
                      isDisabled={busy}
                      className="w-36">
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {/* The admin role stays visible for every manager: only the owner can hand
                              it out, but an admin that cannot see their own role reads an empty
                              dropdown. */}
                          <ListBox.Item id="admin" textValue={t(ROLE_KEYS.admin)} isDisabled={actor !== "owner"}>
                            {t(ROLE_KEYS.admin)}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                          <ListBox.Item id="member" textValue={t(ROLE_KEYS.member)}>{t(ROLE_KEYS.member)}<ListBox.ItemIndicator /></ListBox.Item>
                          <ListBox.Item id="viewer" textValue={t(ROLE_KEYS.viewer)}>{t(ROLE_KEYS.viewer)}<ListBox.ItemIndicator /></ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  ) : (
                    <Chip size="sm" variant="soft">{t(ROLE_KEYS[member.role])}</Chip>
                  )}

                  {actor === "owner" && member.role === "admin" ? (
                    <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => setTransferTo(member)}>
                      {t("transferOwnership")}
                    </Button>
                  ) : null}

                  {canRemove(actor, member.role) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      aria-label={`${t("remove")}: ${label(member)}`}
                      isDisabled={busy}
                      onPress={() => setRemoveTarget(member)}>
                      <UserMinus aria-hidden="true" size={16} />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {notice ? <FeedbackAlert status="success">{notice}</FeedbackAlert> : null}
        {error ? <FeedbackAlert status="danger">{error}</FeedbackAlert> : null}
      </Card.Content>

      <Modal isOpen={removeTarget !== null} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              {({ close }) => (
                <>
                  <Modal.Header>
                    <Modal.Heading>{t("removeTitle", { name: removeTarget ? label(removeTarget) : "" })}</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body className="flex flex-col gap-3">
                    <p className="text-sm">{t("removeBody")}</p>
                  </Modal.Body>
                  <Modal.Footer className="flex justify-end gap-2">
                    <Button variant="tertiary" onPress={close}>{t("cancel")}</Button>
                    <Button
                      variant="danger"
                      isPending={busy}
                      isDisabled={busy || !removeTarget}
                      onPress={() => {
                        if (removeTarget) void remove(removeTarget, close);
                      }}>
                      {t("removeAction")}
                    </Button>
                  </Modal.Footer>
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal isOpen={transferTo !== null} onOpenChange={(open) => { if (!open) setTransferTo(null); }}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              {({ close }) => (
                <>
                  <Modal.Header>
                    <Modal.Heading>{t("transferTitle", { name: transferTo ? label(transferTo) : "" })}</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body className="flex flex-col gap-3">
                    <p className="text-sm">{t("transferBody")}</p>
                  </Modal.Body>
                  <Modal.Footer className="flex justify-end gap-2">
                    <Button variant="tertiary" onPress={close}>{t("cancel")}</Button>
                    <Button
                      variant="danger"
                      isPending={busy}
                      isDisabled={busy || !transferTo}
                      onPress={() => transferTo && void transfer(transferTo, close)}>
                      {t("transferAction")}
                    </Button>
                  </Modal.Footer>
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Card>
  );
}
