import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AdminGate from "@/components/AdminGate";
import SessionProvider from "@/components/SessionProvider";
import Toaster from "@/components/Toaster";
import LocaleProvider from "@/i18n/LocaleProvider";
import "./globals.css";

const geistSans = Geist({ subsets: ["latin", "vietnamese"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "MLBox — Admin",
  description: "MLBox operations console",
  robots: { index: false, follow: false },
};

/** Apply [data-theme] before paint so HeroUI and the token file line up. Same script as the dashboard. */
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-full flex flex-col">
        <LocaleProvider>
          <SessionProvider>
            <AdminGate>{children}</AdminGate>
          </SessionProvider>
          <Toaster />
        </LocaleProvider>
      </body>
    </html>
  );
}
