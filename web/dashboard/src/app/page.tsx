import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Boxes, Building2, Gauge, FolderKanban } from "lucide-react";
import { Button, Chip, ProgressBar } from "@heroui/react";
import LocaleSwitcher from "@/components/LocaleSwitcher";

export default async function Home() {
  const t = await getTranslations("home");
  const tCommon = await getTranslations("common");

  const features = [
    { key: "projects", Icon: FolderKanban },
    { key: "quota", Icon: Gauge },
    { key: "organizations", Icon: Building2 },
  ] as const;

  return (
    <div className="public-frame">
      <header className="public-header">
        <Link href="/" className="workspace-brand" aria-label={tCommon("homeLabel")}>
          <span className="workspace-brand-mark" aria-hidden="true"><Boxes size={18} strokeWidth={2} /></span>
          <span className="workspace-brand-copy"><strong>{tCommon("appName")}</strong></span>
        </Link>
        <LocaleSwitcher />
      </header>

      <main className="public-main">
        <div className="landing-grid">
          <div className="flex flex-col">
            <h1 className="landing-title">{t("title")}</h1>
            <div className="landing-actions">
              <Link href="/login"><Button variant="primary" size="lg">{t("signIn")}</Button></Link>
              <Link href="/register"><Button variant="secondary" size="lg">{t("createAccount")}</Button></Link>
            </div>
            <ul className="landing-features">
              {features.map(({ key, Icon }) => (
                <li key={key} className="landing-feature">
                  <Icon aria-hidden="true" size={18} className="landing-feature-icon" />
                  <div>
                    <h2>{t(`features.${key}.title`)}</h2>
                    
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <figure className="landing-preview" aria-label={t("previewLabel")}>
            <figcaption className="landing-preview-head">
              <span>{t("previewLabel")}</span>
              <span>{t("previewNote")}</span>
            </figcaption>
            <div className="landing-preview-body">
              <ul className="workspace-project-list">
                <li className="workspace-project-row">
                  <div className="min-w-0">
                    <span className="workspace-project-row-name">{t("previewProjectOne")}</span>
                    <div className="workspace-project-row-meta">Core · <code>proj_example_a</code></div>
                  </div>
                  <div className="workspace-runtime">
                    <Chip size="sm" variant="soft" color="success">{t("previewRunning")}</Chip>
                  </div>
                  <span className="workspace-project-row-open" aria-hidden="true" />
                </li>
                <li className="workspace-project-row">
                  <div className="min-w-0">
                    <span className="workspace-project-row-name">{t("previewProjectTwo")}</span>
                    <div className="workspace-project-row-meta">ML · <code>proj_example_b</code></div>
                  </div>
                  <div className="workspace-runtime">
                    <Chip size="sm" variant="soft" color="default">{t("previewStopped")}</Chip>
                  </div>
                  <span className="workspace-project-row-open" aria-hidden="true" />
                </li>
              </ul>
              <div className="landing-preview-meter">
                <div className="workspace-meter-head">
                  <span>RAM</span>
                  <span className="workspace-meter-value">4 / 24 GB</span>
                </div>
                <ProgressBar aria-label="RAM" value={17} size="sm">
                  <ProgressBar.Track>
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>
              </div>
            </div>
          </figure>
        </div>
      </main>
    </div>
  );
}
