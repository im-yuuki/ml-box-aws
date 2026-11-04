"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@heroui/react";
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
    return <section className="workspace-state-panel" aria-live="polite"><h2>{t("unavailableTitle")}</h2></section>;
  }

  if (loadState === "loading" || spacesLoading) {
    return <p className="workspace-muted-copy" role="status">{t("loading")}</p>;
  }

  if (loadState === "unauthenticated") {
    return (
      <section className="workspace-state-panel" aria-labelledby="teams-auth-title">
        <span className="workspace-section-index">{t("authSection")}</span>
        <h2 id="teams-auth-title">{t("unauthenticatedTitle")}</h2>
        <Link href="/login"><Button variant="primary">{t("signIn")}</Button></Link>
      </section>
    );
  }

  if (loadState === "unauthorized" || loadState === "unavailable") {
    return (
      <section className="workspace-state-panel" aria-live="polite">
        <h2>{loadState === "unauthorized" ? t("unauthorizedTitle") : t("unavailableTitle")}</h2>
        <Button variant="secondary" onPress={() => spaceId && void loadTeams(spaceId)}>{t("retry")}</Button>
      </section>
    );
  }

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;

  return (
    <div className="flex flex-col gap-8">
      <header className="workspace-page-heading">
        <div>
          <span className="workspace-section-index">{t("section")}</span>
          <h1>{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
        <Link href="/projects" className="workspace-count-label">{t("backToProjects")}</Link>
      </header>

      {activeSpace ? <InvitationsPanel space={activeSpace} /> : null}

      <section className="workspace-project-toolbar" aria-label={t("createTeam")}>
        <form className="workspace-create-form" onSubmit={createTeam}>
          <label className="sr-only" htmlFor="new-team-name">{t("teamName")}</label>
          <input id="new-team-name" value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder={t("teamNamePlaceholder")} />
          <Button type="submit" variant="primary" isPending={busy} isDisabled={busy}>{t("createTeam")}</Button>
        </form>
      </section>
      {teamError ? <p className="workspace-form-error" role="alert">{teamError}</p> : null}

      {teams.length === 0 ? (
        <section className="workspace-state-panel">
          <h2>{t("emptyTitle")}</h2>
          <p>{t("emptyBody")}</p>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          <ul aria-label={t("teamList")} className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <li key={team.id}>
                <Button variant={team.id === selectedTeamId ? "primary" : "secondary"} onPress={() => void selectTeam(team.id)}>
                  {team.name}
                </Button>
              </li>
            ))}
          </ul>

          {selectedTeam ? (
            <section className="workspace-state-panel" aria-labelledby="team-detail-title">
              <h2 id="team-detail-title">{selectedTeam.name}</h2>
              {membersError ? <p className="workspace-form-error" role="alert">{membersError}</p> : null}
              {members.length === 0 && !membersError ? <p>{t("noMembers")}</p> : null}
              <ul aria-label={t("memberList")} className="flex flex-col gap-2">
                {members.map((member) => (
                  <li key={member.userId} className="flex items-center justify-between gap-4">
                    <span>{memberLabel(member)} · {member.role === "lead" ? t("roleLead") : t("roleMember")}</span>
                    <Button variant="secondary" isDisabled={busy} onPress={() => void removeMember(member.userId)}>{t("remove")}</Button>
                  </li>
                ))}
              </ul>

              <form className="workspace-create-form" onSubmit={addMember}>
                <label className="sr-only" htmlFor="member-id">{t("memberId")}</label>
                <input id="member-id" value={memberId} onChange={(event) => setMemberId(event.target.value)} placeholder={t("memberIdPlaceholder")} />
                <label className="sr-only" htmlFor="member-role">{t("role")}</label>
                <select id="member-role" value={memberRole} onChange={(event) => setMemberRole(event.target.value)}>
                  <option value="member">{t("roleMember")}</option>
                  <option value="lead">{t("roleLead")}</option>
                </select>
                <Button type="submit" variant="primary" isPending={busy} isDisabled={busy}>{t("addMember")}</Button>
              </form>
              <p className="workspace-muted-copy">{t("memberIdHint")}</p>
              {memberError ? <p className="workspace-form-error" role="alert">{memberError}</p> : null}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
