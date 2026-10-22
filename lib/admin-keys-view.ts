/**
 * Pure helpers for the admin API keys page: status, balance level, search and
 * filter matching, the URL query that keeps the filters, and relative times.
 * Kept free of React so the rules are easy to test on their own.
 */

export type KeyOwner = { id: string; email: string; name: string };

/** The fields of a gateway key these helpers read. */
export type KeyLike = {
  gatewayKeyId: string;
  prefix: string;
  label: string;
  balanceUsd: string | null;
  disabledAt: string | number | null;
  expiresAt: string | number | null;
  owner: KeyOwner | null;
};

/** Prepaid keys below this balance (USD) are flagged as low. */
export const LOW_BALANCE_USD = 5;

/** Customer filter value for keys that belong to no customer account. */
export const NO_OWNER = "none";

export type StatusFilter = "all" | "active" | "disabled" | "low";
export const STATUS_FILTERS: StatusFilter[] = ["all", "active", "disabled", "low"];

export type KeyFilters = { query: string; customer: string; status: StatusFilter };
export const EMPTY_FILTERS: KeyFilters = { query: "", customer: "", status: "all" };

export type BalanceLevel = "postpaid" | "empty" | "low" | "ok";

/** Parses the timestamps the gateway sends: seconds, milliseconds, or ISO strings. */
export function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : null;
  const date = numeric === null ? new Date(value) : new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function balanceLevel(balanceUsd: string | null): BalanceLevel {
  if (balanceUsd === null) return "postpaid";
  const amount = Number(balanceUsd);
  if (!Number.isFinite(amount)) return "ok";
  if (amount <= 0) return "empty";
  return amount < LOW_BALANCE_USD ? "low" : "ok";
}

/** A prepaid key with little or no balance left. */
export function isLowBalance(key: KeyLike): boolean {
  const level = balanceLevel(key.balanceUsd);
  return level === "low" || level === "empty";
}

export function isDisabled(key: KeyLike): boolean {
  return key.disabledAt !== null && key.disabledAt !== "";
}

export function isExpired(key: KeyLike, now: number = Date.now()): boolean {
  const expires = toDate(key.expiresAt);
  return expires !== null && expires.getTime() <= now;
}

export function matchesStatus(key: KeyLike, status: StatusFilter): boolean {
  if (status === "active") return !isDisabled(key);
  if (status === "disabled") return isDisabled(key);
  if (status === "low") return isLowBalance(key);
  return true;
}

export function matchesFilters(key: KeyLike, filters: KeyFilters): boolean {
  if (filters.customer === NO_OWNER ? key.owner !== null : filters.customer !== "" && key.owner?.id !== filters.customer)
    return false;
  if (!matchesStatus(key, filters.status)) return false;
  const query = filters.query.trim().toLowerCase();
  if (query === "") return true;
  return [key.label, key.prefix, key.gatewayKeyId, key.owner?.email ?? "", key.owner?.name ?? ""]
    .join("\n")
    .toLowerCase()
    .includes(query);
}

export function statusCounts(keys: KeyLike[]): Record<StatusFilter, number> {
  return {
    all: keys.length,
    active: keys.filter((key) => matchesStatus(key, "active")).length,
    disabled: keys.filter((key) => matchesStatus(key, "disabled")).length,
    low: keys.filter((key) => matchesStatus(key, "low")).length,
  };
}

/** The customers that own at least one key, sorted by how they are shown. */
export function customerOptions(keys: KeyLike[]): { owners: KeyOwner[]; hasUnowned: boolean } {
  const owners = new Map<string, KeyOwner>();
  let hasUnowned = false;
  for (const key of keys) {
    if (key.owner === null) hasUnowned = true;
    else if (!owners.has(key.owner.id)) owners.set(key.owner.id, key.owner);
  }
  const display = (owner: KeyOwner) => (owner.name || owner.email).toLowerCase();
  return { owners: [...owners.values()].sort((a, b) => display(a).localeCompare(display(b))), hasUnowned };
}

export function filtersFromSearch(search: string): KeyFilters {
  const params = new URLSearchParams(search);
  const status = params.get("status");
  return {
    query: (params.get("q") ?? "").slice(0, 200),
    customer: (params.get("customer") ?? "").slice(0, 200),
    status: STATUS_FILTERS.includes(status as StatusFilter) ? (status as StatusFilter) : "all",
  };
}

/** Writes the filters into a query string, keeping any unrelated parameters. */
export function searchWithFilters(search: string, filters: KeyFilters): string {
  const params = new URLSearchParams(search);
  const set = (name: string, value: string) => (value ? params.set(name, value) : params.delete(name));
  set("q", filters.query);
  set("customer", filters.customer);
  set("status", filters.status === "all" ? "" : filters.status);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** "3 小時前" / "3 hours ago"; dates older than 30 days fall back to the calendar date. */
export function relativeTimeLabel(value: string | number | null, zh: boolean, now: number = Date.now()): string {
  if (value === null || value === "") return zh ? "從未使用" : "Never used";
  const date = toDate(value);
  if (date === null) return zh ? "日期未提供" : "Date unavailable";
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return zh ? "剛剛" : "Just now";
  const format = new Intl.RelativeTimeFormat(zh ? "zh-TW" : "en-US", { numeric: "always" });
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
  if (abs < 30 * 86400) return format.format(Math.round(seconds / 86400), "day");
  return new Intl.DateTimeFormat(zh ? "zh-TW" : "en-US", { dateStyle: "medium" }).format(date);
}
