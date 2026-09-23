"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAnimate, useInView } from "motion/react";
import { agentPlatformCopy } from "../lib/agent-platform-copy";
import type { HomeLanguage } from "../lib/home-copy";
import { AgentShowcase } from "./agent-showcase";
import { PromoMotionRoot, usePromoMotion } from "./promo-motion";

const ease = [0.22, 1, 0.36, 1] as const;
const fileTypes = ["TXT", "MD", "CSV", "JSON", "DOCX"];
const capabilityPaths = [
  "M6 4h9l4 4v16H6zM15 4v5h4M9 14h7M9 18h7",
  "M5 5h18v18H5zM5 11h18M11 5v18M17 11v12M5 17h18",
  "M11 8H8a6 6 0 0 0 0 12h4m5-12h3a6 6 0 0 1 0 12h-4M9 14h10",
  "M10 7h13M10 14h13M10 21h13M4 6l2 2 3-4M4 13l2 2 3-4M4 20l2 2 3-4",
  "M6 5v18M12 5v18M19 8l5 6-5 6M16 14h8",
  "M6 4h11l5 5v15H6zM17 4v6h5M14 12v8M10 16l4 4 4-4",
];

function Arrow() { return <span aria-hidden="true">↗</span>; }

function Glyph({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M50 8v84M8 50h84M20.3 20.3l59.4 59.4M20.3 79.7l59.4-59.4" stroke="currentColor" strokeWidth="1.1" /><circle cx="50" cy="50" r="18" stroke="currentColor" strokeWidth="1.1" /><circle cx="50" cy="50" r="4" fill="currentColor" /></svg>;
}

/** Reveal a readable SSR section once; interruptions settle at its readable end. */
function EditorialSection({ children, className, id, titleId }: { children: ReactNode; className: string; id?: string; titleId: string }) {
  const [scope, animate] = useAnimate<HTMLElement>();
  const inView = useInView(scope, { amount: 0.12 });
  const appeared = useRef(false);
  const { canAnimate } = usePromoMotion();
  useEffect(() => {
    if (!canAnimate || !inView || appeared.current) return;
    appeared.current = true;
    const animation = animate(scope.current, { opacity: [0.65, 1], y: [20, 0] }, { duration: 0.8, ease });
    return () => animation.complete();
  }, [animate, canAnimate, inView, scope]);
  return <section className={className} id={id} aria-labelledby={titleId} ref={scope}>{children}</section>;
}

function AgentIllustration({ language }: { language: HomeLanguage }) {
  const copy = agentPlatformCopy[language].heroVisual;
  const [scope, animate] = useAnimate<HTMLElement>();
  const inView = useInView(scope, { amount: 0.25 });
  const { canAnimate } = usePromoMotion();
  const playing = canAnimate && inView;
  const animations = useRef<Array<{ play: () => void; pause: () => void }>>([]);
  useEffect(() => {
    if (playing && animations.current.length === 0) {
      animations.current = [
        animate(".ap-hero-paper-float", { y: [0, -9, 0] }, { duration: 9, repeat: Infinity, ease: "easeInOut" }),
        animate(".ap-hero-source-float", { y: [0, 7, 0] }, { duration: 11, repeat: Infinity, ease: "easeInOut" }),
        animate(".ap-hero-glyph", { rotate: [-8, 0, -8] }, { duration: 15, repeat: Infinity, ease: "easeInOut" }),
        animate(".ap-hero-wire-flow", { strokeDashoffset: [96, 0] }, { duration: 8, repeat: Infinity, ease: "linear" }),
      ];
    }
    for (const animation of animations.current) {
      if (playing) animation.play();
      else animation.pause();
    }
    return () => { for (const animation of animations.current) animation.pause(); };
  }, [animate, playing]);
  return <figure className="ap-hero-figure" ref={scope} data-illustration-playing={playing ? "true" : "false"}>
    <figcaption><span><i aria-hidden="true" />{copy.label}</span><span aria-hidden="true">PC / AGENT</span></figcaption>
    <div className="ap-hero-drawing">
      <div className="ap-hero-grid" aria-hidden="true" />
      <svg className="ap-hero-wire" viewBox="0 0 500 460" fill="none" aria-hidden="true"><path d="M86 110v182q0 22 22 22h253q20 0 20-20V182" /><path className="ap-hero-wire-flow" d="M86 110v182q0 22 22 22h253q20 0 20-20V182" /></svg>
      <div className="ap-hero-source-float"><div className="ap-hero-source"><span aria-hidden="true">01 /</span><strong>{copy.material}</strong><div className="ap-source-lines" aria-hidden="true"><i /><i /><i /></div><span className="ap-source-formats" aria-hidden="true">Aa · 01 · ↗</span></div></div>
      <div className="ap-hero-paper-float"><div className="ap-hero-paper-back" aria-hidden="true" /><div className="ap-hero-paper"><div className="ap-paper-masthead"><span>POWER CHAMPION</span><span aria-hidden="true">↗</span></div><strong>{copy.deliverable}</strong><div className="ap-paper-rule" aria-hidden="true" /><div className="ap-paper-lines" aria-hidden="true"><i /><i /><i /><i /></div><div className="ap-paper-foot"><span>{copy.review}</span><span aria-hidden="true">.DOCX</span></div></div></div>
      <div className="ap-hero-glyph" aria-hidden="true"><Glyph /></div>
      <div className="ap-hero-intent"><span aria-hidden="true">↗</span><p>{copy.brief}</p></div>
      <div className="ap-hero-plan"><span aria-hidden="true">+</span>{copy.plan}<span aria-hidden="true">—</span></div>
    </div>
    <div className="ap-figure-bottom" aria-hidden="true"><span>POWER CHAMPION / AGENTS</span><span>01 — 02</span></div>
  </figure>;
}

function PlatformPage({ language, paused, onToggle }: { language: HomeLanguage; paused: boolean; onToggle: () => void }) {
  const copy = agentPlatformCopy[language];
  return <main id="main-content" className="ap-page" lang={language} data-language={language}>
    <EditorialSection className="ap-hero ap-frame" titleId="agent-platform-title">
      <div className="ap-hero-copy">
        <p className="ap-eyebrow"><span aria-hidden="true" />{copy.eyebrow}</p>
        <h1 id="agent-platform-title">{copy.title[0]}<br /><em>{copy.title[1]}</em></h1>
        <p className="ap-hero-lead">{copy.lead}</p>
        <div className="ap-actions"><a className="ap-button" href="/tasks">{copy.taskCta}<Arrow /></a><a className="ap-text-link" href="/agents/build">{copy.buildCta}<Arrow /></a></div>
        <p className="ap-requirement">{copy.requirement}</p>
      </div>
      <AgentIllustration language={language} />
      <div className="ap-hero-bottom"><a className="ap-text-link" href="/agents">{copy.galleryCta}<Arrow /></a><span className="ap-hero-bottom-rule" aria-hidden="true" /><button type="button" className="ap-motion-toggle" aria-pressed={paused} onClick={onToggle}><span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span>{paused ? copy.resume : copy.pause}</button></div>
    </EditorialSection>

    <EditorialSection className="ap-capabilities ap-frame ap-section" titleId="agent-capabilities-title">
      <div className="ap-section-heading"><div><p className="ap-eyebrow">01 / {copy.capabilitiesEyebrow}</p><h2 id="agent-capabilities-title">{copy.capabilitiesTitle}</h2></div><p>{copy.capabilitiesLead}</p></div>
      <ul className="ap-capability-grid">{copy.capabilities.map((item, index) => <li key={item.title}><div className="ap-capability-top"><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true"><path d={capabilityPaths[index]} /></svg><span aria-hidden="true">0{index + 1}</span></div><h3>{item.title}</h3><p>{item.body}</p></li>)}</ul>
      <div className="ap-files"><div><h3>{copy.fileLabel}</h3><p>{copy.fileNote}</p></div><ul aria-label={copy.fileLabel}>{fileTypes.map((type) => <li key={type}><svg viewBox="0 0 20 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 1h9l5 5v17H3zM12 1v6h5M6 12h8M6 16h6" /></svg><span>{type}</span></li>)}</ul></div>
    </EditorialSection>

    <AgentShowcase language={language} />

    <EditorialSection className="ap-workflow ap-frame ap-section" titleId="agent-workflow-title">
      <div className="ap-section-heading"><div><p className="ap-eyebrow">02 / {copy.workflowEyebrow}</p><h2 id="agent-workflow-title">{copy.workflowTitle}</h2></div><a className="ap-text-link" href="/agents/build">{copy.buildCta}<Arrow /></a></div>
      <ol className="ap-workflow-list">{copy.workflow.map((item, index) => <li key={item.title}><div className="ap-workflow-number" aria-hidden="true">0{index + 1}<span>↗</span></div><h3>{item.title}</h3><p>{item.body}</p></li>)}</ol>
    </EditorialSection>

    <EditorialSection className="ap-service" titleId="agent-service-title">
      <div className="ap-frame ap-service-inner"><div className="ap-service-copy"><p className="ap-eyebrow">03 / {copy.serviceEyebrow}</p><h2 id="agent-service-title">{copy.serviceTitle}</h2><p>{copy.serviceLead}</p><a className="ap-button" href="/contact">{copy.contactCta}<Arrow /></a></div><div className="ap-service-scope"><Glyph className="ap-service-glyph" /><ul>{copy.serviceItems.map((item, index) => <li key={item}><span aria-hidden="true">0{index + 1}</span>{item}</li>)}</ul><p>{copy.serviceNote}</p></div></div>
    </EditorialSection>

    <EditorialSection className="ap-faq ap-frame ap-section" titleId="agent-faq-title"><div><p className="ap-eyebrow">04 / {copy.faqEyebrow}</p><h2 id="agent-faq-title">{copy.faqTitle}</h2></div><div className="ap-faq-list">{copy.faqs.map((item) => <details key={item.question}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div></EditorialSection>

    <EditorialSection className="ap-closing ap-frame" titleId="agent-closing-title"><p className="ap-eyebrow">POWER CHAMPION / AGENTS</p><h2 id="agent-closing-title">{copy.closingTitle}</h2><p>{copy.closingLead}</p><div className="ap-actions"><a className="ap-button" href="/tasks">{copy.taskCta}<Arrow /></a><a className="ap-text-link" href="/contact">{copy.contactCta}<Arrow /></a></div><p className="ap-requirement">{copy.requirement}</p></EditorialSection>
  </main>;
}

export function AgentPlatformContent({ language = "en" }: { language?: HomeLanguage }) {
  const [paused, setPaused] = useState(false);
  return <PromoMotionRoot paused={paused}><PlatformPage language={language} paused={paused} onToggle={() => setPaused((value) => !value)} /></PromoMotionRoot>;
}
