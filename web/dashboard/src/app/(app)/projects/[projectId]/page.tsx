import { getTranslations } from "next-intl/server";
import ProjectDetail from "@/components/ProjectDetail";

export async function generateMetadata() {
  const t = await getTranslations("workspace");
  return { title: `${t("projectOverview")} · ML Box` };
}

export default async function ProjectDetailPage({ params }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  return <ProjectDetail projectId={projectId} />;
}
