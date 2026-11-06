import type { ReactNode } from "react";
import AccountSubnav from "@/components/AccountSubnav";

/** Settings area: each group (profile, subscription, quota) is its own page, with a shared switcher. */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <AccountSubnav />
      {children}
    </div>
  );
}
