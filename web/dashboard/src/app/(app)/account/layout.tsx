import type { ReactNode } from "react";

/** Account pages (profile, subscription, quota, security) are opened independently from the avatar menu. */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}
