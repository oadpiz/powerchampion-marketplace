import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InfrastructureContent } from "../components/infrastructure-content";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";
import { InternationalSite } from "../components/international-site";

describe("InfrastructureContent", () => {
  it("qualifies infrastructure figures beside the source-backed facts", () => {
    render(<LocaleProvider><InfrastructureContent gateway={null} /></LocaleProvider>);
    const capacity = screen.getByRole("region", { name: /Capacity context/i });

    expect(within(capacity).getByText("Approximately 3.1 MW")).toBeVisible();
    expect(within(capacity).getByText(/not live or completed deployment/i)).toBeVisible();
    expect(within(capacity).getByRole("link", { name: /SEC-filed/i })).toHaveAttribute(
      "href",
      "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986209.htm",
    );
    expect(screen.getByRole("link", { name: "Deployment review" })).toHaveAttribute("href", "/contact");
  });

  it("presents useful configuration details before public capacity context", () => {
    render(<LocaleProvider><InfrastructureContent gateway={null} /></LocaleProvider>);
    const platforms = screen.getByRole("region", { name: "Choose a GPU platform for the job." });
    const capacity = screen.getByRole("region", { name: "Capacity context" });
    expect(platforms.compareDocumentPosition(capacity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(platforms).getByRole("cell", { name: "NVIDIA HGX B300 / B200" })).toBeVisible();
    expect(within(platforms).getByText(/do not represent immediately reservable inventory/)).toBeVisible();
    expect(screen.getByRole("region", { name: "From workload brief to deployment scope" })).toBeVisible();
    const inputs = screen.getByRole("region", { name: "Deployment review inputs" });
    expect(within(inputs).getAllByRole("term")).toHaveLength(6);
    expect(within(inputs).getByText(/target latency/)).toBeVisible();
    const serving = screen.getByRole("heading", { name: "Serving controls" }).closest("li");
    expect(serving).toHaveTextContent("Not verified");
    expect(serving).toHaveAttribute("data-ready", "false");
  });

  it("changes planning questions and links to the corresponding translated infrastructure page", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/infrastructure");
    const english = render(<LocaleProvider><SiteShell><InfrastructureContent gateway={null} /></SiteShell></LocaleProvider>);
    const training = screen.getByRole("button", { name: "Training & fine-tuning" });
    expect(screen.getByText("Which models and precision will you serve?")).toBeVisible();
    await user.click(training);
    expect(training).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Production inference" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Which models and precision will you serve?")).not.toBeInTheDocument();
    expect(screen.getByText("Are you pretraining, fine-tuning, or adapting an existing model?")).toBeVisible();
    expect(screen.getByRole("link", { name: "Discuss this workload" })).toHaveAttribute("href", "/contact");

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Language: English" }));
    const languages = within(screen.getByRole("navigation", { name: "Website language" }));
    expect(languages.getByRole("link", { name: "繁體中文" })).toHaveAttribute("href", "/zh-Hant/infrastructure");
    expect(languages.getByRole("link", { name: "한국어" })).toHaveAttribute("href", "/ko/infrastructure");
    expect(training).toHaveAttribute("aria-pressed", "true");
    english.unmount();
    window.history.replaceState({}, "", "/zh-Hant/infrastructure");
    render(<LocaleProvider><InternationalSite language="zh-Hant" section="infrastructure" /></LocaleProvider>);
    expect(screen.getByRole("heading", { level: 1, name: "為你的工作負載，規劃算力。" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "NVIDIA HGX B300 / B200" })).toBeVisible();
    expect(screen.getByText(/不代表即時庫存.*均須以專案提案確認/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "把需求轉成可驗收的交付範圍。" })).toBeVisible();
    expect(screen.getByText("每日工作量、尖峰併發、延遲或完成時間目標")).toBeVisible();
  });

  it("does not turn expected capacity into an ownership or deployment claim", () => {
    render(<LocaleProvider><InfrastructureContent gateway={null} /></LocaleProvider>);

    expect(document.body).not.toHaveTextContent(/we own|our data centre|deployed 3\.1 MW/i);
  });
});
