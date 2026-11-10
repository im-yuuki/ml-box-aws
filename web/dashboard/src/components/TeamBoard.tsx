"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Spinner } from "@heroui/react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import InvitationsPanel from "@/components/InvitationsPanel";
import OrganizationMembers from "@/components/OrganizationMembers";
import OrganizationDangerZone from "@/components/OrganizationDangerZone";
import { useActiveSpace } from "@/hooks/useActiveSpace";

/**
 * The Teams page of the selected organization. An organization is one flat team: its members, the
 * invitations to add more, and (for the creator) deleting it. Personal Spaces have no Teams page.
 */
export default function TeamBoard() {
  const t = useTranslations("teams");
  const router = useRouter();
  const { activeSpace, loading, failed, reload } = useActiveSpace();

  useEffect(() => {
    if (activeSpace?.type === "personal") router.replace("/projects");
  }, [activeSpace, router]);

  if (activeSpace?.type === "personal") return null;

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

  if (loading) {
    return <div className="flex items-center gap-2 text-sm" role="status"><Spinner size="sm" /><span>{t("loading")}</span></div>;
  }

  if (failed || !activeSpace) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <Card aria-live="polite">
          <Card.Header>
            <Card.Title>{t("unavailableTitle")}</Card.Title>
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
