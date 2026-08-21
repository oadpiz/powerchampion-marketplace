import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { LocaleProvider } from "../components/locale-provider";
import { LaunchAccessDialog } from "../components/demo-checkout";
import { SiteShell } from "../components/site-shell";
import { metadataForRoute } from "../lib/metadata";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function metadataOrigin(host: string | null): URL {
  const requestedHost = host?.split(",", 1)[0]?.trim().toLowerCase();
  if (!requestedHost || /[\s/@\\?#%]/.test(requestedHost)) return new URL("http://localhost");

  const bracketed = requestedHost.match(/^\[([0-9a-f:.]+)](?::(\d+))?$/);
  const named = requestedHost.match(/^([^:]+)(?::(\d+))?$/);
  if (!bracketed && !named) return new URL("http://localhost");

  const hostname = bracketed?.[1] ?? named?.[1] ?? "";
  const port = bracketed?.[2] ?? named?.[2];
  if (port && (Number(port) < 1 || Number(port) > 65535)) return new URL("http://localhost");

  const dnsHostname = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  const isIpv4 = /^\d+(?:\.\d+){3}$/.test(hostname)
    && hostname.split(".").every((part) => Number(part) <= 255);
  const isIpv6 = Boolean(bracketed) && hostname.includes(":");
  const isDns = dnsHostname.length > 0 && dnsHostname.length <= 253
    && dnsHostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!isIpv4 && !isIpv6 && !isDns) return new URL("http://localhost");

  try {
    const scheme = dnsHostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
      ? "http"
      : "https";
    return new URL(`${scheme}://${requestedHost}`);
  } catch {
    return new URL("http://localhost");
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  return {
    ...metadataForRoute("/"),
    metadataBase: metadataOrigin(host),
    twitter: {
      card: "summary_large_image",
      title: "OpenAI-compatible API · Live.",
      description: "One OpenAI-compatible endpoint for leading open AI models. Live API, prepaid balance, one key.",
      images: ["/og.png"],
    },
    icons: {
      icon: "/favicon.png",
      shortcut: "/favicon.png",
    },
  };
}

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Power Champion",
  url: "https://powerchampion.ai",
  description:
    "One OpenAI-compatible endpoint for leading open AI models — text, vision, image, speech, and embeddings. Live API, prepaid balance, one key.",
};

const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Power Champion",
  url: "https://powerchampion.ai",
  potentialAction: {
    "@type": "SearchAction",
    target: "https://powerchampion.ai/models?q={search_term_string}",
    "query-input": "required name=search_term_string",
  },
};

const SERVICE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebAPI",
  name: "Power Champion API",
  description:
    "OpenAI-compatible API for leading open AI models. Prepaid balance, one key, pay per use.",
  url: "https://powerchampion.ai",
  documentation: "https://powerchampion.ai/docs",
  termsOfService: "https://powerchampion.ai/terms",
  provider: {
    "@type": "Organization",
    name: "Power Champion",
    url: "https://powerchampion.ai",
  },
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
        ]),
      }}
    />
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
      </body>
    </html>
  );
}
