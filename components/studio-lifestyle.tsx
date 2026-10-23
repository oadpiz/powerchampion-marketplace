"use client";

import type { LifestyleStatus } from "../lib/studio-client";

const STATUS_TEXT: Record<string, [string, string]> = {
  usable: ["會用在影片裡", "Used in the video"],
  not_used: ["不會用在影片裡", "Not used in the video"],
  pending: ["產生分鏡時會先檢查", "Checked when the storyboard is written"],
  missing: ["已刪除", "Deleted"],
};

/** The seller's lifestyle photos and what their checks found (safety, collage, screenshot, other brands, same product). */
export function LifestyleChecks({ items, zh }: { items: LifestyleStatus[] | undefined; zh: boolean }) {
  if (!items?.length) return null;
  return (
    <section className="portal-note" aria-label={zh ? "情境照檢查" : "Lifestyle photo checks"} data-testid="lifestyle-checks">
      <strong>{zh ? "情境照檢查" : "Lifestyle photo checks"}</strong>
      <ul className="studio-lifestyle-checks">
        {items.map((item, position) => (
          <li key={item.upload_id} data-status={item.status}>
            {item.thumb_url ? (
              // The studio media host's signed thumbnail.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumb_url} alt={zh ? `情境照 ${position + 1}` : `Lifestyle photo ${position + 1}`} />
            ) : null}
            <span>
              {zh ? `第 ${position + 1} 張：` : `Photo ${position + 1}: `}
              {(STATUS_TEXT[item.status] ?? [item.status, item.status])[zh ? 0 : 1]}
              {item.reasons.length > 0 && <>{zh ? "。" : ". "}{item.reasons.join(" ")}</>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
