import type { Locale } from "@/i18n/config";

/**
 * Inline SVG flags for the locale switcher. Inline (not emoji) so they render
 * the same on Windows, where regional-indicator emoji show as letter pairs.
 */
export default function LocaleFlag({ locale, className }: { locale: Locale; className?: string }) {
  const frame = `overflow-hidden rounded-[2px] ring-1 ring-black/10 ${className ?? ""}`;

  if (locale === "vi") {
    return (
      <svg viewBox="0 0 30 20" aria-hidden="true" focusable="false" className={frame}>
        <rect width="30" height="20" fill="#DA251D" />
        <polygon
          fill="#FFFF00"
          points="15,4 16.47,7.98 20.7,8.1 17.38,10.77 18.5,14.9 15,12.5 11.5,14.9 12.62,10.77 9.3,8.1 13.53,7.98"
        />
      </svg>
    );
  }

  // United Kingdom (Union Jack) — used for English.
  return (
    <svg viewBox="0 0 60 30" aria-hidden="true" focusable="false" className={frame} preserveAspectRatio="none">
      <clipPath id="uk-flag-clip-s">
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <clipPath id="uk-flag-clip-t">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g clipPath="url(#uk-flag-clip-s)">
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#uk-flag-clip-t)" stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}
