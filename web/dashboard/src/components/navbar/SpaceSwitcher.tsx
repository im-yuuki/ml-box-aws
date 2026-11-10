"use client";

import { useState } from "react";
import { Dropdown } from "@heroui/react";
import { Building2, Check, ChevronDown, Plus, User } from "lucide-react";
import { useTranslations } from "next-intl";
import CreateOrganizationDialog from "@/components/navbar/CreateOrganizationDialog";
import { useActiveSpace } from "@/hooks/useActiveSpace";
import type { SpaceSummary } from "@/lib/spaces";

const NONE_KEY = "__none__";
const CREATE_KEY = "__create_organization__";

/**
 * Workspace (Space) switcher. One account can belong to many organizations, so
 * the trigger shows the current Space and the menu lists every Space the user
 * can access: the personal one first, then each organization with the user's role.
 */
export default function SpaceSwitcher() {
  const t = useTranslations("navbar");
  const { spaces, activeSpace, loading, failed, setActiveSpaceId } = useActiveSpace();
  const [createOpen, setCreateOpen] = useState(false);

  if (loading) return <span className="workspace-space-placeholder" aria-hidden="true" />;
  // Show the failure instead of hiding the switcher, so the user knows why their Spaces are missing.
  if (failed) {
    return (
      <span className="workspace-space-trigger" role="status" title={t("spacesUnavailable")}>
        <Building2 aria-hidden="true" size={15} />
        <span className="workspace-space-trigger-name">{t("spacesUnavailable")}</span>
      </span>
    );
  }
  if (!activeSpace) return null;

  const personal = spaces.filter((space) => space.type === "personal");
  const organizations = spaces.filter((space) => space.type === "organization");
  const ActiveIcon = activeSpace.type === "personal" ? User : Building2;

  const onAction = (key: string | number) => {
    if (String(key) === CREATE_KEY) {
      setCreateOpen(true);
      return;
    }
    if (String(key) !== NONE_KEY) setActiveSpaceId(String(key));
  };

  // Personal Space is shown with the localized label; organizations keep their own name.
  const displayName = (space: SpaceSummary) => (space.type === "personal" ? t("personal") : space.name);

  const renderItem = (space: SpaceSummary) => (
    <Dropdown.Item key={space.id} id={space.id} textValue={displayName(space)}>
      {space.type === "personal" ? <User aria-hidden="true" size={16} /> : <Building2 aria-hidden="true" size={16} />}
      <span className="workspace-space-item-text">
        <span className="workspace-space-item-name">{displayName(space)}</span>
        {space.type === "organization" ? <span className="workspace-space-item-meta">{t(`roles.${space.role}`)}</span> : null}
      </span>
      {space.id === activeSpace.id ? <Check aria-hidden="true" size={14} className="ml-auto" /> : null}
    </Dropdown.Item>
  );

  return (
    <>
    <Dropdown>
      <Dropdown.Trigger className="workspace-space-trigger" aria-label={t("switchSpace")}>
        <ActiveIcon aria-hidden="true" size={15} />
        <span className="workspace-space-trigger-name">{displayName(activeSpace)}</span>
        <ChevronDown aria-hidden="true" size={14} />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom start" className="workspace-space-popover">
        <Dropdown.Menu
          aria-label={t("switchSpace")}
          selectionMode="single"
          selectedKeys={[activeSpace.id]}
          onAction={onAction}
        >
          {personal.map(renderItem)}
          {organizations.map(renderItem)}
          {organizations.length === 0 ? (
            <Dropdown.Item id={NONE_KEY} textValue={t("noOrganizations")} isDisabled>
              <span className="workspace-space-item-meta">{t("noOrganizations")}</span>
            </Dropdown.Item>
          ) : null}
          <Dropdown.Item id={CREATE_KEY} textValue={t("createOrganization")}>
            <Plus aria-hidden="true" size={16} />
            <span className="workspace-space-item-name">{t("createOrganization")}</span>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
    <CreateOrganizationDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
