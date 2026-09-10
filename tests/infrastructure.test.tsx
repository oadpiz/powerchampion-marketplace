import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InfrastructureContent } from "../components/infrastructure-content";
import { LocaleProvider, useLocale } from "../components/locale-provider";

function LocaleSwitch() {
  const { setLocale } = useLocale();
  return <button type="button" onClick={() => setLocale("zh")}>繁中</button>;
}

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

  it("changes planning questions with the workload and preserves the choice when localized", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><LocaleSwitch /><InfrastructureContent gateway={null} /></LocaleProvider>);
    const training = screen.getByRole("button", { name: "Training & fine-tuning" });
    expect(screen.getByText("Which models and precision will you serve?")).toBeVisible();
    await user.click(training);
    expect(training).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Production inference" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Which models and precision will you serve?")).not.toBeInTheDocument();
    expect(screen.getByText("Are you pretraining, fine-tuning, or adapting an existing model?")).toBeVisible();
    expect(screen.getByRole("link", { name: "Discuss this workload" })).toHaveAttribute("href", "/contact");

    await user.click(screen.getByRole("button", { name: "繁中" }));
    expect(screen.getByRole("button", { name: "訓練與微調" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("是預訓練、微調，還是調整既有模型？")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "從工作負載出發，規劃合適算力。" })).toBeVisible();
    expect(screen.getByText(/不代表可立即預訂的庫存/)).toBeVisible();
    expect(screen.getByText(/不保證擴充權會被行使或增加容量/)).toBeVisible();
  });

  it("does not turn expected capacity into an ownership or deployment claim", () => {
    render(<LocaleProvider><InfrastructureContent gateway={null} /></LocaleProvider>);

    expect(document.body).not.toHaveTextContent(/we own|our data centre|deployed 3\.1 MW/i);
  });
});
