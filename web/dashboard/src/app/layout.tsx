import type { Metadata } from "next";
import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "ML Box — Dashboard",
  description: "ML Box dashboard: sandboxes, usage, account",
};

/** Apply [data-theme] before paint so HeroUI + the token file line up. */
const themeBootstrap = `
(function () {
  try {
    var stored = localStorage.getItem('mlbox-theme');
    var dark = stored === 'dark'
      ? true
      : stored === 'light'
        ? false
        : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

async function IntlBoundary({ children }: { children: React.ReactNode }) {
  // getLocale reads the cookie → request-time; wrapped in Suspense in the
  // root layout so Next.js can prerender the rest of the shell and stream
  // the intl provider + children on the first request.
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}>
          <IntlBoundary>{children}</IntlBoundary>
        </Suspense>
      </body>
    </html>
  );
}
