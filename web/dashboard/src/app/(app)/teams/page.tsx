import { getTranslations } from "next-intl/server";
import TeamBoard from "@/components/TeamBoard";

export async function generateMetadata() {
  const t = await getTranslations("teams");
  return { title: `${t("title")} · MLBox` };
}

export default function TeamsPage() {
  return <TeamBoard />;
}
