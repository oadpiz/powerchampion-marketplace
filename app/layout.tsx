import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { LocaleProvider } from "../components/locale-provider";
import { DemoCheckout } from "../components/demo-checkout";
import { SiteShell } from "../components/site-shell";
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
  const requestedHost = host?.split(",")[0]?.trim().toLowerCase();
  const isLocalHost = requestedHost === "localhost"
    || requestedHost?.startsWith("localhost:")
    || requestedHost === "127.0.0.1"
    || requestedHost?.startsWith("127.0.0.1:")
    || requestedHost === "[::1]"
    || requestedHost?.startsWith("[::1]:");
  return new URL(isLocalHost ? "http://localhost" : `https://${requestedHost || "localhost"}`);
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  return {
    metadataBase: metadataOrigin(host),
    title: "Power Champion — Token access launching soon",
    description:
      "Explore indicative token-access plans for leading open AI models. Launch access is coming soon; pricing and UI data are illustrative, with no funded balance or live API currently available.",
    openGraph: {
      title: "Token access launching soon.",
      description: "Explore indicative open-model access and illustrative UI data. No funded balance or live API is currently available.",
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Token access launching soon.",
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
          <DemoCheckout />
        </LocaleProvider>
      </body>
    </html>
  );
}
