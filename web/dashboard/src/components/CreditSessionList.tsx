"use client";

import { Card } from "@heroui/react";
import { useTranslations } from "next-intl";

export type CreditSession = {
  id: string;
  projectName: string;
  startedAt: string;
  endedAt: string | null;
  hours: number;
  credits: number;
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/** Every sandbox session of the last 30 days, with the credits it used. */
export default function CreditSessionList({ sessions }: { sessions: CreditSession[] }) {
  const t = useTranslations("usage");
  const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

  return (
    <section aria-labelledby="credit-sessions-heading" className="flex flex-col gap-4">
      <h2 id="credit-sessions-heading" className="text-lg font-semibold">{t("creditSessionsHeading")}</h2>
      <Card className="p-5">
        {sessions.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>{t("creditSessionsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th scope="col" className="py-2 pr-4 font-medium">{t("colProject")}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t("colStarted")}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t("colDuration")}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t("colCredits")}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="max-w-[16rem] truncate py-2 pr-4">{session.projectName}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(session.startedAt)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {session.endedAt ? t("durationHours", { hours: numbers.format(session.hours) }) : t("sessionRunning")}
                    </td>
                    <td className="py-2 text-right font-medium">{numbers.format(session.credits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
