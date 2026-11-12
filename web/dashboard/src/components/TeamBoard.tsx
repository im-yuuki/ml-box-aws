"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, Card, Spinner } from "@heroui/react";
import { ArrowLeft, Building2, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import InvitationsPanel from "@/components/InvitationsPanel";
import OrganizationMembers from "@/components/OrganizationMembers";
import OrganizationDangerZone from "@/components/OrganizationDangerZone";
import CardSectionTitle from "@/components/CardSectionTitle";
import { useActiveSpace } from "@/hooks/useActiveSpace";

/**
 * The Teams page of the selected organization. An organization is one flat team: its members, the
 * invitations to add more, and (for the creator) deleting it. A personal Space has no team, so the
 * page offers the teams of the user instead of sending them back to the projects.
 */
export default function TeamBoard() {
  const t = useTranslations("teams");
  const tNavbar = useTranslations("navbar");
  const { activeSpace, spaces, loading, failed, reload, setActiveSpaceId } = useActiveSpace();
  const teams = spaces.filter((space) => space.type === "organization");

  const header = (
    <header className="workspace-page-heading">
      <div className="flex flex-col gap-1">
        {activeSpace ? <p className="workspace-eyebrow">{activeSpace.name}</p> : null}
        <h1>{t("title")}</h1>
        <p className="workspace-muted-copy max-w-2xl">{t("subtitle")}</p>
      </div>
      <Link href="/projects" className="workspace-count-label inline-flex items-center gap-1.5"><ArrowLeft aria-hidden="true" size={13} />{t("backToProjects")}</Link>
    </header>
  );

  useEffect(() => {
    // The page belongs to a team. When the selected Space is the personal one, the first team of
    // the user is selected, so the page always shows a team.
    if (activeSpace?.type === "personal" && teams.length > 0) setActiveSpaceId(teams[0].id);
  }, [activeSpace, teams, setActiveSpaceId]);

  if (activeSpace?.type === "personal") {
    if (teams.length === 0) {
      return (
        <div className="flex flex-col gap-8">
          {header}
          <Card className="p-6">
            <h2>{t("noTeamsTitle")}</h2>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{t("noTeamsBody")}</p>
            <Link href="/projects" className="mt-4 inline-block">
              <Button variant="secondary">
                <ArrowLeft aria-hidden="true" size={16} />
                {t("backToProjects")}
              </Button>
            </Link>
          </Card>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-8">
        {header}
        <Card className="p-6">
          <h2>{t("chooseTeamTitle")}</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {teams.map((team) => (
              <li key={team.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md border p-3 text-left"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => setActiveSpaceId(team.id)}>
                  <Building2 aria-hidden="true" size={16} />
                  <span className="font-medium">{team.name}</span>
                  <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
                    {tNavbar(`roles.${team.role}`)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm" role="status"><Spinner size="sm" /><span>{t("loading")}</span></div>;
  }

  if (failed || !activeSpace) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <Card aria-live="polite">
          <Card.Header>
            <CardSectionTitle>{t("unavailableTitle")}</CardSectionTitle>
          </Card.Header>
          <Card.Content>
            <Button variant="secondary" onPress={reload}><RotateCcw aria-hidden="true" size={16} />{t("retry")}</Button>
          </Card.Content>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {header}
      <div className="workspace-detail-main">
        <OrganizationMembers space={activeSpace} />
        <InvitationsPanel space={activeSpace} />
        {activeSpace.role === "owner" ? <OrganizationDangerZone space={activeSpace} /> : null}
      </div>
    </div>
  );
}
