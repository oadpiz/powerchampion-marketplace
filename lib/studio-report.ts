/** The admin's monthly studio credits report (GET /admin/studio/report), and its CSV for manual invoicing. */

export type ReportGrant = { credits: number; note: string | null; created_at: number };
export type ReportRow = {
  user_id: string;
  email: string | null;
  name: string | null;
  plan: string | null;
  opening_balance: number;
  credits_granted: number;
  grants: ReportGrant[];
  credits_consumed: number;
  credits_expired: number;
  closing_balance: number;
  reserved_at_close: number;
  videos_exported: number;
  ops: number;
};
export type ReportTotals = Pick<
  ReportRow,
  "opening_balance" | "credits_granted" | "credits_consumed" | "credits_expired" | "closing_balance" | "reserved_at_close" | "videos_exported" | "ops"
>;
export type StudioReport = { month: string; timezone: string; period: { start: number; end: number }; users: ReportRow[]; totals: ReportTotals; note?: string };

const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;

/** The current calendar month in Asia/Taipei (the report's month), as YYYY-MM. */
export function taipeiMonth(now: number = Date.now()): string {
  return new Date(now + TAIPEI_OFFSET_MS).toISOString().slice(0, 7);
}

/** A ledger timestamp (epoch seconds) as an Asia/Taipei date, YYYY-MM-DD. */
export function taipeiDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000 + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/** One CSV field: quoted when needed; text a customer or admin typed cannot start a spreadsheet formula. */
function field(value: string | number | null | undefined, text = false): string {
  let out = value === null || value === undefined ? "" : String(value);
  if (text && /^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  return /[",\r\n]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
}

export const REPORT_CSV_HEADER = [
  "月份",
  "電子郵件",
  "名稱",
  "方案",
  "期初餘額（點）",
  "本月發放（點）",
  "發放明細",
  "本月消耗（點）",
  "本月到期扣除（點）",
  "期末餘額（點）",
  "期末保留中（點）",
  "匯出影片數",
  "步驟數",
] as const;

/** The report as CSV text, UTF-8 with a BOM so Excel shows the Chinese headers. One row per account, then 合計. */
export function reportCsv(report: StudioReport): string {
  const lines = [REPORT_CSV_HEADER.join(",")];
  for (const row of report.users) {
    const grants = row.grants.map((grant) => `${taipeiDate(grant.created_at)} +${grant.credits}${grant.note ? ` ${grant.note}` : ""}`).join("; ");
    lines.push(
      [
        field(report.month),
        field(row.email ?? row.user_id, true),
        field(row.name, true),
        field(row.plan ?? ""),
        field(row.opening_balance),
        field(row.credits_granted),
        field(grants, true),
        field(row.credits_consumed),
        field(row.credits_expired),
        field(row.closing_balance),
        field(row.reserved_at_close),
        field(row.videos_exported),
        field(row.ops),
      ].join(","),
    );
  }
  const t = report.totals;
  lines.push(
    [report.month, "合計", "", "", t.opening_balance, t.credits_granted, "", t.credits_consumed, t.credits_expired, t.closing_balance, t.reserved_at_close, t.videos_exported, t.ops]
      .map((value) => field(value))
      .join(","),
  );
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
