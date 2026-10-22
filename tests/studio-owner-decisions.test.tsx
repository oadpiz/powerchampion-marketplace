import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { StudioCreditsPage } from "../components/studio-credits";
import { StudioEditor } from "../components/studio-editor";
import { StudioHome } from "../components/studio-home";
import { StudioNew } from "../components/studio-new";
import { StudioFrame } from "../components/studio-shell";
import { draftPriceLabel, enumOptions } from "../lib/studio-client";
import { credits, fail, project, quote, studioFetch, template } from "./support/studio-fixtures";

const inFrame = (node: React.ReactNode) =>
  render(
    <LocaleProvider>
      <StudioFrame>{node}</StudioFrame>
    </LocaleProvider>,
  );
const drafts = (remaining: number) => ({ limit: 30, used: 30 - remaining, remaining, resets_at: 1_800_028_800 });
const LIMIT_TEXT = "今天產生分鏡的次數已達上限（每天 30 次），明天再試，或聯絡我們。";
/** A paragraph whose whole text (links included) matches. */
const paragraph = (text: string | RegExp) => (_: string, element: Element | null) =>
  element?.tagName === "P" && (typeof text === "string" ? element.textContent === text : text.test(element.textContent ?? ""));

beforeEach(() => {
  localStorage.setItem("pc-locale", "zh");
  window.history.replaceState({}, "", "/studio/new");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("free drafts with a daily cap", () => {
  it("labels the draft free, needs no credits, and shows today's remaining drafts", async () => {
    const calls = studioFetch({
      "GET /studio/credits": { ...credits, balance: 0, drafts: drafts(29) },
      "POST /studio/projects": () => Response.json({ id: "pnew", op_id: "op1", status: "drafting", state: "submitted" }, { status: 201 }),
    });
    const navigate = vi.fn();
    inFrame(<StudioNew navigate={navigate} />);
    await userEvent.type(await screen.findByLabelText("主題"), "保溫杯");
    expect(await screen.findByText("今天還可以免費產生 29 次分鏡")).toBeInTheDocument();
    expect(screen.queryByText(/可用點數不足/)).not.toBeInTheDocument();
    expect(screen.getByText(/分鏡免費/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "產生分鏡（免費）" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(calls.some((call) => call.method === "POST" && call.path === "/studio/projects")).toBe(true);
  });

  it("explains the limit when today's drafts are used up", async () => {
    studioFetch({ "GET /studio/credits": { ...credits, drafts: drafts(0) } });
    inFrame(<StudioNew navigate={() => {}} />);
    await screen.findByLabelText("主題");
    const note = await screen.findByText(paragraph(LIMIT_TEXT));
    expect(within(note).getByRole("link", { name: "聯絡我們" })).toHaveAttribute("href", "/contact");
    expect(screen.getByRole("button", { name: "產生分鏡（免費）" })).toBeDisabled();
  });

  it("maps a 429 studio_draft_limit to the same text, in English too", async () => {
    studioFetch({ "POST /studio/projects": fail(429, "studio_draft_limit") });
    inFrame(<StudioNew navigate={() => {}} />);
    await userEvent.type(await screen.findByLabelText("主題"), "保溫杯");
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(LIMIT_TEXT);
    expect(within(alert).getByRole("link", { name: "聯絡我們" })).toHaveAttribute("href", "/contact");
  });

  it("has an English text for the limit and a free label", async () => {
    localStorage.setItem("pc-locale", "en");
    studioFetch({ "GET /studio/credits": { ...credits, drafts: drafts(0) } });
    inFrame(<StudioNew navigate={() => {}} />);
    expect(await screen.findByText(paragraph(/You have used today's 30 free storyboards\. Try again tomorrow, or contact us\./))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write storyboard (free)" })).toBeDisabled();
    expect(draftPriceLabel(0, "zh")).toBe("免費");
    expect(draftPriceLabel(3, "en")).toBe("3 credits");
  });

  it("says drafts are free in the empty list and the editor", async () => {
    window.history.replaceState({}, "", "/studio");
    studioFetch({ "GET /studio/projects?limit=20": { items: [], next: null } });
    inFrame(<StudioHome />);
    expect(await screen.findByText(/產生分鏡免費/)).toBeInTheDocument();
    expect(screen.queryByText(/2 點/)).not.toBeInTheDocument();
  });

  it("shows the remaining drafts next to the editor's storyboard button", async () => {
    window.history.replaceState({}, "", "/studio/p/p1");
    studioFetch({
      "GET /studio/credits": { ...credits, drafts: drafts(12) },
      "GET /studio/projects/p1": project({ status: "failed_draft", shots: [], storyboard_rev: 0 }),
    });
    inFrame(<StudioEditor projectId="p1" />);
    expect(await screen.findByRole("button", { name: "產生分鏡（免費）" })).toBeInTheDocument();
    expect(screen.getByText("今天還可以免費產生 12 次分鏡")).toBeInTheDocument();
  });
});

describe("top-up until online payment exists", () => {
  it("the credits page says points are added by the team, links to the contact page and has no payment UI", async () => {
    window.history.replaceState({}, "", "/studio/credits");
    studioFetch({});
    inFrame(<StudioCreditsPage />);
    const note = await screen.findByText(/點數由團隊人工加值/);
    expect(within(note).getByRole("link", { name: "聯絡我們" })).toHaveAttribute("href", "/contact");
    expect(screen.queryByRole("button", { name: /付款|購買|儲值|加值/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("the 402 dialog offers the contact page as well as the credits page", async () => {
    window.history.replaceState({}, "", "/studio/p/p1");
    studioFetch({
      "GET /studio/projects/p1": project(),
      "POST /studio/projects/p1/quote": (body: unknown) => quote(2, (body as { type: string }).type, "1"),
      "POST /studio/projects/p1/ops": fail(402, "studio_insufficient_credits"),
    });
    inFrame(<StudioEditor projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: "重新產生這一鏡" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "確認（2 點）" }));
    const alert = await within(dialog).findByRole("alert");
    expect(within(alert).getByRole("link", { name: "聯絡我們" })).toHaveAttribute("href", "/contact");
    expect(within(alert).getByRole("link", { name: "查看點數" })).toHaveAttribute("href", "/studio/credits");
    expect(alert).toHaveTextContent("點數由團隊人工加值");
  });

  it("a 402 on create offers the contact page too", async () => {
    studioFetch({ "POST /studio/projects": fail(402, "studio_insufficient_credits") });
    inFrame(<StudioNew navigate={() => {}} />);
    await userEvent.type(await screen.findByLabelText("主題"), "保溫杯");
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: "聯絡我們" })).toHaveAttribute("href", "/contact");
  });
});

describe("no narration (voice none)", () => {
  const voice = template.project_schema.properties!.voice;

  it("offers none to everyone and internal voices to admins only", () => {
    expect(enumOptions("voice", voice, "zh", false).map((o) => o.label)).toEqual(["無配音（只有字幕）", "studio_female"]);
    expect(enumOptions("voice", voice, "zh", true).map((o) => o.value)).toEqual(["none", "tw_ref", "studio_female"]);
    expect(enumOptions("voice", { ...voice, "x-enum-labels": undefined }, "en", false)[0].label).toBe("No voiceover (subtitles only)");
  });

  it("lets a customer render a project with no narration, and points a project on an internal voice to it", async () => {
    window.history.replaceState({}, "", "/studio/p/p1");
    studioFetch({ "GET /studio/projects/p1": project({ settings: { voice: "none", subtitles: true, music_upload_id: null, music_rights_confirmed: false } }) });
    const first = inFrame(<StudioEditor projectId="p1" />);
    await screen.findByRole("button", { name: "重新產生這一鏡" });
    expect(screen.queryByText(/目前沒有可對外使用的配音/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新產生這一鏡" })).toBeEnabled();
    first.unmount();
    studioFetch({ "GET /studio/projects/p1": project({ settings: { voice: "tw_ref", subtitles: true, music_upload_id: null, music_rights_confirmed: false } }) });
    inFrame(<StudioEditor projectId="p1" />);
    expect(await screen.findByText(/改成「無配音（只有字幕）」/)).toBeInTheDocument();
  });
});

describe("agent 2e7c38e shapes: outdated exports and expired projects", () => {
  const exported = (outdated: boolean | null) => ({
    "9:16": { url: "https://studio-media.test/media/a/v.mp4?exp=1&sig=" + "0".repeat(64), rendered_at: 1, duration: 30, outdated },
    "16:9": null,
  });

  it("asks for a free re-export after a caption-only edit", async () => {
    window.history.replaceState({}, "", "/studio/p/p1");
    studioFetch({ "GET /studio/projects/p1": project({ exports: exported(true) }) });
    inFrame(<StudioEditor projectId="p1" />);
    const button = await screen.findByRole("button", { name: /匯出 9:16/ });
    expect(button).toHaveTextContent("字幕已更新，重新匯出（免費）");
  });

  it("shows no hint for an export that is current", async () => {
    window.history.replaceState({}, "", "/studio/p/p1");
    studioFetch({ "GET /studio/projects/p1": project({ exports: exported(false) }) });
    inFrame(<StudioEditor projectId="p1" />);
    await screen.findByRole("button", { name: /匯出 9:16/ });
    expect(screen.queryByText(/字幕已更新/)).not.toBeInTheDocument();
  });

  it("explains an expired project in the editor, in both languages", async () => {
    window.history.replaceState({}, "", "/studio/p/p1");
    studioFetch({ "GET /studio/projects/p1": project({ expired: true }) });
    const zh = inFrame(<StudioEditor projectId="p1" />);
    expect(await screen.findByText("此專案的素材已超過保存期限被清除，重新產生需要點數。")).toBeInTheDocument();
    zh.unmount();
    localStorage.setItem("pc-locale", "en");
    inFrame(<StudioEditor projectId="p1" />);
    expect(
      await screen.findByText("This project's media passed its retention period and was deleted. Generating it again costs credits."),
    ).toBeInTheDocument();
  });

  it("badges an expired project in the list", async () => {
    window.history.replaceState({}, "", "/studio");
    studioFetch({
      "GET /studio/projects?limit=20": {
        items: [
          { id: "p1", title: "舊影片", template_id: "ecommerce", status: "ready", thumb_url: null, updated_at: 1, expired: true },
          { id: "p2", title: "新影片", template_id: "ecommerce", status: "ready", thumb_url: null, updated_at: 2, expired: false },
        ],
        next: null,
      },
    });
    inFrame(<StudioHome />);
    expect(await screen.findByRole("link", { name: /舊影片/ })).toHaveTextContent("素材已清除");
    expect(screen.getByRole("link", { name: /新影片/ })).not.toHaveTextContent("素材已清除");
  });
});
