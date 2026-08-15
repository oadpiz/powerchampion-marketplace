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
      title: "OpenAI-compatible API · Live",
      description: "Explore indicative open-model access and illustrative UI data. No funded balance or live API is currently available.",
      images: ["/og.png"],
    },
    icons: {
      icon: "/favicon.png",
      shortcut: "/favicon.png",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
