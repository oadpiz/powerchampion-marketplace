"use client";

/* Vinext uses root-relative anchors for page navigation. */

import { useState } from "react";
import { MODEL_CATALOG, type ModelDefinition } from "../lib/models";
import {
  HOME_COPY,
  type HomeCategory,
  type HomeLanguage,
} from "../lib/home-copy";
import { INTERNATIONAL_CONTENT } from "../lib/international-content";
import { internationalPath, type InternationalSection } from "../lib/languages";
import { useLocale } from "./locale-provider";
import { ApplicationExplorer, ModelServiceDetails } from "./platform-story";
import { useHomeMotion } from "./use-home-motion";
import { BrandHero } from "./brand-hero";
import { BrandCapabilities } from "./brand-capabilities";
import { PromoMotionRoot } from "./promo-motion";
import { AgentShowcase } from "./agent-showcase";

type CodeLanguage = "Python" | "cURL";
function codeSamples(prompt: string): Record<CodeLanguage, string> {
  const content = JSON.stringify(prompt);
  return {
    Python: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="https://b300.powerchampion.ai/v1",\n    api_key="YOUR_API_KEY"\n)\n\nresponse = client.chat.completions.create(\n    model="glm-5.2-fp8",\n    messages=[{\n        "role": "user",\n        "content": ${content}\n    }]\n)\n\nprint(response.choices[0].message.content)`,
    cURL: `curl https://b300.powerchampion.ai/v1/chat/completions \\\n  -H "Authorization: Bearer $POWERCHAMPION_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "glm-5.2-fp8",\n    "messages": [{\n      "role": "user",\n      "content": ${content}\n    }]\n  }'`,
  };
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d={diagonal ? "M5 19 19 5M5 5h14v14" : "M4 12h15m-6-6 6 6-6 6"} />
    </svg>
  );
}

function ModelSymbol({ model }: { model: ModelDefinition }) {
  const symbol = model.categories.includes("image")
    ? "✳"
    : model.categories.includes("audio")
      ? "≋"
      : model.categories.includes("embedding")
        ? "⌘"
        : model.categories.includes("vision")
          ? "◈"
          : "✻";
  return (
    <span
      aria-hidden="true"
      className={`pc-model-symbol pc-symbol-${model.categories[0]}`}
    >
      {symbol}
    </span>
  );
}

function ModelCard({
  model,
  language,
}: {
  model: ModelDefinition;
  language: HomeLanguage;
}) {
  const copy = HOME_COPY[language];
  const kind = model.categories.includes("image")
    ? "image"
    : model.categories.includes("audio")
      ? "audio"
      : model.categories.includes("embedding")
        ? "embedding"
        : model.categories.includes("vision")
          ? "vision"
          : "text";
  const unit =
    kind === "image"
      ? copy.units.image
      : kind === "audio"
        ? copy.units.audio
        : copy.units.tokens;
  const description =
    language === "en"
      ? model.servingRole.en
      : INTERNATIONAL_CONTENT[language].modelDescriptions[model.id];
  return (
    <article className="pc-model-card" aria-label={model.name}>
      <div className="pc-model-card-top">
        <ModelSymbol model={model} />
        <span className="pc-model-category">{copy.cardCategories[kind]}</span>
      </div>
      <h3>{model.name}</h3>
      <p>{description}</p>
      <div className="pc-model-card-bottom">
        <span>
          <strong>${model.inputPerMillion.toFixed(2)}</strong>{" "}
          <span>{unit}</span>
        </span>
        <a
          href={`/models#${model.id}`}
          aria-label={`${copy.explore} ${model.name}`}
        >
          <Arrow diagonal />
        </a>
      </div>
    </article>
  );
}

export function HomeContent({ language }: { language?: HomeLanguage } = {}) {
  const { locale } = useLocale();
  const activeLanguage = language ?? (locale === "zh" ? "zh-Hant" : "en");
  const copy = HOME_COPY[activeLanguage];
  const [category, setCategory] = useState<HomeCategory>("featured");
  const [motionPaused, setMotionPaused] = useState(false);
  const homeRef = useHomeMotion(motionPaused);
  const [codeLanguage, setCodeLanguage] = useState<CodeLanguage>("Python");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const samples = codeSamples(copy.samplePrompt);
  const categories = (Object.keys(copy.categories) as HomeCategory[]).map(
    (id) => ({ id, label: copy.categories[id] }),
  );
  const featuredIds = [
    "glm-5.2-fp8",
    "qwen3-vl-30b",
    "flux-schnell",
    "whisper-large-v3",
  ];
  const models = MODEL_CATALOG.filter((model) =>
    category === "featured"
      ? featuredIds.includes(model.id)
      : category === "text"
        ? model.categories.includes("reasoning")
        : category === "vision"
          ? model.categories.includes("vision")
          : category === "creative"
            ? model.categories.some((c) => c === "image" || c === "audio")
            : model.categories.includes("embedding"),
  );
  const pageHref = (section: InternationalSection) =>
    language && language !== "en"
      ? internationalPath(language, section)
      : `/${section}`;
  const openAccess = () =>
    window.dispatchEvent(new Event("powerchampion:launch-access"));
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(samples[codeLanguage]);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }
  return (
    <PromoMotionRoot paused={motionPaused}>
    <main
      id="main-content"
      className="unified-home"
      ref={homeRef}
      lang={activeLanguage}
    >
      <BrandHero
        language={activeLanguage}
        motionPaused={motionPaused}
        onToggleMotion={() => setMotionPaused((value) => !value)}
      />
      <div
        className="pc-model-families pc-frame"
        aria-label={copy.modelFamilies}
      >
        <p>{copy.familiesStatement}</p>
        <div>
          <span className="pc-family-glm">
            z.ai <b>GLM</b>
          </span>
          <span className="pc-family-qwen">✧ Qwen</span>
          <span className="pc-family-flux">
            FLUX<span className="pc-family-period">.</span>
          </span>
          <span className="pc-family-whisper">Whisper</span>
          <span className="pc-family-bge">
            BGE<span className="pc-family-period">↗</span>
          </span>
        </div>
      </div>
      <BrandCapabilities language={activeLanguage} />
      <AgentShowcase language={activeLanguage} />
      <div
        className="pc-frame pc-platform-paths"
        aria-label={copy.platformTools}
      >
        <a href="/platform">
          <span>
            {copy.openPlatform}
            <small>{copy.platformDescription}</small>
          </span>
          <span aria-hidden="true">↗</span>
        </a>
        <a href="/compare">
          <span>{copy.compareModels}</span>
          <span aria-hidden="true">⇄</span>
        </a>
        <a href="/playground">
          <span>{copy.playground}</span>
          <span aria-hidden="true">▷</span>
        </a>
        <a href="/integrations">
          <span>{copy.connectApp}</span>
          <span aria-hidden="true">⌘</span>
        </a>
      </div>
      {activeLanguage !== "en" && activeLanguage !== "zh-Hant" && (
        <p className="pc-frame intl-language-note">{copy.workspaceNote}</p>
      )}
      <section
        id="models"
        className="pc-section pc-frame pc-models"
        aria-labelledby="models-title"
      >
        <div className="pc-section-heading">
          <div>
            <p className="pc-overline">
              <span className="pc-section-number">01 /</span>
              {copy.modelOverline}
            </p>
            <h2 id="models-title">
              {copy.modelTitle[0]}
              <br />
              {copy.modelTitle[1]}
            </h2>
          </div>
          <div className="pc-section-aside">
            <p>{copy.modelLead}</p>
            <a className="pc-link" href={pageHref("models")}>
              {copy.allModels.replace("{count}", String(MODEL_CATALOG.length))}
              <Arrow />
            </a>
          </div>
        </div>
        <div
          className="pc-filter-bar"
          role="group"
          aria-label={copy.filterModels}
        >
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={category === item.id}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="pc-model-grid" aria-live="polite" aria-atomic="true">
          {models.map((model) => (
            <ModelCard key={model.id} model={model} language={activeLanguage} />
          ))}
        </div>
        <div className="pc-models-footnote">
          <span>{copy.modelRates}</span>
          <a href="/status">
            {copy.checkStatus}
            <Arrow diagonal />
          </a>
        </div>
      </section>
      <ApplicationExplorer language={activeLanguage} />
      <section
        className="pc-frame pc-section pc-developer"
        aria-labelledby="developer-title"
      >
        <div className="pc-developer-copy">
          <p className="pc-overline">
            <span className="pc-section-number">03 /</span>
            {copy.devOverline}
          </p>
          <h2 id="developer-title">
            {copy.devTitle[0]}
            <br />
            <em>{copy.devTitle[1]}</em>
          </h2>
          <p>{copy.devLead}</p>
          <ol className="pc-dev-steps">
            {copy.devSteps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <a className="pc-link" href="/docs">
            {copy.docs}
            <Arrow />
          </a>
        </div>
        <div className="pc-code-window">
          <div className="pc-code-toolbar">
            <div role="group" aria-label={copy.codeLanguage}>
              {(["Python", "cURL"] as CodeLanguage[]).map((item) => (
                <button
                  type="button"
                  aria-pressed={codeLanguage === item}
                  key={item}
                  onClick={() => {
                    setCodeLanguage(item);
                    setCopyState("idle");
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            <button className="pc-copy-button" type="button" onClick={copyCode}>
              {copyState === "copied" ? copy.copied : copy.copyCode}
            </button>
          </div>
          <pre
            role="region"
            // Keyboard focus lets Safari users scroll long code with arrow keys.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            aria-label={`${codeLanguage} ${copy.codeExample}`}
          >
            <code>
              {samples[codeLanguage].split("\n").map((line, index) => (
                <span className="pc-code-line" key={index}>
                  <span aria-hidden="true" className="pc-line-number">
                    {index + 1}
                  </span>
                  <span
                    className={
                      line.startsWith("from") || line.startsWith("curl")
                        ? "pc-code-keyword"
                        : line.includes('"')
                          ? "pc-code-string"
                          : ""
                    }
                  >
                    {line || " "}
                  </span>
                  {"\n"}
                </span>
              ))}
            </code>
          </pre>
          <div className="pc-code-note">
            <span aria-hidden="true">↳</span>
            {copyState === "error" ? copy.copyError : copy.keyNote}
          </div>
          <span role="status" className="sr-only">
            {copyState === "copied" ? copy.copySuccess : ""}
          </span>
        </div>
      </section>
      <ModelServiceDetails language={activeLanguage} />
      <section
        className="pc-infrastructure"
        aria-labelledby="infrastructure-title"
      >
        <div className="pc-frame pc-infra-inner">
          <div>
            <p className="pc-overline">
              <span className="pc-section-number">05 /</span>
              {copy.infraOverline}
            </p>
            <h2 id="infrastructure-title">
              {copy.infraTitle[0]}
              <br />
              <em>{copy.infraTitle[1]}</em>
            </h2>
            <p className="pc-infra-lead">{copy.infraLead}</p>
            <div className="pc-infra-tags">
              <span>NVIDIA HGX B300</span>
              <span>{copy.dedicated}</span>
              <span>{copy.custom}</span>
            </div>
            <a
              href={pageHref("infrastructure")}
              className="pc-button pc-button-light"
            >
              {copy.exploreInfrastructure}
              <Arrow />
            </a>
            <p className="pc-infra-small">{copy.infraNote}</p>
          </div>
          <div
            className="pc-rack-visual"
            role="img"
            aria-label={copy.infraVisual}
          >
            <div className="pc-rack-label">
              <span className="pc-rack-cross">+</span>
              {copy.computeLabel}
            </div>
            <div className="pc-racks">
              {[0, 1, 2].map((rack) => (
                <div className={`pc-rack pc-rack-${rack}`} key={rack}>
                  <div className="pc-rack-top">
                    <span>PC / {String(rack + 1).padStart(2, "0")}</span>
                    <i />
                  </div>
                  {Array.from({ length: 7 }, (_, i) => (
                    <div className="pc-server" key={i}>
                      <span className="pc-server-vent" />
                      <span className="pc-server-lights">
                        ··
                        <i />
                      </span>
                    </div>
                  ))}
                  <div className="pc-rack-base">{copy.computeName}</div>
                </div>
              ))}
            </div>
            <div className="pc-rack-caption">
              <span>01—03</span>
              <span>{copy.rackCaption}</span>
              <span>↗</span>
            </div>
          </div>
        </div>
      </section>
      <section
        className="pc-frame pc-section pc-company"
        aria-labelledby="company-title"
      >
        <div>
          <p className="pc-overline">
            <span className="pc-section-number">06 /</span>
            {copy.companyOverline}
          </p>
          <h2 id="company-title">
            {copy.companyTitle[0]}
            <br />
            {copy.companyTitle[1]}
          </h2>
        </div>
        <div>
          <p className="pc-company-lead">{copy.companyLead}</p>
          <div className="pc-company-links">
            <a className="pc-link" href={pageHref("company")}>
              {copy.meet}
              <Arrow />
            </a>
            <a className="pc-link" href="/contact">
              {copy.project}
              <Arrow diagonal />
            </a>
          </div>
          <div className="pc-company-location">
            <span aria-hidden="true">◎</span>
            {copy.taipei}
            <span>·</span>
            {copy.location}
          </div>
        </div>
      </section>
      <section
        className="pc-frame pc-section pc-faq"
        aria-labelledby="faq-title"
      >
        <div>
          <p className="pc-overline">{copy.faqOverline}</p>
          <h2 id="faq-title">{copy.faqTitle}</h2>
          <a className="pc-link" href="/faq">
            {copy.moreFaq}
            <Arrow />
          </a>
        </div>
        <div className="pc-faq-list">
          {copy.faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="pc-final-cta" aria-labelledby="cta-title">
        <div className="pc-frame">
          <p className="pc-overline">{copy.ctaOverline}</p>
          <h2 id="cta-title">
            {copy.ctaTitle[0]} <em>{copy.ctaTitle[1]}</em>
          </h2>
          <div className="pc-actions">
            <button type="button" className="pc-button" onClick={openAccess}>
              {copy.access}
              <Arrow />
            </button>
            <a className="pc-link" href="/contact">
              {copy.talk}
              <Arrow diagonal />
            </a>
          </div>
        </div>
      </section>
    </main>
    </PromoMotionRoot>
  );
}
