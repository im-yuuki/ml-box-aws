"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Alert, Button, Card, Form, Input, ListBox, Select, Spinner, TextField } from "@heroui/react";
import { ArrowLeft, LogIn, Plus, RotateCcw, UserMinus, UserPlus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { bffFetch } from "@/lib/bffFetch";
import { useActiveSpace } from "@/hooks/useActiveSpace";
import InvitationsPanel from "@/components/InvitationsPanel";
import {
  classifyTeamResponse,
  memberLabel,
  parseTeamRole,
  validateMemberId,
  validateTeamName,
  type TeamListResponse,
  type TeamLoadState,
  type TeamMemberListResponse,
  type TeamMemberRecord,
  type TeamRecord,
} from "@/lib/teams";

export default function TeamBoard() {
  const t = useTranslations("teams");
  const { activeSpace, loading: spacesLoading, failed: spacesFailed } = useActiveSpace();
  const spaceId = activeSpace?.id ?? null;
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [loadState, setLoadState] = useState<TeamLoadState | "loading">("loading");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMemberRecord[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamError, setTeamError] = useState<string | null>(null);
  const [memberId, setMemberId] = useState("");
  const [memberRole, setMemberRole] = useState("member");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadMembers = useCallback(async (space: string, teamId: string) => {
    setMembersError(null);
    const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(space)}/teams/${encodeURIComponent(teamId)}/members`, { cache: "no-store" });
    if (!response.ok) {
      setMembersError(t("membersLoadFailed"));
      setMembers([]);
      return;
    }
    const body = await response.json() as TeamMemberListResponse;
    setMembers(Array.isArray(body.members) ? body.members : []);
  }, [t]);

  const loadTeams = useCallback(async (space: string) => {
    setLoadState("loading");
    setSelectedTeamId(null);
    setMembers([]);
    try {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(space)}/teams`, { cache: "no-store" });
      setLoadState(classifyTeamResponse(response.status));
      if (!response.ok) return;
      const body = await response.json() as TeamListResponse;
      setTeams(Array.isArray(body.teams) ? body.teams : []);
    } catch {
      setLoadState("unavailable");
    }
  }, []);

  useEffect(() => {
    if (!spaceId) return;
    const task = window.setTimeout(() => void loadTeams(spaceId), 0);
    return () => window.clearTimeout(task);
  }, [spaceId, loadTeams]);

  const selectTeam = async (teamId: string) => {
    setSelectedTeamId(teamId);
    setMemberError(null);
    if (spaceId) await loadMembers(spaceId, teamId);
  };

  const createTeam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTeamError(null);
    const validated = validateTeamName(teamName);
    if (!validated.ok || !spaceId) {
      setTeamError(t("teamNameRequired"));
      return;
    }
    setBusy(true);
    try {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(spaceId)}/teams`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: validated.value }),
      });
      if (!response.ok) {
        setTeamError(response.status === 403 ? t("teamCreateForbidden") : t("teamCreateFailed"));
        return;
      }
      setTeamName("");
      await loadTeams(spaceId);
    } finally {
      setBusy(false);
    }
  };

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMemberError(null);
    const validated = validateMemberId(memberId);
    const role = parseTeamRole(memberRole);
    if (!validated.ok || !role || !spaceId || !selectedTeamId) {
      setMemberError(t("memberIdRequired"));
      return;
    }
    setBusy(true);
    try {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(spaceId)}/teams/${encodeURIComponent(selectedTeamId)}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: validated.value, role }),
      });
      if (!response.ok) {
        setMemberError(response.status === 403 ? t("memberForbidden") : t("memberAddFailed"));
        return;
      }
      setMemberId("");
      await loadMembers(spaceId, selectedTeamId);
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!spaceId || !selectedTeamId) return;
    setMemberError(null);
    setBusy(true);
    try {
      const response = await bffFetch(`/api/bff/spaces/${encodeURIComponent(spaceId)}/teams/${encodeURIComponent(selectedTeamId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
      if (!response.ok) {
        setMemberError(response.status === 403 ? t("memberForbidden") : t("memberRemoveFailed"));
        return;
      }
      await loadMembers(spaceId, selectedTeamId);
    } finally {
      setBusy(false);
    }
  };

  if (spacesFailed) {
    return <Card className="p-6" aria-live="polite"><h2>{t("unavailableTitle")}</h2></Card>;
  }

  if (loadState === "loading" || spacesLoading) {
    return <div className="flex items-center gap-2 text-sm" role="status"><Spinner size="sm" /><span>{t("loading")}</span></div>;
  }

  if (loadState === "unauthenticated") {
    return (
      <Card className="p-6" aria-labelledby="teams-auth-title">
        <h2 id="teams-auth-title">{t("unauthenticatedTitle")}</h2>
        <Link href="/login"><Button variant="primary"><LogIn aria-hidden="true" size={16} />{t("signIn")}</Button></Link>
      </Card>
    );
  }

  if (loadState === "unauthorized" || loadState === "unavailable") {
    return (
      <Card className="p-6" aria-live="polite">
        <h2>{loadState === "unauthorized" ? t("unauthorizedTitle") : t("unavailableTitle")}</h2>
        <Button variant="secondary" onPress={() => spaceId && void loadTeams(spaceId)}><RotateCcw aria-hidden="true" size={16} />{t("retry")}</Button>
      </Card>
    );
  }

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;

  return (
    <div className="flex flex-col gap-8">
      <header className="workspace-page-heading">
        <div>
          <h1>{t("title")}</h1>
        </div>
        <Link href="/projects" className="workspace-count-label inline-flex items-center gap-1.5"><ArrowLeft aria-hidden="true" size={13} />{t("backToProjects")}</Link>
      </header>

      {activeSpace ? <InvitationsPanel space={activeSpace} /> : null}

      <section className="workspace-project-toolbar" aria-label={t("createTeam")}>
        <Form className="flex flex-wrap items-end gap-3" onSubmit={createTeam}>
          <TextField value={teamName} onChange={setTeamName} aria-label={t("teamName")} className="min-w-64">
            <Input placeholder={t("teamNamePlaceholder")} variant="secondary" fullWidth />
          </TextField>
          <Button type="submit" variant="primary" isPending={busy} isDisabled={busy}><Plus aria-hidden="true" size={16} />{t("createTeam")}</Button>
        </Form>
      </section>
      {teamError ? <Alert status="danger"><Alert.Content><Alert.Description>{teamError}</Alert.Description></Alert.Content></Alert> : null}

      {teams.length === 0 ? (
        <Card className="p-6">
          <h2>{t("emptyTitle")}</h2>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <ul aria-label={t("teamList")} className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <li key={team.id}>
                <Button variant={team.id === selectedTeamId ? "primary" : "secondary"} onPress={() => void selectTeam(team.id)}>
                  <Users aria-hidden="true" size={16} />
                  {team.name}
                </Button>
              </li>
            ))}
          </ul>

          {selectedTeam ? (
            <Card className="p-6" aria-labelledby="team-detail-title">
              <h2 id="team-detail-title">{selectedTeam.name}</h2>
              {membersError ? <Alert status="danger"><Alert.Content><Alert.Description>{membersError}</Alert.Description></Alert.Content></Alert> : null}
              {members.length === 0 && !membersError ? <p>{t("noMembers")}</p> : null}
              <ul aria-label={t("memberList")} className="flex flex-col gap-2">
                {members.map((member) => (
                  <li key={member.userId} className="flex items-center justify-between gap-4">
                    <span>{memberLabel(member)} · {member.role === "lead" ? t("roleLead") : t("roleMember")}</span>
                    <Button variant="secondary" isDisabled={busy} onPress={() => void removeMember(member.userId)}><UserMinus aria-hidden="true" size={16} />{t("remove")}</Button>
                  </li>
                ))}
              </ul>

              <Form className="flex flex-wrap items-end gap-3" onSubmit={addMember}>
                <TextField value={memberId} onChange={setMemberId} aria-label={t("memberId")} className="min-w-64">
                  <Input placeholder={t("memberIdPlaceholder")} variant="secondary" fullWidth />
                </TextField>
                <Select selectedKey={memberRole} onSelectionChange={(key) => key && setMemberRole(String(key))} aria-label={t("role")} className="w-40">
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="member" textValue={t("roleMember")}>{t("roleMember")}<ListBox.ItemIndicator /></ListBox.Item>
                      <ListBox.Item id="lead" textValue={t("roleLead")}>{t("roleLead")}<ListBox.ItemIndicator /></ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Button type="submit" variant="primary" isPending={busy} isDisabled={busy}><UserPlus aria-hidden="true" size={16} />{t("addMember")}</Button>
              </Form>
              {memberError ? <Alert status="danger"><Alert.Content><Alert.Description>{memberError}</Alert.Description></Alert.Content></Alert> : null}
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
