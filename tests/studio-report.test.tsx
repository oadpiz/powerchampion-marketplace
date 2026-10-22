import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminStudioSection } from "../components/admin-studio-section";
import { LocaleProvider } from "../components/locale-provider";
import { REPORT_CSV_HEADER, reportCsv, taipeiDate, taipeiMonth, type StudioReport } from "../lib/studio-report";
import { studioFetch } from "./support/studio-fixtures";

const FEB = 1_801_411_200; // 2027-02-01 00:00 Asia/Taipei
const report: StudioReport = {
  month: "2027-02",
  timezone: "Asia/Taipei",
  period: { start: FEB, end: FEB + 28 * 86400 },
  users: [
    {
      user_id: "u1", email: "maker@example.test", name: "Maker, Inc.", plan: "creator", opening_balance: 98, credits_granted: 50,
      grants: [{ credits: 50, note: "二月加值", created_at: FEB + 86400 }], credits_consumed: 14, credits_expired: 20, closing_balance: 114,
      reserved_at_close: 10, videos_exported: 1, ops: 4,
    },
    {
      user_id: "u2", email: "shop@example.test", name: "=HYPERLINK(\"x\")", plan: "merchant", opening_balance: 0, credits_granted: 4000,
      grants: [{ credits: 4000, note: "匯款 0412", created_at: FEB + 2 * 86400 }], credits_consumed: 0, credits_expired: 0, closing_balance: 4000,
      reserved_at_close: 0, videos_exported: 0, ops: 0,
    },
  ],
  totals: { opening_balance: 98, credits_granted: 4050, credits_consumed: 14, credits_expired: 20, closing_balance: 4114, reserved_at_close: 10, videos_exported: 1, ops: 4 },
};

/** The Blob's raw bytes (Blob.text() would decode, and so drop, the BOM). */
function bytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

beforeEach(() => {
  localStorage.setItem("pc-locale", "zh");
  window.history.replaceState({}, "", "/admin");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("studio report CSV", () => {
  it("starts with a BOM and the Traditional Chinese header, then one row per account and 合計", () => {
    const csv = reportCsv(report);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(REPORT_CSV_HEADER.join(","));
    expect(lines[0]).toBe("月份,電子郵件,名稱,方案,期初餘額（點）,本月發放（點）,發放明細,本月消耗（點）,本月到期扣除（點）,期末餘額（點）,期末保留中（點）,匯出影片數,步驟數");
    expect(lines[1]).toBe('2027-02,maker@example.test,"Maker, Inc.",creator,98,50,2027-02-02 +50 二月加值,14,20,114,10,1,4');
    // A customer-chosen name cannot run as a spreadsheet formula.
    expect(lines[2]).toBe(`2027-02,shop@example.test,"'=HYPERLINK(""x"")",merchant,0,4000,2027-02-03 +4000 匯款 0412,0,0,4000,0,0,0`);
    expect(lines[3]).toBe("2027-02,合計,,,98,4050,,14,20,4114,10,1,4");
    expect(lines[4]).toBe("");
  });

  it("dates grants and picks the default month in Asia/Taipei", () => {
    expect(taipeiDate(FEB - 1)).toBe("2027-01-31");
    expect(taipeiDate(FEB)).toBe("2027-02-01");
    expect(taipeiMonth(FEB * 1000 - 1000)).toBe("2027-01");
    expect(taipeiMonth(FEB * 1000)).toBe("2027-02"); // 2027-01-31 16:00 UTC
  });
});

describe("admin studio monthly report tab", () => {
  it("shows the report for the chosen month with totals, the NT$ note, and downloads the CSV", async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:x"; });
      static revokeObjectURL = vi.fn();
    });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    const calls = studioFetch(
      {
        "GET /admin/customers": { customers: [] },
        [`GET /admin/studio/usage?month=${new Date().toISOString().slice(0, 7)}`]: { month: "x", agent_status: "ok", gpu_usd_per_hour: 2.08, users: [] },
        [`GET /admin/studio/report?month=${taipeiMonth()}`]: { ...report, month: taipeiMonth(), users: [], totals: { ...report.totals, opening_balance: 0 } },
        "GET /admin/studio/report?month=2027-02": report,
      },
      "admin",
    );
    render(
      <LocaleProvider>
        <AdminStudioSection />
      </LocaleProvider>,
    );
    const tab = await screen.findByRole("tab", { name: "月報（開發票用）" });
    expect(screen.getByRole("tab", { name: "使用量" })).toHaveAttribute("aria-selected", "true");
    await user.click(tab);
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("這個月份沒有點數紀錄。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下載 CSV" })).toBeDisabled();
    const panel = screen.getByRole("tabpanel");
    const month = within(panel).getByLabelText("月份");
    expect(month).toHaveValue(taipeiMonth());
    fireEvent.change(month, { target: { value: "2027-02" } });
    const table = await screen.findByRole("table", { name: "各帳號點數月報" });
    expect(calls.some((call) => call.path === "/admin/studio/report?month=2027-02")).toBe(true);
    expect(screen.getByText(/1 點 = NT\$1 牌價/)).toHaveTextContent("Creator 1,000 點 NT$990、Merchant 4,000 點 NT$2,990、Agency 15,000 點 NT$9,900");
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("maker@example.test");
    expect(rows[1]).toHaveTextContent("2027-02-02 +50 二月加值");
    expect(rows[1]).toHaveTextContent("（其中 10 保留中）");
    expect(rows[2]).toHaveTextContent("Merchant");
    expect(rows[3]).toHaveTextContent(/合計.*98.*4,050.*14.*20.*4,114.*1.*4/);
    await user.click(screen.getByRole("button", { name: "下載 CSV" }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(names).toEqual(["studio-credits-2027-02.csv"]);
    expect(blobs[0].type).toBe("text/csv;charset=utf-8");
    const head = await bytes(blobs[0]);
    expect([...head.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(head.slice(3)).split("\r\n")[0]).toBe(REPORT_CSV_HEADER.join(","));
  });
});
