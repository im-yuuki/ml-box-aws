"use client";

import { useState } from "react";
import { Label, ListBox, Select } from "@heroui/react";
import { useTranslations } from "next-intl";
import ActionButton from "@/components/ActionButton";
import { sendAction } from "@/lib/actions";

/** Moves a Space to another plan of its own type. Used from the billing page and from the user lookup. */
export default function ChangePlanButton({
  spaceId,
  spaceName,
  currentPlan,
  plans,
  onDone,
}: {
  spaceId: string;
  spaceName: string;
  currentPlan: string;
  plans: string[];
  onDone: () => void;
}) {
  const t = useTranslations("actions.changePlan");
  const names = useTranslations("billing.plans");
  const [planId, setPlanId] = useState<string>(plans.find((plan) => plan !== currentPlan) ?? plans[0] ?? "");
  if (plans.length === 0) return null;

  return (
    <ActionButton
      trigger={t("trigger")}
      build={() => ({
        title: t("title", { space: spaceName }),
        confirm: t("confirm"),
        body: (
          <div className="flex flex-col gap-3">
            <p>{t("body")}</p>
            <Select selectedKey={planId} onSelectionChange={(key) => key !== null && setPlanId(String(key))} aria-label={t("planLabel")} className="w-full">
              <Label>{t("planLabel")}</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {plans.map((plan) => (
                    <ListBox.Item key={plan} id={plan} textValue={names(plan as "personal_free")}>
                      {names(plan as "personal_free")}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        ),
        run: async (reason) => {
          await sendAction("/api/actions/space/plan", { spaceId, planId }, reason);
          onDone();
        },
      })}
    />
  );
}
