import type { ReactNode } from "react";

/**
 * The title of a card.
 *
 * HeroUI's Card.Title always renders an h3, so a page that starts with an h1 (the page heading)
 * and then puts its cards under it jumps from h1 to h3. Screen readers announce the level, so the
 * jump breaks the outline of the page. This renders an h2 with the same look.
 */
export default function CardSectionTitle({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <h2 id={id} className={className ? `card__title ${className}` : "card__title"}>
      {children}
    </h2>
  );
}
