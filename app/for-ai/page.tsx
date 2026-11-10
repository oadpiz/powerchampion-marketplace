import {
  API_BASE_URL,
  API_REFERENCE_COPY,
  type ApiReferenceSection,
} from "../../lib/api-reference";
import { COMPANY_CAPACITY_MW, COMPANY_CONTENT } from "../../lib/company";
import { metadataForRoute } from "../../lib/metadata";
import { MODEL_CATALOG, publishedRateLabel } from "../../lib/models";
import { CREDIT_PACKS } from "../../lib/pricing";
import { SITE_ORIGIN } from "../../lib/seo";

export const metadata = metadataForRoute("/for-ai");

const company = COMPANY_CONTENT.en;
const quickStart = API_REFERENCE_COPY.en.sections.find((section) => section.id === "quick-start");

/** Markdown links become "text (url)"; backticks stay as plain-text code markers. */
function plainText(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

function firstParagraph(section: ApiReferenceSection): string {
  const block = section.blocks.find((item) => item.kind === "p");
  return block && block.kind === "p" ? plainText(block.text) : "";
}

/** The first code sample that follows a given h3 heading id in the section. */
function codeAfterHeading(section: ApiReferenceSection | undefined, headingId: string): string | null {
  if (!section) return null;
  const headingIndex = section.blocks.findIndex((block) => block.kind === "h3" && block.id === headingId);
  if (headingIndex === -1) return null;
  const next = section.blocks
    .slice(headingIndex + 1)
    .find((block) => block.kind === "code");
  return next && next.kind === "code" ? next.code : null;
}

const curlExample = codeAfterHeading(quickStart, "quick-start-curl");
const pythonExample = codeAfterHeading(quickStart, "quick-start-python");

const KEY_LINKS: { label: string; href: string }[] = [
  { label: "llms.txt — plain-text site summary", href: "/llms.txt" },
  { label: "llms-full.txt — extended plain-text reference (full catalog, prepaid packs, endpoint summary)", href: "/llms-full.txt" },
  { label: "Quick start documentation", href: "/docs" },
  { label: "Full API reference (14 sections)", href: "/docs/api" },
  { label: "Model catalog with published rates", href: "/models" },
  { label: "Pricing and prepaid credit packs", href: "/pricing" },
  { label: "Live service status", href: "/status" },
];

export default function ForAiPage() {
  return (
    <main className="editorial-page seo-for-ai" id="main-content">
      <header aria-labelledby="for-ai-title" className="editorial-hero">
        <p className="eyebrow">For AI crawlers and assistants</p>
        <h1 id="for-ai-title">Power Champion — For AI Crawlers and Assistants</h1>
        <p>
          This page is a plain-text summary of Power Champion ({SITE_ORIGIN}) for AI crawlers, retrieval
          bots, and assistants. It contains no images and no interactive widgets: just the company facts,
          the model catalog with published rates, an API endpoint summary, pricing, and quick-start code.
          The extended plain-text reference is at <a href="/llms.txt">/llms.txt</a> and{" "}
          <a href="/llms-full.txt">/llms-full.txt</a>.
        </p>
      </header>

      <section aria-labelledby="for-ai-company">
        <h2 id="for-ai-company">Company</h2>
        <ul>
          <li>Legal name: {company.record.name}</li>
          <li>{company.identity.founded}</li>
          <li>{company.contact.addressLabel}: {company.contact.address}</li>
          <li>{company.contact.phoneLabel}: {company.contact.phone}</li>
          <li>{company.contact.emailLabel}: {company.contact.email}</li>
          <li>Website: {SITE_ORIGIN} · API: {company.contact.apiLink}</li>
        </ul>
        <p>
          Capacity context is counterparty-reported (Azio AI Holdings SEC-filed Exhibit 99.1,{" "}
          {company.announcement.date}): expected initial hosting capacity of approximately{" "}
          {COMPANY_CAPACITY_MW}; potential expansion: {company.capacity.expansion}. This does not state
          that Power Champion has completed deployment or owns a data centre, and no assurance can be
          given that expansion rights will be exercised.
        </p>
      </section>

      <section aria-labelledby="for-ai-api">
        <h2 id="for-ai-api">API platform</h2>
        <p>{firstParagraph(API_REFERENCE_COPY.en.sections[0])}</p>
        <ul>
          <li>Base URL: <code>{API_BASE_URL}</code> (HTTPS only, JSON requests)</li>
          <li>Authentication: Bearer key in the Authorization header; keys start with <code>sk-b300-</code> and are issued by the Power Champion team</li>
          <li>Billing: US dollars (USD), prepaid balance, pay per use</li>
          <li>Endpoints: chat, vision, text completions, embeddings, reranking, image generation, video generation, text-to-speech, speech recognition, plus billing endpoints</li>
        </ul>
      </section>

      <section aria-labelledby="for-ai-models">
        <h2 id="for-ai-models">Model catalog ({MODEL_CATALOG.length} models)</h2>
        <div className="seo-table-scroll">
          <table className="seo-model-table">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Model ID</th>
                <th scope="col">Capabilities</th>
                <th scope="col">Context</th>
                <th scope="col">Published rate</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_CATALOG.map((model) => (
                <tr key={model.id}>
                  <td>{model.name}</td>
                  <td>{model.modelId}</td>
                  <td>{model.tagline.en}</td>
                  <td>{model.context}</td>
                  <td>{publishedRateLabel(model)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="for-ai-endpoints">
        <h2 id="for-ai-endpoints">API reference — endpoint summary ({API_REFERENCE_COPY.en.sections.length} sections)</h2>
        <ul className="seo-endpoint-list">
          {API_REFERENCE_COPY.en.sections.map((section) => {
            const summary = firstParagraph(section);
            return (
              <li key={section.id}>
                <strong>{section.title}</strong>
                {summary ? <> — <p>{summary}</p></> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="for-ai-pricing">
        <h2 id="for-ai-pricing">Pricing summary</h2>
        <p>
          Every model&apos;s rate is published on the pricing page. Text models are billed per million tokens
          (from US${Math.min(...MODEL_CATALOG.filter((model) => model.outputPerMillion > 0).map((model) => model.inputPerMillion)).toFixed(2)} per 1M input tokens); image, audio, and video models are billed per generated unit — per image, per minute of audio, or per second of video — as listed in the catalog above.
        </p>
        <p>Prepaid credit packs (US dollars):</p>
        <ul>
          {CREDIT_PACKS.map((pack) => (
            <li key={pack.id}>
              US${pack.price} — US${pack.credit} credit{pack.bonusPercent > 0 ? ` (includes ${pack.bonusPercent}% bonus credit)` : ""}
            </li>
          ))}
        </ul>
        <p>
          Credit packs are applied with a redeem code through <code>POST /v1/redeem</code>; the balance is
          visible in the console and via the billing endpoints, and usage is pay per use.
        </p>
      </section>

      <section aria-labelledby="for-ai-quickstart">
        <h2 id="for-ai-quickstart">Quick start</h2>
        <p>Set the environment variable, then send a chat request with cURL or the OpenAI Python SDK:</p>
        <pre>{'export PC_API_KEY="sk-b300-..."'}</pre>
        {curlExample ? <pre>{curlExample}</pre> : null}
        {pythonExample ? <pre>{pythonExample}</pre> : null}
        <p>
          A 502 response means the model is temporarily offline; check the live service status before
          retrying or switching models.
        </p>
      </section>

      <section aria-labelledby="for-ai-links">
        <h2 id="for-ai-links">Key links</h2>
        <ul>
          {KEY_LINKS.map((link) => (
            <li key={link.href}><a href={link.href}>{link.label}</a> ({SITE_ORIGIN}{link.href})</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
