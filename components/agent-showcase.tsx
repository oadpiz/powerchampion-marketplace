"use client";

import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { motion, useInView } from "motion/react";
import { agentShowcaseCopy } from "../lib/agent-showcase-copy";
import type { HomeLanguage } from "../lib/home-copy";
import { usePromoMotion } from "./promo-motion";

const STAGE_DURATION = 5800;
const ease = [0.22, 1, 0.36, 1] as const;

function DocumentIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></svg>;
}

export function AgentShowcase({ language }: { language: HomeLanguage }) {
  const id = useId();
  const sceneRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const stageControlsRef = useRef<HTMLDivElement>(null);
  const { canAnimate } = usePromoMotion();
  const inView = useInView(sceneRef, { amount: 0.35 });
  const [selected, setSelected] = useState(0);
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const playing = canAnimate && inView && !paused;
  const copy = agentShowcaseCopy[language];
  const scenario = copy.scenarios[selected];
  const transition = { duration: canAnimate ? 0.65 : 0, ease };

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setStage((current) => (current + 1) % 4), STAGE_DURATION);
    return () => window.clearInterval(timer);
  }, [playing, selected]);

  function selectScenario(index: number) {
    setSelected(index);
    setStage(0);
    setPaused(true);
  }

  function selectStage(index: number) {
    setStage(index);
    setPaused(true);
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number, kind: "scenario" | "stage") {
    const count = kind === "scenario" ? 3 : 4;
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % count : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + count - 1) % count : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null;
    if (next === null) return;
    event.preventDefault();
    if (kind === "scenario") selectScenario(next);
    else selectStage(next);
    (kind === "scenario" ? tabsRef : stageControlsRef).current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }

  return <section className="agent-showcase" data-promo-scene data-language={language} data-showcase-playing={playing ? "true" : "false"} aria-labelledby={`${id}-title`}>
    <div className="agent-showcase-frame">
      <div className="agent-showcase-heading">
        <div><p className="agent-showcase-eyebrow"><span aria-hidden="true" />{copy.eyebrow}</p><h2 id={`${id}-title`}>{copy.title[0]}<br /><em>{copy.title[1]}</em></h2></div>
        <p className="agent-showcase-lead">{copy.lead}</p>
      </div>

      <div className="agent-showcase-tabs" role="tablist" aria-label={copy.scenariosLabel} ref={tabsRef}>
        {copy.scenarios.map((item, index) => <button type="button" role="tab" id={`${id}-scenario-${index}`} aria-controls={`${id}-panel`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} onClick={() => selectScenario(index)} onKeyDown={(event) => navigate(event, index, "scenario")} key={item.label}>
          <span className="agent-showcase-tab-number" aria-hidden="true">0{index + 1}</span>{item.label}<span className="agent-showcase-tab-arrow" aria-hidden="true">↗</span>
          {selected === index && (canAnimate ? <motion.span className="agent-showcase-tab-line" layoutId={`${id}-tab-line`} transition={transition} /> : <span className="agent-showcase-tab-line" />)}
        </button>)}
      </div>

      <div className="agent-showcase-layout" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-scenario-${selected}`} tabIndex={0} aria-live="off">
        <div className="agent-showcase-story">
          <p className="agent-showcase-index" aria-hidden="true">PC / AGENT — 0{selected + 1}</p>
          <h3>{scenario.title}</h3>
          <div className="agent-showcase-stages" role="group" aria-label={copy.stagesLabel} ref={stageControlsRef}>
            {copy.stageNames.map((name, index) => <button type="button" onClick={() => selectStage(index)} onKeyDown={(event) => navigate(event, index, "stage")} aria-pressed={stage === index} aria-controls={`${id}-stage-detail`} key={name}>
              <span className="agent-showcase-stage-track" aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span><motion.i key={String(canAnimate)} initial={false} animate={{ scaleX: stage >= index ? 1 : 0 }} transition={transition} /></span>
              <span>{name}</span>
            </button>)}
          </div>
          <div className="agent-showcase-stage-detail" id={`${id}-stage-detail`}>
            <h4>{scenario.stages[stage][0]}</h4>
            <p>{scenario.stages[stage][1]}</p>
          </div>
          <div className="agent-showcase-playback">
            <button type="button" className="agent-showcase-play" onClick={() => setPaused((current) => !current)} disabled={!canAnimate} aria-label={canAnimate ? (paused ? copy.play : copy.pause) : copy.static}>
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">{paused || !canAnimate ? <path d="m5 3 7 5-7 5V3Z" fill="currentColor" /> : <><path d="M5 3v10M11 3v10" stroke="currentColor" strokeWidth="2" /></>}</svg>
              {canAnimate ? (paused ? copy.play : copy.pause) : copy.static}
            </button>
            <span className="agent-showcase-page-number" aria-hidden="true">0{stage + 1}<span>/ 04</span></span>
          </div>
          <div className="agent-showcase-actions"><a className="agent-showcase-primary" href="/agents/build">{copy.build}<span aria-hidden="true">↗</span></a><a className="agent-showcase-contact" href="/contact">{copy.contact}<span aria-hidden="true">↗</span></a></div>
        </div>

        <div className="agent-showcase-visual" ref={sceneRef} data-stage={stage}>
          {/* Keep the observed host stable; remount artwork to cancel in-flight motion immediately. */}
          <Fragment key={String(canAnimate)}>
          <div className="agent-showcase-scene-header"><span><i aria-hidden="true" />{copy.example}</span><span aria-hidden="true">PC—0{selected + 1}</span></div>
          <div className="agent-showcase-scene-grid" aria-hidden="true" />
          <motion.div className="agent-showcase-halo" aria-hidden="true" initial={false} animate={{ opacity: playing ? [0.3, 0.65, 0.3] : 0.35 }} transition={playing ? { duration: 7, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }} />
          <motion.div className="agent-showcase-brief" initial={false} animate={{ borderColor: stage === 0 ? "#c7af7959" : "#c7af7926", y: stage === 0 ? 0 : -3 }} transition={transition}>
            <span className="agent-showcase-brief-mark" aria-hidden="true">↗</span><div><span className="agent-showcase-mini-label">{copy.briefLabel}</span><p>{scenario.brief}</p></div>
          </motion.div>

          <div className="agent-showcase-composition">
            <svg className="agent-showcase-connections" viewBox="0 0 540 350" preserveAspectRatio="none" fill="none" aria-hidden="true">
              <path d="M85 66V255Q85 275 105 275H207Q227 275 227 255V175H295" />
              <motion.path className="agent-showcase-connection-active" d="M85 66V255Q85 275 105 275H207Q227 275 227 255V175H295" initial={false} animate={{ pathLength: stage >= 1 ? 1 : 0.12, opacity: stage >= 1 ? 0.8 : 0.35 }} transition={transition} />
              <motion.circle cx="227" cy="275" r="3" fill="#d0b786" initial={false} animate={{ opacity: playing ? [0.3, 1, 0.3] : 0.6 }} transition={playing ? { duration: 2.4, repeat: Infinity } : { duration: 0 }} />
            </svg>
            <div className="agent-showcase-sources">
              <span className="agent-showcase-mini-label">{copy.sourcesLabel}</span>
              {scenario.sources.map((source, index) => <motion.div className="agent-showcase-source" key={`${selected}-${index}`} initial={false} animate={{ x: stage === 1 ? 4 + index * 3 : 0, borderColor: stage === 1 ? "#c7af7966" : "#c7af7924" }} transition={{ ...transition, delay: canAnimate ? index * 0.06 : 0 }}>
                <DocumentIcon /><span>{source}</span><span className="agent-showcase-source-number" aria-hidden="true">0{index + 1}</span>
              </motion.div>)}
              <motion.div className="agent-showcase-node" aria-hidden="true" initial={false} animate={{ rotate: stage * 90 }} transition={transition}><svg viewBox="0 0 40 40" fill="none"><path d="M20 5v30M5 20h30M9.4 9.4l21.2 21.2M9.4 30.6 30.6 9.4" stroke="currentColor" strokeWidth="1.5" /><circle cx="20" cy="20" r="6" fill="#26251f" stroke="currentColor" /></svg></motion.div>
            </div>
            <motion.div className="agent-showcase-document-stack" initial={false} animate={{ y: playing ? [0, -5, 0] : 0 }} transition={playing ? { duration: 8, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }}>
              <div className="agent-showcase-paper-underlay" aria-hidden="true" />
              <motion.div className="agent-showcase-document" initial={false} animate={{ rotate: stage === 3 ? 0 : -2, y: stage === 3 ? -5 : 0 }} transition={transition}>
                <div className="agent-showcase-document-top"><span>{copy.documentLabel}</span><DocumentIcon /></div>
                <h4>{scenario.document}</h4>
                <div className="agent-showcase-document-rule" aria-hidden="true" />
                {scenario.sections.map(([title, text], index) => <motion.div className="agent-showcase-document-section" key={`${selected}-${index}`} initial={false} animate={{ opacity: stage === 3 || index <= stage ? 1 : 0.52 }} transition={transition}><span aria-hidden="true">0{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></motion.div>)}
                <div className="agent-showcase-document-bottom"><span>{copy.draft}</span><span aria-hidden="true">01 / 01</span></div>
              </motion.div>
            </motion.div>
          </div>

          <motion.div className="agent-showcase-review" initial={false} animate={{ y: stage === 2 ? -5 : 0, borderColor: stage === 2 ? "#d0b78699" : "#c7af7930" }} transition={transition}>
            <span className="agent-showcase-review-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="12" cy="8" r="3" /><path d="M6 20v-2a6 6 0 0 1 12 0v2M3 3h3M18 3h3M3 21h3M18 21h3" /></svg></span>
            <div><strong>{copy.reviewLabel}</strong><p>{copy.reviewNote}</p></div><span className="agent-showcase-review-plus" aria-hidden="true">+</span>
          </motion.div>
          <div className="agent-showcase-scene-footer" aria-hidden="true"><span>POWER CHAMPION</span><span>↗</span></div>
          </Fragment>
        </div>
      </div>

      <div className="agent-showcase-footer"><p>{copy.footnote}</p><div><a href="/tasks">{copy.tasks}<span aria-hidden="true">↗</span></a><span>{copy.taskNote}</span></div></div>
    </div>
  </section>;
}
