"use client";

import { Fragment, useState, type ReactNode } from "react";
import {
  API_REFERENCE_COPY,
  type ApiReferenceBlock,
  type ApiReferenceCopy,
} from "../lib/api-reference";
import type { GatewayStatus } from "../lib/gateway-status";
import { useLocale } from "./locale-provider";

type Props = {
  gateway: GatewayStatus | null;
};

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

/** Render **bold**, `code` spans and [label](href) links inside plain copy strings. */
export function renderInline(text: string): ReactNode {
  return text.split(TOKEN).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{renderInline(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      return <a href={link[2]} key={index}>{link[1]}</a>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  const { copy } = useLocale();
  const [feedback, setFeedback] = useState<"copied" | "unavailable" | null>(null);

  async function copyCode() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(code);
      setFeedback("copied");
    } catch {
      setFeedback("unavailable");
    }
  }

  return (
    <figure className="code-sample-panel api-ref-code">
      <div className="code-sample-actions">
        <figcaption>{label}</figcaption>
        <span className="api-ref-code-actions">
          <span aria-live="polite" role="status">
            {feedback === "copied" ? copy.docs.copied : feedback === "unavailable" ? copy.shared.copyUnavailable : ""}
          </span>
          <button aria-label={`${copy.docs.copy}: ${label}`} onClick={copyCode} type="button">{copy.docs.copy}</button>
        </span>
      </div>
      <pre><code>{code}</code></pre>
    </figure>
  );
}

function ScrollTable({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <>
      <p aria-hidden="true" className="api-ref-scroll-hint">{hint}</p>
      {/* A focusable, labelled region lets keyboard users scroll wide tables. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div aria-label={label} className="api-ref-table-scroll" role="region" tabIndex={0}>
        {children}
      </div>
    </>
  );
}

function ModelsTable({
  block,
  text,
  gateway,
  hint,
}: {
  block: Extract<ApiReferenceBlock, { kind: "models" }>;
  text: ApiReferenceCopy["models"];
  gateway: GatewayStatus | null;
  hint: string;
}) {
  const live = new Map((gateway?.models ?? []).map((model) => [model.id, model.ready]));
  return (
    <>
      <ScrollTable hint={hint} label={block.label}>
        <table className={`api-ref-table api-ref-models${block.wide ? "" : " api-ref-models-compact"}`}>
          <thead>
            <tr>
              {block.head.map((cell) => <th key={cell} scope="col">{cell}</th>)}
              <th scope="col">{text.statusHead}</th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => {
              const ready = live.get(row.id);
              const state = ready === true ? "online" : ready === false ? "offline" : "unknown";
              return (
                <tr key={row.id}>
                  <th scope="row"><code>{row.id}</code></th>
                  {row.cells.map((cell, index) => <td key={index}>{renderInline(cell)}</td>)}
                  <td><span className={`api-ref-state api-ref-state-${state}`}>{text[state]}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>
      {block.statusNote ? <p className="api-ref-table-note">{gateway ? text.liveNote : text.fallbackNote}</p> : null}
    </>
  );
}

function Block({ block, copy, gateway }: { block: ApiReferenceBlock; copy: ApiReferenceCopy; gateway: GatewayStatus | null }) {
  switch (block.kind) {
    case "p":
      return <p>{renderInline(block.text)}</p>;
    case "note":
      return <p className="api-ref-note">{renderInline(block.text)}</p>;
    case "h3":
      return <h3 id={block.id}>{renderInline(block.text)}</h3>;
    case "ul":
      return <ul>{block.items.map((item) => <li key={item}>{renderInline(item)}</li>)}</ul>;
    case "ol":
      return <ol>{block.items.map((item) => <li key={item}>{renderInline(item)}</li>)}</ol>;
    case "code":
      return <CodeBlock code={block.code} label={block.label} />;
    case "models":
      return <ModelsTable block={block} gateway={gateway} hint={copy.tableScrollHint} text={copy.models} />;
    case "table":
      return (
        <ScrollTable hint={copy.tableScrollHint} label={block.label}>
          <table className="api-ref-table">
            <thead>
              <tr>{block.head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, index) => (index === 0
                    ? <th key={index} scope="row">{renderInline(cell)}</th>
                    : <td key={index}>{renderInline(cell)}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      );
  }
}

export function ApiReferenceContent({ gateway }: Props) {
  const { locale } = useLocale();
  const copy = API_REFERENCE_COPY[locale];

  return (
    <main className="docs-page api-ref-page" id="main-content">
      <section aria-labelledby="api-ref-title" className="docs-intro">
        <p className="eyebrow">{copy.kicker}</p>
        <h1 id="api-ref-title">{copy.title}</h1>
        <p>{copy.lead}</p>
        <p className="docs-notice">{copy.version}</p>
        <p className="api-ref-back"><a href="/docs">← {copy.backToDocs}</a></p>
      </section>

      <nav aria-label={copy.tocLabel} className="api-ref-toc">
        <h2>{copy.tocLabel}</h2>
        <ol>
          {copy.sections.map((section) => (
            <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
          ))}
        </ol>
      </nav>

      {copy.sections.map((section) => (
        <section aria-labelledby={section.id} className="docs-quick-start api-ref-section" key={section.id}>
          <h2 id={section.id}>{section.title}</h2>
          {section.blocks.map((block, index) => (
            <Block block={block} copy={copy} gateway={gateway} key={`${section.id}-${index}`} />
          ))}
        </section>
      ))}
    </main>
  );
}
