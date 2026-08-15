import type { Metadata } from "next";

export type RoutePath =
  | "/"
  | "/models"
  | "/pricing"
  | "/infrastructure"
  | "/docs"
  | "/trust"
  | "/status"
  | "/company"
  | "/contact"
  | "/console"
  | "/faq"
  | "/terms"
  | "/privacy";

const ROUTE_METADATA = {
  "/": {
    title: "Power Champion — OpenAI-compatible API · Live",
    description: "Explore indicative token-access plans for leading open AI models. Launch access is coming soon; pricing and UI data are illustrative, with no funded balance or live API currently available.",
  },
  "/models": {
    title: "Open Model Catalog | Power Champion",
    description: "Compare illustrative open-model token rates, limits, features, and release-review states.",
  },
  "/pricing": {
    title: "Illustrative pricing | Power Champion",
    description: "Illustrative token rates and local launch-access planning; no payment or funded balance is available.",
  },
  "/infrastructure": {
    title: "Infrastructure review | Power Champion",
    description: "Source-qualified infrastructure context and release gates for the Power Champion launch site; not a live deployment status.",
  },
  "/docs": {
    title: "Documentation preview | Power Champion",
    description: "Non-operational integration examples and release-gated future access for Power Champion.",
  },
  "/trust": {
    title: "Trust review | Power Champion",
    description: "Current public trust boundaries and review links for the Power Champion launch site.",
  },
  "/status": {
    title: "Service status | Power Champion",
    description: "Current launch-readiness states for public Power Champion services.",
  },
  "/company": {
    title: "Company | Power Champion",
    description: "Public company context and cited AI infrastructure information for Power Champion.",
  },
  "/contact": {
    title: "Deployment review | Power Champion",
    description: "Review non-binding deployment interests locally in your browser.",
  },
  "/console": {
    title: "Console preview | Power Champion",
    description: "A local illustrative console preview with no account, funded balance, usable key, or live usage.",
  },
  "/faq": {
    title: "FAQ | Power Champion",
    description: "Plain-language answers about the current Power Champion launch site and its public boundaries.",
  },
  "/terms": {
    title: "Terms | Power Champion",
    description: "The current informational and non-transactional terms for the Power Champion launch site.",
  },
  "/privacy": {
    title: "Privacy | Power Champion",
    description: "The current privacy boundary for local Power Champion launch-site interactions.",
  },
} satisfies Record<RoutePath, { title: string; description: string }>;

const SOCIAL_METADATA = {
  title: "OpenAI-compatible API · Live.",
  description: "Explore indicative open-model access and illustrative UI data. No funded balance or live API is currently available.",
};

export function metadataForRoute(pathname: RoutePath): Metadata {
  return {
    ...ROUTE_METADATA[pathname],
    alternates: { canonical: pathname },
    openGraph: {
      ...SOCIAL_METADATA,
      url: pathname,
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
  };
}
