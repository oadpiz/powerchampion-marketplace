import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InternationalSite } from "../components/international-site";
import { LocaleProvider } from "../components/locale-provider";
import { INTERNATIONAL_CONTENT } from "../lib/international-content";
import { HOME_COPY } from "../lib/home-copy";
import {
  INTERNATIONAL_LANGUAGES,
  INTERNATIONAL_SECTIONS,
  LANGUAGE_NAMES,
  getInternationalRoute,
  internationalPath,
  type InternationalLanguage,
  type InternationalSection,
} from "../lib/languages";
import { MODEL_CATALOG } from "../lib/models";
import {
  generateMetadata,
  generateStaticParams,
} from "../app/[language]/[[...segments]]/page";

afterEach(cleanup);
function regionalPage(
  language: InternationalLanguage,
  section: InternationalSection,
) {
  return (
    <LocaleProvider>
      <InternationalSite language={language} section={section} />
    </LocaleProvider>
  );
}

describe("indexable international marketing", () => {
  it("accepts exactly the published languages and section routes", () => {
    expect(getInternationalRoute("/zh-Hant")).toEqual({
      language: "zh-Hant",
      section: "",
    });
    expect(getInternationalRoute("/ja/models/")).toEqual({
      language: "ja",
      section: "models",
    });
    for (const path of [
      "/fr",
      "/ja/account",
      "/ja/models/glm-5.2-fp8",
      "/ja//models",
      "/ja/pricing/extra",
      "/en",
      "/models",
    ])
      expect(getInternationalRoute(path)).toBeNull();
    expect(generateStaticParams()).toHaveLength(24);
  });

  for (const language of INTERNATIONAL_LANGUAGES) {
    it(`renders every ${language} page with localized SSR content and full shared homepage`, () => {
      const copy = INTERNATIONAL_CONTENT[language];
      const home = HOME_COPY[language];
      for (const section of INTERNATIONAL_SECTIONS) {
        const html = renderToStaticMarkup(regionalPage(language, section));
        const doc = new DOMParser().parseFromString(html, "text/html");
        expect(doc.querySelector("main")?.getAttribute("lang")).toBe(language);
        expect(doc.querySelectorAll("main")).toHaveLength(1);
        expect(doc.querySelectorAll("h1")).toHaveLength(1);
        if (section === "") {
          expect(doc.querySelector(".unified-home")).toBeTruthy();
          expect(
            doc.querySelector(".brand-hero")?.getAttribute("data-language"),
          ).toBe(language);
          expect(doc.querySelector("#models-title")?.textContent).toBe(
            home.modelTitle.join(""),
          );
          expect(doc.querySelector("#developer-title")?.textContent).toBe(
            home.devTitle.join(""),
          );
          expect(doc.querySelector("#infrastructure-title")?.textContent).toBe(
            home.infraTitle.join(""),
          );
          expect(doc.querySelector("#faq-title")?.textContent).toBe(
            home.faqTitle,
          );
          expect(doc.querySelector("main")?.textContent).toContain(
            home.faqs[0][1],
          );
          expect(doc.querySelector("main")?.textContent).toContain(
            home.samplePrompt,
          );
          expect(doc.querySelector("main")?.textContent).not.toMatch(
            /THE MODEL COLLECTION|MADE FOR DEVELOPERS|Get API access/,
          );
        } else if (section === "agent-platform") {
          expect(doc.querySelector('a[href="/tasks"]')).toBeTruthy();
          expect(doc.querySelector('a[href="/agents/build"]')).toBeTruthy();
          expect(doc.querySelectorAll("details").length).toBeGreaterThan(2);
        } else {
          expect(doc.querySelector("h1")?.textContent).toBe(
            copy.pages[section].title,
          );
          expect(doc.querySelector("main")?.textContent).toContain(
            copy.pages[section].description,
          );
        }
        expect(doc.querySelector("nav")?.textContent).toContain(
          copy.nav.company,
        );
        expect(doc.querySelector("footer")?.textContent).toContain(
          copy.footer.privacy,
        );
        expect(
          doc.querySelector(".language-picker-trigger")?.textContent,
        ).toContain(LANGUAGE_NAMES[language]);
        expect(doc.querySelector('a[href="/platform"]')).toBeTruthy();
        expect(doc.body.textContent).not.toMatch(
          /99\.99%|8 live models|1000\+/,
        );
      }
    });

    it(`keeps ${language} model prices, units, and same-section language options clear`, async () => {
      const user = userEvent.setup();
      const copy = INTERNATIONAL_CONTENT[language];
      render(regionalPage(language, "models"));
      for (const model of MODEL_CATALOG) {
        const card = screen.getByRole("article", { name: model.name });
        expect(card).toHaveTextContent(copy.modelDescriptions[model.id]);
        expect(within(card).getByRole("link")).toHaveAttribute(
          "href",
          `/models/${model.id}`,
        );
      }
      expect(
        screen.getByRole("article", { name: "Flux Schnell" }),
      ).toHaveTextContent(copy.catalog.image);
      expect(
        screen.getByRole("article", { name: "Whisper Large v3" }),
      ).toHaveTextContent(copy.catalog.minute);
      expect(
        screen.getByRole("article", { name: "GLM 5.2 FP8" }),
      ).toHaveTextContent("US$0.93");
      expect(
        screen.getByRole("article", { name: "GLM 5.2 FP8" }),
      ).toHaveTextContent("US$3.00");
      expect(screen.getAllByText(copy.platformNote).length).toBeGreaterThan(0);
      const trigger = document.querySelector<HTMLButtonElement>(
        ".language-picker-trigger",
      )!;
      await user.click(trigger);
      for (const target of ["en", ...INTERNATIONAL_LANGUAGES] as const) {
        expect(
          screen.getByRole("link", { name: LANGUAGE_NAMES[target] }),
        ).toHaveAttribute("href", internationalPath(target, "models"));
      }
    });

    it(`keeps ${language} homepage filters and code copying interactive and translated`, async () => {
      const user = userEvent.setup();
      const copy = HOME_COPY[language];
      render(regionalPage(language, ""));
      const models = screen.getByRole("group", { name: copy.filterModels });
      await user.click(
        within(models).getByRole("button", { name: copy.categories.vision }),
      );
      expect(
        screen.getByRole("article", { name: "Qwen3-VL 30B" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("article", { name: "GLM 5.2 FP8" }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "cURL" }));
      const clipboard = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue();
      await user.click(screen.getByRole("button", { name: copy.copyCode }));
      expect(clipboard).toHaveBeenCalledWith(
        expect.stringContaining(copy.samplePrompt),
      );
      expect(screen.getByRole("status")).toHaveTextContent(copy.copySuccess);
      clipboard.mockRestore();
      expect(
        screen.getByRole("link", { name: copy.exploreInfrastructure }),
      ).toHaveAttribute("href", `/${language}/infrastructure`);
    });

    it(`assigns ${language} pages absolute canonical and reciprocal alternates`, async () => {
      for (const section of INTERNATIONAL_SECTIONS) {
        const metadata = await generateMetadata({
          params: Promise.resolve({
            language,
            segments: section ? [section] : [],
          }),
        });
        expect(metadata.alternates?.canonical).toBe(
          `https://powerchampion.ai${internationalPath(language, section)}`,
        );
        const alternates = metadata.alternates?.languages;
        expect(Object.keys(alternates ?? {})).toHaveLength(6);
        expect(alternates?.ja).toBe(
          `https://powerchampion.ai${internationalPath("ja", section)}`,
        );
        expect(alternates?.["x-default"]).toBe(
          `https://powerchampion.ai${internationalPath("en", section)}`,
        );
        expect(metadata.description).toBe(
          INTERNATIONAL_CONTENT[language].pages[section].description,
        );
      }
    });
  }
  it("calculates credit example from catalog rates and shows scoped GPU procurement", () => {
    render(regionalPage("ja", "pricing"));
    expect(screen.getByText("US$1.68")).toBeVisible();
    expect(screen.getByText("US$52.50")).toBeVisible();
    expect(screen.getByText("US$224.00")).toBeVisible();
    expect(
      screen.getByText(INTERNATIONAL_CONTENT.ja.pricing.note),
    ).toBeVisible();
    cleanup();
    render(regionalPage("ko", "infrastructure"));
    expect(
      screen.getByText(INTERNATIONAL_CONTENT.ko.infrastructure.note),
    ).toBeVisible();
    expect(screen.getByText("NVIDIA HGX B300 / B200")).toBeVisible();
  });
});
