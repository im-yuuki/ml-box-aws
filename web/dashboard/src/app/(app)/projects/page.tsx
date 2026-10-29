import { getTranslations } from "next-intl/server";
import ProjectBoard from "@/components/ProjectBoard";

export async function generateMetadata() {
  const t = await getTranslations("workspace");
  return { title: `${t("projectsTitle")} · ML Box` };
}

export default function ProjectsPage() {
  return <ProjectBoard />;
}
