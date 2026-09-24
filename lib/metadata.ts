import type { Metadata } from "next";
import {
  SITE_ORIGIN, SOCIAL_IMAGE, LOCALIZED_SECTIONS, languageAlternates,
  localizedPath, isPrivatePath, type InternationalLocale, type LocalizedSection,
} from "./seo";

export type RoutePath =
  | "/"
  | "/chat"
  | "/tasks"
  | "/agents"
  | "/agent-platform"
  | "/agents/build"
  | "/solutions"
  | "/account"
  | "/admin"
  | "/login"
  | "/register"
  | "/platform"
  | "/compare"
  | "/playground"
  | "/integrations"
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

const HOME_METADATA = {
  title: "Power Champion — One API. Every possibility.",
  description: "Build with open AI models for text, vision, images, speech, and retrieval. Explore published API pricing, integration tools, and dedicated GPU infrastructure.",
};

export const ROUTE_METADATA = {
  "/agent-platform": {
    title: "AI Agents for Reports, Analysis & Action Lists | Power Champion",
    description: "Turn CSV data, proposals and meeting notes into editable Word reports, decision briefs and action lists. Start with a task template or discuss a custom business agent.",
  },
  "/tasks": {
    title: "Agent Tasks | Power Champion",
    description: "Run multi-step agent tasks, review progress, approve web reads, and download results from your account.",
  },
  "/chat": {
    title: "AI Chat | Power Champion",
    description: "Chat with supported AI models using your Power Champion API key, or explore clearly labeled example conversations.",
  },
  "/agents": {
    title: "AI Assistants & Custom Agent Services | Power Champion",
    description: "Try instruction-based AI assistants for support, research, content, and coding. Plan a custom AI agent around your company's knowledge, systems, and workflows.",
  },
  "/agents/build": {
    title: "Agent Builder | Power Champion",
    description: "Configure an agent draft with your own instructions and model settings. Preview instructions and export a reusable configuration.",
  },
  "/account": { title: "Your Account | Power Champion", description: "Manage your Power Champion account and model API access." },
  "/admin": { title: "Administration | Power Champion", description: "Power Champion platform administration." },
  "/login": { title: "Sign In | Power Champion", description: "Sign in to your Power Champion account." },
  "/register": { title: "Create an Account | Power Champion", description: "Create your Power Champion account." },
  "/platform": { title: "Model Platform | Power Champion", description: "Explore, compare, test, and integrate model APIs in the Power Champion development platform." },
  "/compare": { title: "Compare Models | Power Champion", description: "Compare model capabilities, billing units, and estimated costs for your workload." },
  "/playground": { title: "API Playground | Power Champion", description: "Test model API requests with your own key and inspect responses and token usage." },
  "/integrations": { title: "Integrations | Power Champion", description: "Generate model-specific Python, JavaScript, and cURL request examples and connection settings." },
  "/": HOME_METADATA,
  "/solutions": HOME_METADATA,
  "/models": {
    title: "Open Model Catalog | Power Champion",
    description: "Explore open AI models for text, vision, images, speech, and retrieval. Compare published API rates, capabilities, and integration requirements.",
  },
  "/pricing": {
    title: "Pricing | Power Champion",
    description: "Published API rates for tokens, images, and audio, with prepaid credit options and a workload cost calculator.",
  },
  "/infrastructure": {
    title: "Dedicated GPU Infrastructure | Power Champion",
    description: "Explore dedicated NVIDIA HGX GPU capacity, bare-metal deployments, and infrastructure planning for model inference and training.",
  },
  "/docs": {
    title: "Documentation | Power Champion",
    description: "Quick start for the OpenAI-compatible API at b300.powerchampion.ai — cURL, Python, and JavaScript examples.",
  },
  "/trust": {
    title: "Trust and Service Policies | Power Champion",
    description: "Understand Power Champion service responsibilities, data handling, API access, and published company information.",
  },
  "/status": {
    title: "Service status | Power Champion",
    description: "Check the latest available gateway and model service status for Power Champion API services.",
  },
  "/company": {
    title: "Company | Power Champion",
    description: "Meet Power Champion Investment Limited and explore our model API, dedicated GPU, and deployment services.",
  },
  "/contact": {
    title: "Contact Our Team | Power Champion",
    description: "Discuss model API access, GPU capacity, and enterprise deployment requirements with the Power Champion team.",
  },
  "/console": {
    title: "Console | Power Champion",
    description: "Check your prepaid API balance with your key. Queries the gateway live; the key is never stored.",
  },
  "/faq": {
    title: "FAQ | Power Champion",
    description: "Answers about model API access, prepaid credits, billing, integration, and dedicated GPU services.",
  },
  "/terms": {
    title: "Terms | Power Champion",
    description: "Read the terms governing the Power Champion website and how commercial API service terms are established.",
  },
  "/privacy": {
    title: "Privacy | Power Champion",
    description: "Learn how Power Champion handles website interactions, account information, and API requests.",
  },
} satisfies Record<RoutePath, { title: string; description: string }>;

export function metadataForPage(
  pathname: string,
  title: string,
  description: string,
  language: InternationalLocale | "en" = "en",
  languages?: Record<string, string>,
): Metadata {
  const canonical = new URL(pathname === "/solutions" ? "/" : pathname, SITE_ORIGIN).href;
  const ogLocale = { en: "en_US", "zh-Hant": "zh_TW", "zh-Hans": "zh_CN", ja: "ja_JP", ko: "ko_KR" }[language];
  const agentPage = pathname.endsWith("/agent-platform");
  const image = agentPage ? `${SITE_ORIGIN}/og-agents.png` : SOCIAL_IMAGE;
  const imageAlt = agentPage ? "Power Champion Agents — Reports, analysis and action lists" : "Power Champion — model APIs and dedicated GPU infrastructure";
  return {
    title,
    description,
    alternates: { canonical, ...(languages ? { languages } : {}) },
    ...(isPrivatePath(pathname) ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      type: "website",
      siteName: "Power Champion",
      title,
      description,
      url: canonical,
      locale: ogLocale,
      images: [{ url: image, width: 1200, height: 630, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: image, alt: imageAlt }],
    },
  };
}

export function metadataForRoute(pathname: RoutePath): Metadata {
  const route = ROUTE_METADATA[pathname];
  // /solutions remains a duplicate alias of the brand homepage. All language
  // annotations point to the primary home URLs, never to that alias.
  const section = pathname === "/solutions" ? "/" : pathname;
  const localized = LOCALIZED_SECTIONS.some((entry) => entry === section);
  return metadataForPage(pathname, route.title, route.description, "en",
    localized ? languageAlternates(section as LocalizedSection) : undefined);
}

export function metadataForLocalizedPage(
  language: InternationalLocale,
  section: LocalizedSection,
  title: string,
  description: string,
): Metadata {
  return metadataForPage(localizedPath(language, section), title, description, language, languageAlternates(section));
}
