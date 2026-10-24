import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { StudioEditor } from "../components/studio-editor";
import { StudioNew } from "../components/studio-new";
import { StudioFrame } from "../components/studio-shell";
import { portalErrorText, PortalError } from "../lib/portal-client";
import { studioErrorText, uploadFile, UploadError } from "../lib/studio-client";
import { fail, lifestyleTemplate, project, studioFetch } from "./support/studio-fixtures";

// Seller lifestyle photos (shortvideo-agent docs/design/seller-lifestyle-photos.md): an optional step after the
// product photos, a rights checkbox for every photo, previews that can be removed, and the check results in the editor.

const RIGHTS = "我擁有或已取得這張情境照的使用權，照片中的人物（若有）已同意使用。";
const PRODUCT_RIGHTS = "我擁有或已取得這張商品照片的使用權，並同意用於產生影片。";

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

function photo(name: string) {
  return new File([new Uint8Array([255, 216, 255, 224])], name, { type: "image/jpeg" });
}

function lifestyleRoutes(extra: Record<string, unknown> = {}) {
  let n = 0;
  return studioFetch({
    "GET /studio/templates": { items: [lifestyleTemplate] },
    "POST /studio/uploads": () => {
      n += 1;
      return Response.json({ upload_id: `u_life${n}`, put_url: `https://studio-media.test/media/upload/tok${n}`, expires_at: 1 }, { status: 201 });
    },
    "PUT https://studio-media.test/media/upload/tok1": () => Response.json({ upload_id: "u_life1" }, { status: 201 }),
    "PUT https://studio-media.test/media/upload/tok2": () => Response.json({ upload_id: "u_life2" }, { status: 201 }),
    "POST /studio/projects": () => Response.json({ id: "pnew", op_id: "op1", status: "drafting", state: "submitted" }, { status: 201 }),
    ...extra,
  });
}

describe("lifestyle photo step", () => {
  it("comes after the product photos, optional, with the hint text", async () => {
    const calls = lifestyleRoutes();
    inFrame(<StudioNew navigate={() => {}} />);
    const step = await screen.findByRole("group", { name: /情境照（至少 2 張，最多 3 張）/ });
    const product = screen.getByRole("group", { name: /商品圖片/ });
    expect(product.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(step).getByText("每個商品至少要 3 張照片：1 張商品照，加上 2 張以上商品放在真實使用場景中的實拍照（廚房、書桌、車內，或正在使用中）。只有一張商品照時，影片會像在播一張圖。")).toBeInTheDocument();
    expect(within(step).getByText("（最多 3 張）")).toBeInTheDocument();
    // optional: a topic alone still creates the project, without lifestyle_ids (after the few-photos confirmation)
    await userEvent.type(screen.getByLabelText("主題"), "保溫杯");
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    await userEvent.click(await screen.findByRole("button", { name: "仍要繼續" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.path === "/studio/projects")).toBe(true));
    const created = calls.find((call) => call.method === "POST" && call.path === "/studio/projects");
    expect((created?.body as { inputs: Record<string, unknown> }).inputs).not.toHaveProperty("lifestyle_ids");
  });

  it("needs the rights checkbox for every photo before the picker opens", async () => {
    const navigate = vi.fn();
    const calls = lifestyleRoutes();
    inFrame(<StudioNew navigate={navigate} />);
    const step = await screen.findByRole("group", { name: /情境照/ });
    const picker = within(step).getByLabelText("選擇圖片");
    const box = within(step).getByRole("checkbox", { name: RIGHTS });
    expect(picker).toBeDisabled();
    expect(box).not.toBeChecked();

    await userEvent.click(box);
    expect(picker).toBeEnabled();
    await userEvent.upload(picker, photo("kitchen.jpg"));
    expect(await within(step).findByRole("img", { name: "已上傳的圖片 1" })).toHaveAttribute("src", "blob:preview");
    const tickets = calls.filter((call) => call.path === "/studio/uploads");
    expect(tickets.map((call) => call.body)).toEqual([
      { purpose: "lifestyle_image", content_type: "image/jpeg", bytes: 4, rights_confirmed: true },
    ]);
    // the next photo needs its own declaration
    await waitFor(() => expect(within(step).getByRole("checkbox", { name: RIGHTS })).not.toBeChecked());
    expect(within(step).getByLabelText("選擇圖片")).toBeDisabled();

    await userEvent.click(within(step).getByRole("checkbox", { name: RIGHTS }));
    await userEvent.upload(within(step).getByLabelText("選擇圖片"), photo("desk.jpg"));
    expect(await within(step).findByRole("img", { name: "已上傳的圖片 2" })).toBeInTheDocument();

    // the preview can drop one of them before the project is created
    await userEvent.click(within(step).getByRole("button", { name: "移除 第 1 個檔案" }));
    expect(within(step).queryByRole("img", { name: "已上傳的圖片 2" })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("主題"), "保溫杯");
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    await userEvent.click(await screen.findByRole("button", { name: "仍要繼續" })); // one lifestyle photo: asks first
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/studio/p/pnew"));
    const created = calls.find((call) => call.method === "POST" && call.path === "/studio/projects");
    expect((created?.body as { inputs: Record<string, unknown> }).inputs.lifestyle_ids).toEqual(["u_life2"]);
  });

  it("a failed create clears the lifestyle photos too and asks for a fresh upload", async () => {
    const calls = lifestyleRoutes({ "POST /studio/projects": () => fail(503, "service_unavailable") });
    inFrame(<StudioNew navigate={() => {}} />);
    const step = await screen.findByRole("group", { name: /情境照/ });
    await userEvent.click(within(step).getByRole("checkbox", { name: RIGHTS }));
    await userEvent.upload(within(step).getByLabelText("選擇圖片"), photo("kitchen.jpg"));
    expect(await within(step).findByRole("img", { name: "已上傳的圖片 1" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("主題"), "保溫杯");
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    await userEvent.click(await screen.findByRole("button", { name: "仍要繼續" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("請重新上傳商品圖片（和情境照）");
    expect(within(step).queryByRole("img", { name: "已上傳的圖片 1" })).not.toBeInTheDocument();
    const posts = calls.filter((call) => call.method === "POST" && call.path === "/studio/projects");
    expect(posts).toHaveLength(1);
    expect((posts[0].body as { inputs: Record<string, unknown> }).inputs.lifestyle_ids).toEqual(["u_life1"]);
  });

  it("product photos use the same checkbox, with the product photo statement", async () => {
    const calls = lifestyleRoutes({
      "PUT https://studio-media.test/media/upload/tok1": () => Response.json({ upload_id: "u_life1" }, { status: 201 }),
    });
    inFrame(<StudioNew navigate={() => {}} />);
    const product = await screen.findByRole("group", { name: /商品圖片/ });
    expect(within(product).queryByRole("checkbox", { name: RIGHTS })).not.toBeInTheDocument();
    expect(within(product).getByLabelText("選擇圖片")).toBeDisabled();
    await userEvent.click(within(product).getByRole("checkbox", { name: PRODUCT_RIGHTS }));
    await userEvent.upload(within(product).getByLabelText("選擇圖片"), new File([new Uint8Array([137, 80, 78, 71])], "cup.png", { type: "image/png" }));
    await waitFor(() => expect(calls.some((call) => call.path === "/studio/uploads")).toBe(true));
    expect(calls.find((call) => call.path === "/studio/uploads")?.body).toEqual({ purpose: "input_image", content_type: "image/png", bytes: 4, rights_confirmed: true });
  });

  it("shows the server's refusal when the declaration is missing", async () => {
    lifestyleRoutes({ "POST /studio/uploads": fail(400, "studio_rights_required") });
    inFrame(<StudioNew navigate={() => {}} />);
    const step = await screen.findByRole("group", { name: /情境照/ });
    await userEvent.click(within(step).getByRole("checkbox", { name: RIGHTS }));
    await userEvent.upload(within(step).getByLabelText("選擇圖片"), photo("kitchen.jpg"));
    expect(await within(step).findByRole("alert")).toHaveTextContent("請先勾選");
  });
});

describe("uploadFile", () => {
  it("refuses a lifestyle photo without the declaration before asking for an upload URL", async () => {
    const calls = studioFetch({});
    await expect(uploadFile(photo("a.jpg"), "lifestyle_image")).rejects.toBeInstanceOf(UploadError);
    await expect(uploadFile(photo("a.jpg"), "lifestyle_image")).rejects.toMatchObject({ reason: "rights" });
    expect(calls.some((call) => call.path === "/studio/uploads")).toBe(false);
  });

  it("maps studio_rights_required to one text for both kinds of photo, and quotes the statement on the client", () => {
    expect(portalErrorText(new PortalError(400, "studio_rights_required", "x"), "zh")).toContain("使用權聲明");
    expect(studioErrorText(new UploadError("rights", "x", "lifestyle_image"), "zh")).toContain(RIGHTS);
    expect(studioErrorText(new UploadError("rights", "x", "input_image"), "zh")).toContain(PRODUCT_RIGHTS);
  });
});

describe("lifestyle checks in the editor", () => {
  it("lists each photo with whether it is used and why not", async () => {
    studioFetch({
      "GET /studio/projects/p1": project({
        lifestyle: [
          { upload_id: "u_a", status: "usable", reasons: [], thumb_url: "https://studio-media.test/media/u/a.jpg?exp=1&sig=0" },
          { upload_id: "u_b", status: "not_used", reasons: ["照片看起來是截圖，或畫面上有手機、網頁介面或邊框，請上傳實拍照。"], thumb_url: null },
          { upload_id: "u_c", status: "usable", reasons: ["看起來和商品照不是同一個商品（或看不到商品）：影片仍會用這張照片，但旁白不會描述外觀。"], thumb_url: null },
        ],
      }),
    });
    inFrame(<StudioEditor projectId="p1" />);
    const panel = await screen.findByTestId("lifestyle-checks");
    const items = within(panel).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("第 1 張：會用在影片裡");
    expect(items[1]).toHaveTextContent("第 2 張：不會用在影片裡。照片看起來是截圖");
    expect(items[2]).toHaveTextContent("旁白不會描述外觀");
    expect(within(items[0]).getByRole("img", { name: "情境照 1" })).toBeInTheDocument();
  });

  it("is not shown for a project without lifestyle photos", async () => {
    studioFetch({ "GET /studio/projects/p1": project() });
    inFrame(<StudioEditor projectId="p1" />);
    await screen.findByRole("list", { name: "分鏡時間軸" });
    expect(screen.queryByTestId("lifestyle-checks")).not.toBeInTheDocument();
  });
});
