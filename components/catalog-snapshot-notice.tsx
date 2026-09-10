"use client";

import { useLocale } from "./locale-provider";

/**
 * Says out loud that the catalogue on screen is a build-time snapshot rather
 * than the gateway's live answer. Renders nothing when the fetch succeeded —
 * silence means live.
 */
export function CatalogSnapshotNotice({ snapshotDate }: { snapshotDate: string | null }) {
  const { copy } = useLocale();
  if (!snapshotDate) return null;

  return (
    <p className="catalog-snapshot-notice" role="status">
      {copy.shared.catalogSnapshotNotice.replace("{date}", snapshotDate)}
    </p>
  );
}
