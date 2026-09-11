/* Regional links load a new document so SSR language and locale metadata stay aligned. */
import { INTERNATIONAL_CONTENT } from "../lib/international-content";
import { HomeContent } from "./home-content";
import { LanguagePicker } from "./language-picker";
import {
  INTERNATIONAL_SECTIONS,
  internationalPath,
  type InternationalLanguage,
  type InternationalSection,
} from "../lib/languages";
import { MODEL_CATALOG, type ModelDefinition } from "../lib/models";
import { CREDIT_PACKS, calculateUsageCost } from "../lib/pricing";
import { COMPANY_SOURCES } from "../lib/company";

type Props = { language: InternationalLanguage; section: InternationalSection };
type Copy = (typeof INTERNATIONAL_CONTENT)[InternationalLanguage];

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function ModelPrice({ model, copy }: { model: ModelDefinition; copy: Copy }) {
  const unit = model.categories.includes("image")
    ? copy.catalog.image
    : model.categories.includes("audio")
      ? copy.catalog.minute
      : copy.catalog.million;
  const hasTokenOutput = model.outputPerMillion > 0;
  return (
    <div className="intl-model-price">
      <span>
        <strong>US${model.inputPerMillion.toFixed(2)}</strong>
        {hasTokenOutput && ` ${copy.catalog.input}`}
      </span>
      {hasTokenOutput && (
        <span>
          <strong>US${model.outputPerMillion.toFixed(2)}</strong>{" "}
          {copy.catalog.output}
        </span>
      )}
      <small>{unit}</small>
    </div>
  );
}

function Catalog({ copy, compact = false }: { copy: Copy; compact?: boolean }) {
  const models = compact
    ? MODEL_CATALOG.filter((model) =>
        ["glm-5.2-fp8", "qwen3-vl-30b", "flux-schnell", "bge-m3"].includes(
          model.id,
        ),
      )
    : MODEL_CATALOG;
  return (
    <section className="intl-section" aria-labelledby="intl-catalog-title">
      <div className="intl-section-heading">
        <span className="intl-marker">API / 01</span>
        <h2 id="intl-catalog-title">{copy.catalog.title}</h2>
        <p>{copy.catalog.lead}</p>
      </div>
      <div className="intl-model-grid">
        {models.map((model) => (
          <article
            className="intl-model"
            key={model.id}
            aria-labelledby={`intl-${model.id}`}
          >
            <code>{model.modelId}</code>
            <h3 id={`intl-${model.id}`}>{model.name}</h3>
            <p>{copy.modelDescriptions[model.id]}</p>
            <ModelPrice model={model} copy={copy} />
            <a href={`/models/${model.id}`}>
              {copy.actions.details}
              <span className="sr-only"> — {model.name}</span>
              <Arrow />
            </a>
          </article>
        ))}
      </div>
      <div className="intl-note">
        <p>{copy.catalog.note}</p>
        <a href="/status">
          {copy.actions.status} <Arrow />
        </a>
      </div>
      <p className="intl-language-note">{copy.catalog.detailNote}</p>
    </section>
  );
}

function Workflows({ copy }: { copy: Copy }) {
  const models = [
    "GLM 5.2 FP8",
    "Qwen3-VL 30B",
    "Flux / Chroma / Whisper / IndexTTS2",
    "BGE-M3 / BGE Reranker",
  ];
  return (
    <section className="intl-section" aria-labelledby="intl-workflow-title">
      <div className="intl-section-heading">
        <span className="intl-marker">02</span>
        <h2 id="intl-workflow-title">{copy.workflows.title}</h2>
        <p>{copy.workflows.lead}</p>
      </div>
      <div className="intl-workflows">
        {copy.workflows.items.map((item, index) => (
          <article key={item.title}>
            <span className="intl-index">0{index + 1}</span>
            <div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <code>{models[index]}</code>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Services({
  copy,
  language,
}: {
  copy: Copy;
  language: InternationalLanguage;
}) {
  return (
    <section className="intl-section" aria-labelledby="intl-services-title">
      <div className="intl-section-heading">
        <span className="intl-marker">03</span>
        <h2 id="intl-services-title">{copy.services.title}</h2>
      </div>
      <div className="intl-three-col">
        {copy.services.items.map((item, index) => (
          <article key={item.title}>
            <span className="intl-index">0{index + 1}</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
            <a
              href={internationalPath(
                language,
                index === 0 ? "models" : "infrastructure",
              )}
            >
              {index === 0 ? copy.nav.models : copy.nav.infrastructure}{" "}
              <Arrow />
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

function Onboarding({ copy }: { copy: Copy }) {
  return (
    <section className="intl-section" aria-labelledby="intl-start-title">
      <div className="intl-section-heading">
        <span className="intl-marker">API / 04</span>
        <h2 id="intl-start-title">{copy.onboarding.title}</h2>
        <p>{copy.onboarding.lead}</p>
      </div>
      <ol className="intl-steps">
        {copy.onboarding.steps.map((step, index) => (
          <li key={step.title}>
            <span className="intl-index">0{index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
      <a className="intl-button intl-secondary" href="/integrations">
        {copy.actions.integrations}
        <Arrow />
      </a>
      <p className="intl-language-note">{copy.platformNote}</p>
    </section>
  );
}

function Pricing({ copy }: { copy: Copy }) {
  const example = calculateUsageCost(
    1_000_000,
    250_000,
    MODEL_CATALOG.find((model) => model.id === "glm-5.2-fp8")!,
  );
  return (
    <>
      <section
        className="intl-section intl-first-section"
        aria-labelledby="intl-credit-title"
      >
        <div className="intl-section-heading">
          <h2 id="intl-credit-title">{copy.pricing.title}</h2>
          <p>{copy.pricing.lead}</p>
        </div>
        <div className="intl-three-col intl-credit-packs">
          {CREDIT_PACKS.map((pack, index) => (
            <article key={pack.id}>
              <h3>{copy.pricing.packs[index]}</h3>
              <p className="intl-credit-value">
                <span>US$</span>
                {pack.price}
              </p>
              <p>
                {copy.pricing.credit}{" "}
                <strong>US${pack.credit.toFixed(2)}</strong>
              </p>
              {pack.bonusPercent > 0 && (
                <span className="intl-credit-bonus">
                  +{pack.bonusPercent}% {copy.pricing.bonus}
                </span>
              )}
              <a
                className="intl-button intl-secondary"
                href="mailto:info@powerchampion.org"
              >
                {copy.pricing.purchase}
                <Arrow />
              </a>
            </article>
          ))}
        </div>
        <p className="intl-language-note">{copy.pricing.note}</p>
      </section>
      <section className="intl-example" aria-labelledby="intl-example-title">
        <div>
          <span className="intl-marker">GLM 5.2 FP8</span>
          <h2 id="intl-example-title">{copy.pricing.exampleTitle}</h2>
          <p>{copy.pricing.exampleBody}</p>
        </div>
        <div className="intl-example-result">
          <strong>US${example.toFixed(2)}</strong>
          <span>{copy.pricing.exampleUnit}</span>
        </div>
      </section>
      <section className="intl-section" aria-labelledby="intl-rates-title">
        <div className="intl-section-heading">
          <h2 id="intl-rates-title">{copy.catalog.pricing}</h2>
          <p>{copy.catalog.note}</p>
        </div>
        <div className="intl-rate-list">
          {MODEL_CATALOG.map((model) => (
            <article key={model.id}>
              <div>
                <h3>{model.name}</h3>
                <p>{copy.modelDescriptions[model.id]}</p>
              </div>
              <ModelPrice model={model} copy={copy} />
            </article>
          ))}
        </div>
        <div className="intl-note">
          <a href="/compare">
            {copy.actions.platform}
            <Arrow />
          </a>
          <p>{copy.platformNote}</p>
        </div>
      </section>
      <Onboarding copy={copy} />
    </>
  );
}

function Infrastructure({ copy }: { copy: Copy }) {
  return (
    <>
      <section
        className="intl-section intl-first-section"
        aria-labelledby="intl-gpu-title"
      >
        <div className="intl-section-heading">
          <span className="intl-marker">NVIDIA HGX</span>
          <h2 id="intl-gpu-title">{copy.infrastructure.title}</h2>
          <p>{copy.infrastructure.lead}</p>
        </div>
        <div className="intl-three-col">
          {copy.infrastructure.options.map((option) => (
            <article key={option.title}>
              <div className="intl-chip" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <h3>{option.title}</h3>
              <p>{option.body}</p>
            </article>
          ))}
        </div>
        <p className="intl-language-note">{copy.infrastructure.note}</p>
      </section>
      <section
        className="intl-section intl-brief"
        aria-labelledby="intl-brief-title"
      >
        <div>
          <span className="intl-marker">GPU / 02</span>
          <h2 id="intl-brief-title">{copy.infrastructure.requirementsTitle}</h2>
          <a className="intl-button" href="mailto:info@powerchampion.org">
            {copy.actions.contact}
            <Arrow />
          </a>
        </div>
        <ul>
          {copy.infrastructure.requirements.map((requirement, index) => (
            <li key={requirement}>
              <span className="intl-index">0{index + 1}</span>
              {requirement}
            </li>
          ))}
        </ul>
      </section>
      <section className="intl-section" aria-labelledby="intl-process-title">
        <div className="intl-section-heading">
          <h2 id="intl-process-title">{copy.infrastructure.processTitle}</h2>
        </div>
        <ol className="intl-steps">
          {copy.infrastructure.process.map((step, index) => (
            <li key={step.title}>
              <span className="intl-index">0{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function Company({
  copy,
  language,
}: {
  copy: Copy;
  language: InternationalLanguage;
}) {
  return (
    <>
      <section
        className="intl-section intl-first-section intl-company-intro"
        aria-labelledby="intl-company-title"
      >
        <div>
          <span className="intl-marker">Power Champion Investment Limited</span>
          <h2 id="intl-company-title">{copy.company.title}</h2>
        </div>
        <p>{copy.company.body}</p>
      </section>
      <Services copy={copy} language={language} />
      <section
        className="intl-section intl-three-col"
        aria-label={copy.company.title}
      >
        {copy.company.approach.map((item, index) => (
          <article key={item.title}>
            <span className="intl-index">0{index + 1}</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </section>
      <section
        className="intl-section intl-company-contact"
        aria-labelledby="intl-contact-title"
      >
        <div>
          <h2 id="intl-contact-title">{copy.footer.contact}</h2>
          <address>
            <p>{copy.company.address}</p>
            <a href="mailto:info@powerchampion.org">info@powerchampion.org</a>
            <a href="tel:+886223960605">+886 2 2396 0605</a>
          </address>
        </div>
        <div className="intl-evidence">
          <h3>{copy.company.evidenceTitle}</h3>
          <p>{copy.company.evidence}</p>
          <a href={COMPANY_SOURCES[0].href}>
            {copy.company.evidenceLink}
            <Arrow />
          </a>
        </div>
      </section>
    </>
  );
}

export function InternationalSite({ language, section }: Props) {
  const copy = INTERNATIONAL_CONTENT[language];
  const page = copy.pages[section];
  return (
    <div className="international-site" lang={language}>
      <a
        className="intl-skip"
        href={section === "" ? "#main-content" : "#intl-main"}
      >
        {copy.skip}
      </a>
      <header className="intl-header">
        <div className="intl-header-main intl-frame">
          <a
            className="intl-brand"
            href={internationalPath(language)}
            aria-label="Power Champion"
          >
            <span className="intl-brand-symbol" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>Power Champion</span>
          </a>
          <nav aria-label={copy.navigation}>
            {INTERNATIONAL_SECTIONS.map((item) => (
              <a
                key={item}
                href={internationalPath(language, item)}
                aria-current={item === section ? "page" : undefined}
              >
                {copy.nav[item]}
              </a>
            ))}
          </nav>
          <a className="intl-header-cta" href="/platform">
            {copy.actions.platform}
            <Arrow />
          </a>
          <LanguagePicker language={language} section={section} />
        </div>
      </header>
      {section === "" ? (
        <HomeContent language={language} />
      ) : (
        <main id="intl-main" className="intl-frame" lang={language}>
          <section className="intl-hero" aria-labelledby="intl-title">
            <div className="intl-hero-copy">
              <p className="intl-marker">{page.eyebrow}</p>
              <h1 id="intl-title">{page.title}</h1>
              <p className="intl-lead">{page.description}</p>
              <div className="intl-actions">
                <a
                  className="intl-button"
                  href={
                    section === "infrastructure" || section === "company"
                      ? "mailto:info@powerchampion.org"
                      : "/platform"
                  }
                >
                  {section === "infrastructure" || section === "company"
                    ? copy.actions.contact
                    : copy.actions.platform}
                  <Arrow />
                </a>
                <a
                  className="intl-button intl-secondary"
                  href={internationalPath(
                    language,
                    section === "models" ? "pricing" : "models",
                  )}
                >
                  {section === "models"
                    ? copy.actions.pricing
                    : copy.actions.models}
                  <Arrow />
                </a>
              </div>
              {section !== "infrastructure" && section !== "company" && (
                <p className="intl-language-note">{copy.platformNote}</p>
              )}
            </div>
          </section>

          {section === "models" && (
            <>
              <Catalog copy={copy} />
              <Workflows copy={copy} />
              <Onboarding copy={copy} />
            </>
          )}
          {section === "pricing" && <Pricing copy={copy} />}
          {section === "infrastructure" && <Infrastructure copy={copy} />}
          {section === "company" && <Company copy={copy} language={language} />}
          <section className="intl-closing">
            <span className="intl-marker">POWER CHAMPION</span>
            <h2>{copy.closing.title}</h2>
            <p>{copy.closing.body}</p>
            <div className="intl-actions">
              <a
                className="intl-button"
                href={internationalPath(language, "models")}
              >
                {copy.actions.models}
                <Arrow />
              </a>
              <a
                className="intl-button intl-secondary"
                href="mailto:info@powerchampion.org"
              >
                {copy.actions.contact}
                <Arrow />
              </a>
            </div>
          </section>
        </main>
      )}
      <footer className="intl-footer">
        <div className="intl-frame">
          <div className="intl-footer-grid">
            <div className="intl-footer-intro">
              <strong>POWER CHAMPION</strong>
              <p>{copy.footerNote}</p>
              <a href="mailto:info@powerchampion.org">
                info@powerchampion.org <Arrow />
              </a>
            </div>
            <div>
              <h2>{copy.footer.company}</h2>
              {INTERNATIONAL_SECTIONS.filter(Boolean).map((item) => (
                <a key={item} href={internationalPath(language, item)}>
                  {copy.nav[item]}
                </a>
              ))}
            </div>
            <div>
              <h2>{copy.footer.resources}</h2>
              <a href="/platform">{copy.actions.platform}</a>
              <a href="/docs">{copy.footer.docs}</a>
              <a href="/status">{copy.actions.status}</a>
              <a href="/trust">{copy.footer.trust}</a>
            </div>
          </div>
          <div className="intl-footer-bottom">
            <span>© Power Champion Investment Limited</span>
            <div>
              <a href="/privacy">{copy.footer.privacy}</a>
              <a href="/terms">{copy.footer.terms}</a>
            </div>
          </div>
          <p className="intl-language-note">{copy.legalNote}</p>
        </div>
      </footer>
    </div>
  );
}
