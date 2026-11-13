import { Package } from "lucide-react";

/** The MLBox logo mark used across the app. Same artwork as public/logo.svg (the favicon). */
export default function BrandMark() {
  return (
    <span className="workspace-brand-mark" aria-hidden="true">
      <Package size={18} strokeWidth={2} />
    </span>
  );
}
