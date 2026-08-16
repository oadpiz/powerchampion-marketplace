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
    description: "One OpenAI-compatible endpoint for leading open AI models — text, vision, image, speech, and embeddings. Live API, prepaid balance, one key.",
  },
  "/models": {
    title: "Open Model Catalog | Power Champion",
    description: "Compare live open-model token rates, context limits, features, and availability.",
  },
  "/pricing": {
    title: "Pricing | Power Champion",
    description: "Live token rates for every model — pay per use from prepaid balance. No subscription required.",
  },
  "/infrastructure": {
    title: "Infrastructure review | Power Champion",
    description: "Source-qualified infrastructure context and release gates for the Power Champion launch site; not a live deployment status.",
  },
  "/docs": {
    title: "Documentation | Power Champion",
    description: "Quick start for the OpenAI-compatible API at b300.powerchampion.ai — cURL, Python, and JavaScript examples.",
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
    title: "Console | Power Champion",
    description: "Check your prepaid API balance with your key. Queries the gateway live; the key is never stored.",
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
  description: "One OpenAI-compatible endpoint for leading open AI models. Live API, prepaid balance, one key.",
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
