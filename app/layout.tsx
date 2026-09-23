import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { LocaleProvider } from "../components/locale-provider";
import { LaunchAccessDialog } from "../components/demo-checkout";
import { SiteShell } from "../components/site-shell";
import { BEACON_SRC, webAnalyticsToken } from "../lib/analytics";
import { metadataForRoute } from "../lib/metadata";
import { SITE_ORIGIN, isInternationalLocale } from "../lib/seo";
import { COMPANY_CONTENT } from "../lib/company";
import "./globals.css";
import "./brand.css";
import "./brand-motion.css";
import "./shell.css";
import "./platform-story.css";
import "./service-pages.css";
import "./platform.css";
import "./model-detail.css";
import "./playground.css";
import "./integrations.css";
import "./portal.css";
import "./international.css";
import "./ai-workspace.css";
import "./agents.css";
import "./agent-builder.css";
import "./language-picker.css";
import "./brand-experience.css";
import "./tasks.css";
import "./promo-hero.css";
import "./agent-showcase.css";
import "./agent-platform.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Search Console token, supplied per deployment; never indexable pages' content. */
function siteVerification() {
  const token = process.env.SITE_VERIFICATION?.trim();
  return token && /^[A-Za-z0-9_-]{10,128}$/.test(token) ? token : null;
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const indexable = requestHeaders.get("x-pc-indexable") === "true";
  const verification = siteVerification();
  return {
    ...metadataForRoute("/"),
    metadataBase: new URL(SITE_ORIGIN),
    robots: { index: indexable, follow: indexable },
    icons: { icon: "/favicon.png", shortcut: "/favicon.png" },
    ...(verification ? { verification: { google: verification } } : {}),
  };
}

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_ORIGIN}/#organization`,
  name: "Power Champion",
  legalName: COMPANY_CONTENT.en.record.name,
  url: SITE_ORIGIN,
  logo: `${SITE_ORIGIN}/favicon.png`,
  email: COMPANY_CONTENT.en.contact.email,
  telephone: COMPANY_CONTENT.en.contact.phone,
  description: "Model API services and dedicated GPU infrastructure for AI development and deployment.",
};

const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_ORIGIN}/#website`,
  name: "Power Champion",
  url: SITE_ORIGIN,
  publisher: { "@id": `${SITE_ORIGIN}/#organization` },
  inLanguage: ["en", "zh-Hant", "zh-Hans", "ja", "ko"],
};

const SERVICE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebAPI",
  "@id": `${SITE_ORIGIN}/#api`,
  name: "Power Champion API",
  description:
    "OpenAI-compatible API for leading open AI models. Prepaid balance, one key, pay per use.",
  url: "https://powerchampion.ai",
  documentation: "https://powerchampion.ai/docs",
  termsOfService: "https://powerchampion.ai/terms",
  provider: { "@id": `${SITE_ORIGIN}/#organization` },
};

function StructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify([
          ORGANIZATION_JSON_LD,
          WEBSITE_JSON_LD,
          SERVICE_JSON_LD,
        ]).replace(/</g, "\\u003c"),
      }}
    />
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const requestedLanguage = requestHeaders.get("x-pc-language");
  const language = isInternationalLocale(requestedLanguage) ? requestedLanguage : "en";
  // Public pages only: signed-in workspaces and previews are never measured.
  const analytics = requestHeaders.get("x-pc-indexable") === "true" ? webAnalyticsToken() : null;
  return (
    <html lang={language}>
      <head>
        <StructuredData />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LocaleProvider>
          <SiteShell>{children}</SiteShell>
          <LaunchAccessDialog />
        </LocaleProvider>
        {analytics ? (
          <script
            defer
            src={BEACON_SRC}
            data-cf-beacon={JSON.stringify({ token: analytics })}
          />
        ) : null}
      </body>
    </html>
  );
}
