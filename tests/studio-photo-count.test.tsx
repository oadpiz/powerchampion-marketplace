import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { StudioEditor } from "../components/studio-editor";
import { StudioNew } from "../components/studio-new";
import { StudioFrame } from "../components/studio-shell";
import { lifestyleTemplate, project, studioFetch, template, type Call } from "./support/studio-fixtures";

// Soft photo-count requirement (shortvideo-agent docs/design/seller-lifestyle-photos.md): each product should have
// 3 photos, 1 product shot + at least 2 lifestyle photos. Fewer asks the seller to confirm; it never blocks.

const RIGHTS = "我擁有或已取得這張情境照的使用權，照片中的人物（若有）已同意使用。";
const TITLE = "影片可能像在播一張圖，仍要繼續？";
const SUBMIT = "產生分鏡（免費）";

const inFrame = (node: React.ReactNode) =>
  render(
    <LocaleProvider>
      <StudioFrame>{node}</StudioFrame>
    </LocaleProvider>,
  );

beforeEach(() => {
  localStorage.setItem("pc-locale", "zh");
  window.history.replaceState({}, "", "/studio");
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const WARNING = {
  code: "few_lifestyle_photos",
  message_zh: "情境照只有 1 張，建議至少 2 張。每個商品建議 3 張照片：1 張商品照、2 張情境照；照片不夠時，影片可能像在播一張圖。專案已照常建立。",
  message_en: "Only 1 lifestyle photo; at least 2 are recommended.",
  lifestyle_count: 1,
  recommended_min: 2,
};

function routes(created: Record<string, unknown> = { warnings: [] }, items = [lifestyleTemplate]) {
  let n = 0;
  const media: Record<string, unknown> = {};
  for (let i = 1; i <= 3; i += 1)
    media[`PUT https://studio-media.test/media/upload/tok${i}`] = () => Response.json({ upload_id: `u_life${i}` }, { status: 201 });
  return studioFetch({
    "GET /studio/templates": { items },
    "POST /studio/uploads": () => {
      n += 1;
      return Response.json({ upload_id: `u_life${n}`, put_url: `https://studio-media.test/media/upload/tok${n}`, expires_at: 1 }, { status: 201 });
    },
    ...media,
    "POST /studio/projects": () => Response.json({ id: "pnew", op_id: "op1", status: "drafting", state: "submitted", ...created }, { status: 201 }),
    "GET /studio/projects/pnew": project({ id: "pnew" }),
  });
}

const creates = (calls: Call[]) => calls.filter((call) => call.method === "POST" && call.path === "/studio/projects");

async function addLifestyle(count: number) {
  const step = await screen.findByRole("group", { name: /情境照/ });
  for (let i = 1; i <= count; i += 1) {
    await userEvent.click(within(step).getByRole("checkbox", { name: RIGHTS }));
    await userEvent.upload(within(step).getByLabelText("選擇圖片"), new File([new Uint8Array([255, 216, 255, 224])], `life${i}.jpg`, { type: "image/jpeg" }));
    expect(await within(step).findByRole("img", { name: `已上傳的圖片 ${i}` })).toBeInTheDocument();
    await waitFor(() => expect(within(step).getByRole("checkbox", { name: RIGHTS })).not.toBeChecked());
  }
}

describe("few lifestyle photos: confirm before creating", () => {
  it("with 0 photos asks first; 「回去補照片」 sends nothing and keeps the form", async () => {
    const navigate = vi.fn();
    const calls = routes();
    inFrame(<StudioNew navigate={navigate} />);
    await userEvent.type(await screen.findByLabelText("主題"), "保溫杯");
    await userEvent.click(screen.getByRole("button", { name: SUBMIT }));
    const dialog = await screen.findByRole("dialog", { name: TITLE });
    expect(within(dialog).getByTestId("few-lifestyle-confirm")).toHaveTextContent("目前有 0 張情境照。建議每個商品至少 3 張照片：1 張商品照、2 張情境照");
    expect(within(dialog).getByRole("button", { name: "仍要繼續" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "回去補照片" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(creates(calls)).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("主題")).toHaveValue("保溫杯");
    expect(screen.getByRole("button", { name: SUBMIT })).toBeEnabled();
  });

  it("with 1 photo asks first; 「回去補照片」 keeps the photo, 「仍要繼續」 creates", async () => {
    const navigate = vi.fn();
    const calls = routes();
    inFrame(<StudioNew navigate={navigate} />);
    await userEvent.type(await screen.findByLabelText("主題"), "保溫杯");
    await addLifestyle(1);
    await userEvent.click(screen.getByRole("button", { name: SUBMIT }));
    let dialog = await screen.findByRole("dialog", { name: TITLE });
    expect(within(dialog).getByTestId("few-lifestyle-confirm")).toHaveTextContent("目前有 1 張情境照");
    await userEvent.click(within(dialog).getByRole("button", { name: "回去補照片" }));
    expect(creates(calls)).toEqual([]);
    expect(screen.getByRole("img", { name: "已上傳的圖片 1" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: SUBMIT }));
    dialog = await screen.findByRole("dialog", { name: TITLE });
    await userEvent.click(within(dialog).getByRole("button", { name: "仍要繼續" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/studio/p/pnew"));
    expect(creates(calls)).toHaveLength(1);
    expect((creates(calls)[0].body as { inputs: Record<string, unknown> }).inputs).toMatchObject({ topic: "保溫杯", lifestyle_ids: ["u_life1"] });
  });

  it("with 2 photos creates without asking", async () => {
    const navigate = vi.fn();
    const calls = routes();
    inFrame(<StudioNew navigate={navigate} />);
    await userEvent.type(await screen.findByLabelText("主題"), "保溫杯");
    await addLifestyle(2);
    await userEvent.click(screen.getByRole("button", { name: SUBMIT }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/studio/p/pnew"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect((creates(calls)[0].body as { inputs: Record<string, unknown> }).inputs.lifestyle_ids).toEqual(["u_life1", "u_life2"]);
  });

  it("a template without a lifestyle step never asks", async () => {
    const navigate = vi.fn();
    const calls = routes({ warnings: [] }, [template]);
    inFrame(<StudioNew navigate={navigate} />);
    await userEvent.type(await screen.findByLabelText("主題"), "保溫杯");
    await userEvent.click(screen.getByRole("button", { name: SUBMIT }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/studio/p/pnew"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(creates(calls)).toHaveLength(1);
  });
});

describe("the create response's warning", () => {
  it("is shown once on the new project's page", async () => {
    const navigate = vi.fn();
    routes({ warnings: [WARNING] });
    const form = inFrame(<StudioNew navigate={navigate} />);
    await userEvent.type(await screen.findByLabelText("主題"), "保溫杯");
    await addLifestyle(1);
    await userEvent.click(screen.getByRole("button", { name: SUBMIT }));
    await userEvent.click(await screen.findByRole("button", { name: "仍要繼續" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/studio/p/pnew"));
    form.unmount();

    const editor = inFrame(<StudioEditor projectId="pnew" />);
    const shown = await screen.findByTestId("create-warnings");
    expect(shown).toHaveTextContent(WARNING.message_zh);
    expect(shown).toHaveAttribute("role", "status");
    await userEvent.click(within(shown).getByRole("button", { name: "關閉" }));
    expect(screen.queryByTestId("create-warnings")).not.toBeInTheDocument();
    editor.unmount();

    // opening the project again does not repeat it
    inFrame(<StudioEditor projectId="pnew" />);
    await screen.findByRole("list", { name: "分鏡時間軸" });
    expect(screen.queryByTestId("create-warnings")).not.toBeInTheDocument();
  });

  it("is not shown when the response has none", async () => {
    const navigate = vi.fn();
    routes({ warnings: [] });
    const form = inFrame(<StudioNew navigate={navigate} />);
    await userEvent.type(await screen.findByLabelText("主題"), "保溫杯");
    await addLifestyle(2);
    await userEvent.click(screen.getByRole("button", { name: SUBMIT }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/studio/p/pnew"));
    form.unmount();
    inFrame(<StudioEditor projectId="pnew" />);
    await screen.findByRole("list", { name: "分鏡時間軸" });
    expect(screen.queryByTestId("create-warnings")).not.toBeInTheDocument();
  });
});
