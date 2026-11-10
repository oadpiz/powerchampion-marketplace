import { JsonLd } from "../../components/json-ld";
import { API_BASE_URL } from "../../lib/api-reference";
import { metadataForRoute } from "../../lib/metadata";
import { MODEL_CATALOG, publishedRateLabel } from "../../lib/models";
import { CREDIT_PACKS } from "../../lib/pricing";
import { faqPageJsonLd, type FaqSource } from "../../lib/structured-data";

export const metadata = metadataForRoute("/alternative-to-openai");

// Text models are the ones billed per million tokens; media models are billed
// per image / minute / second. These minima stay true to the published catalog.
const TOKEN_MODELS = MODEL_CATALOG.filter((model) => model.outputPerMillion > 0);
const cheapestInputRate = Math.min(...TOKEN_MODELS.map((model) => model.inputPerMillion));

const FAQ: FaqSource[] = [
  {
    question: "What is Power Champion?",
    answer:
      "Power Champion is an AI platform by Power Champion Investment Limited. One OpenAI-compatible API at b300.powerchampion.ai gives you open AI models for text, vision, images, speech, and retrieval, with published API pricing, prepaid credits, integration tools, and dedicated NVIDIA HGX GPU infrastructure for enterprise AI workloads.",
  },
  {
    question: "How is Power Champion different from OpenAI?",
    answer:
      "Power Champion serves published open-weight models — GLM, Qwen, Flux, Whisper, Wan, and BGE — behind one OpenAI-compatible endpoint, and every API rate is published on the pricing page. OpenAI develops and serves its proprietary GPT model family. If your code already calls the OpenAI API, you can point it at Power Champion by changing the base URL and the API key.",
  },
  {
    question: "Do I need to rewrite my code to switch from OpenAI?",
    answer:
      "No. The Power Champion API is an OpenAI-compatible HTTPS interface: existing OpenAI SDKs work once you change the base_url and the key. One key covers chat, vision, embeddings, reranking, image generation, video generation, text to speech, and speech recognition.",
  },
  {
    question: "How does Power Champion pricing work?",
    answer:
      `Every model's rate is published before you pay: text models are billed per million tokens (from US$${cheapestInputRate.toFixed(2)} per 1M input tokens), images and audio per generated unit, and video per output second. You top up with prepaid credit packs (US$${CREDIT_PACKS.map((pack) => pack.price).join(", US$")}) that include up to ${Math.max(...CREDIT_PACKS.map((pack) => pack.bonusPercent))}% bonus credit, then pay per use. Your balance is visible in the console and through the billing endpoints.`,
  },
  {
    question: "Which models can I call through the Power Champion API?",
    answer:
      `The published catalog currently lists ${MODEL_CATALOG.length} models: ${MODEL_CATALOG.map((model) => model.name).join(", ")}. That covers chat and reasoning, vision and OCR, image generation, speech to text, text to speech, video generation, embeddings, and reranking.`,
  },
];

const faqJsonLd = faqPageJsonLd("/alternative-to-openai", FAQ);

const COMPARISON: { label: string; powerChampion: string; openai: string; openrouter: string }[] = [
  {
    label: "API compatibility",
    powerChampion: "OpenAI-compatible HTTPS API — existing OpenAI SDKs work once you change the base_url and key",
    openai: "Native OpenAI API and SDKs",
    openrouter: "OpenAI-compatible API in front of many providers",
  },
  {
    label: "Model catalog",
    powerChampion: `${MODEL_CATALOG.length} published open-weight models: GLM, Qwen, Flux, Whisper, Wan, BGE — text, vision, image, speech, video, and retrieval`,
    openai: "Proprietary OpenAI model family",
    openrouter: "Aggregated catalog of models from many providers",
  },
  {
    label: "Pricing",
    powerChampion: `Published per-model rates: text from US$${cheapestInputRate.toFixed(2)} per 1M input tokens; images, audio, and video priced per generated unit`,
    openai: "Per-token rates set per model on openai.com",
    openrouter: "Per-model rates set by each underlying provider",
  },
  {
    label: "Billing",
    powerChampion: `Prepaid credit packs (US$${CREDIT_PACKS.map((pack) => pack.price).join(", US$")}, up to ${Math.max(...CREDIT_PACKS.map((pack) => pack.bonusPercent))}% bonus credit), pay per use, balance visible in the console`,
    openai: "Pay-as-you-go with prepaid billing tiers",
    openrouter: "Prepaid credits, pay per use",
  },
  {
    label: "Rate card transparency",
    powerChampion: "Every model's rate published on one pricing page with a workload cost calculator",
    openai: "Rate card per model family",
    openrouter: "Rate per model as routed",
  },
];

export default function AlternativeToOpenAiPage() {
  return (
    <>
      <JsonLd data={faqJsonLd} />
      <main className="editorial-page seo-alt-landing" id="main-content">
        <header aria-labelledby="alt-title" className="editorial-hero">
          <p className="eyebrow">OpenAI API alternative</p>
          <h1 id="alt-title">Looking for an OpenAI API alternative?</h1>
          <p>
            Power Champion gives you one OpenAI-compatible API for open text, vision, image, speech, and
            retrieval models — with every rate published, prepaid credits, and one key instead of an account
            per provider. Keep your OpenAI SDK; change the base URL and the key.
          </p>
          <div className="seo-alt-lead-actions">
            <a className="seo-cta" href="/docs">Get started</a>
            <a className="seo-cta-secondary" href="/pricing">See published pricing</a>
          </div>
        </header>

        <section aria-labelledby="offers-title" id="offers">
          <h2 id="offers-title">What Power Champion offers</h2>
          <p>
            Power Champion is an AI platform by Power Champion Investment Limited. The API is an
            OpenAI-compatible HTTPS interface at <code>{API_BASE_URL}</code>: one key starting with
            {" "}<code>sk-b300-</code> covers chat, vision, embeddings, reranking, image generation, video
            generation, text to speech, and speech recognition. Requests are billed from a prepaid balance,
            so there is no invoice surprise — you pay per use, and you can check the balance in the console.
          </p>
          <ul>
            {MODEL_CATALOG.map((model) => (
              <li key={model.id}>
                <strong>{model.name}</strong> — {model.tagline.en} {publishedRateLabel(model)}.
              </li>
            ))}
          </ul>
          <p>
            Beyond the API, Power Champion operates dedicated NVIDIA HGX GPU infrastructure — bare-metal
            deployments, isolated enterprise clusters, and custom IDC deployment — for teams that need
            capacity of their own.
          </p>
        </section>

        <section aria-labelledby="compare-title" id="compare">
          <h2 id="compare-title">Power Champion vs OpenAI vs OpenRouter</h2>
          <div className="seo-table-scroll">
            <table className="seo-compare">
              <thead>
                <tr>
                  <th scope="col">Compare on</th>
                  <th scope="col">Power Champion</th>
                  <th scope="col">OpenAI</th>
                  <th scope="col">OpenRouter</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.powerChampion}</td>
                    <td>{row.openai}</td>
                    <td>{row.openrouter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="seo-compare-note">
            Power Champion figures come from the published rate card and catalog on this site. OpenAI and
            OpenRouter are described at a general level for orientation only — check their own pricing pages
            for current details.
          </p>
        </section>

        <section aria-labelledby="faq-title" id="faq">
          <h2 id="faq-title">Frequently asked questions</h2>
          <ul className="seo-faq-list">
            {FAQ.map((entry) => (
              <li key={entry.question}>
                <h3>{entry.question}</h3>
                <p>{entry.answer}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="closing-title" className="seo-alt-closing" id="get-started">
          <h2 id="closing-title">Switch in three steps</h2>
          <p>
            Email <a href="mailto:info@powerchampion.org">info@powerchampion.org</a> to get a key, add credit
            with a prepaid pack, then point your existing OpenAI SDK at <code>{API_BASE_URL}</code>. The
            quick start has copy-ready cURL, Python, and Node.js examples.
          </p>
          <div className="seo-alt-lead-actions">
            <a className="seo-cta" href="/docs">Get started</a>
            <a className="seo-cta-secondary" href="/models">Browse the model catalog</a>
          </div>
        </section>
      </main>
    </>
  );
}
