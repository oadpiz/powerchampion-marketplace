"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import {
  getInternationalRoute,
  INTERNATIONAL_LANGUAGES,
  INTERNATIONAL_SECTIONS,
  LANGUAGE_NAMES,
  internationalPath,
  type InternationalLanguage,
  type InternationalSection,
} from "../lib/languages";
import { useLocale } from "./locale-provider";

type Language = InternationalLanguage | "en";
const LABELS: Record<
  Language,
  { trigger: string; title: string; coverage: string }
> = {
  en: {
    trigger: "Language: ",
    title: "Website language",
    coverage:
      "English and Traditional Chinese are available on this page. Other languages open the regional homepage.",
  },
  "zh-Hant": {
    trigger: "語言：",
    title: "網站語言",
    coverage: "此頁支援英文與繁體中文，其他語言會開啟對應地區的首頁。",
  },
  "zh-Hans": {
    trigger: "语言：",
    title: "网站语言",
    coverage: "此页提供英文与繁体中文，其他语言将打开对应地区的首页。",
  },
  ja: {
    trigger: "言語: ",
    title: "表示言語",
    coverage:
      "このページは英語と繁体字中国語に対応しています。他の言語は各言語のホームページを開きます。",
  },
  ko: {
    trigger: "언어: ",
    title: "웹사이트 언어",
    coverage:
      "이 페이지는 영어와 번체 중국어를 지원합니다. 다른 언어는 해당 언어의 홈페이지로 이동합니다.",
  },
};

export function LanguagePicker({
  language,
  section,
}: {
  language?: Language;
  section?: InternationalSection;
}) {
  const { locale, setLocale } = useLocale();
  const pathname = usePathname();
  const regional = getInternationalRoute(pathname);
  const pathSection =
    pathname === "/" || pathname === "/solutions"
      ? ""
      : pathname.replace(/^\//, "");
  const supported =
    section !== undefined ||
    regional !== null ||
    INTERNATIONAL_SECTIONS.some((item) => item === pathSection);
  const selectedSection: InternationalSection =
    section ??
    regional?.section ??
    (supported ? (pathSection as InternationalSection) : "");
  const current =
    language ?? regional?.language ?? (locale === "zh" ? "zh-Hant" : "en");
  const copy = LABELS[current];
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    wrapper.current
      ?.querySelector<HTMLElement>(`[data-language="${current}"]`)
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !wrapper.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, current]);

  function close(returnFocus = false) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }
  function choose(next: Language) {
    setLocale(next === "zh-Hant" ? "zh" : "en");
    close(true);
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!open) {
      setOpen(true);
      return;
    }
    const choices = Array.from(
      wrapper.current?.querySelectorAll<HTMLElement>("[data-language]") ?? [],
    );
    const index = choices.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? choices.length - 1
          : event.key === "ArrowUp"
            ? (index - 1 + choices.length) % choices.length
            : (index + 1) % choices.length;
    choices[next]?.focus();
  }

  // Delegate keys from native controls so Escape closes this disclosure before the surrounding mobile dialog.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="language-picker"
      role="group"
      aria-label={copy.title}
      ref={wrapper}
      onKeyDown={keyboard}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          close();
      }}
    >
      <button
        className="language-picker-trigger"
        type="button"
        ref={trigger}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${copy.trigger}${LANGUAGE_NAMES[current]}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          className="language-picker-globe"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="7.25" />
          <path d="M2.75 10h14.5M10 2.75c2.05 2.04 3.1 4.46 3.1 7.25s-1.05 5.21-3.1 7.25C7.95 15.21 6.9 12.79 6.9 10S7.95 4.79 10 2.75Z" />
        </svg>
        <span>{LANGUAGE_NAMES[current]}</span>
        <svg
          className="language-picker-chevron"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div className="language-picker-popover" id={menuId}>
          <p className="language-picker-title">{copy.title}</p>
          <nav aria-label={copy.title}>
            {(["en", ...INTERNATIONAL_LANGUAGES] as const).map((item) => {
              const content = (
                <>
                  <span>{LANGUAGE_NAMES[item]}</span>
                  {item === current && (
                    <span className="language-picker-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </>
              );
              return !supported && (item === "en" || item === "zh-Hant") ? (
                <button
                  type="button"
                  data-language={item}
                  key={item}
                  lang={item}
                  aria-pressed={item === current}
                  onClick={() => choose(item)}
                >
                  {content}
                </button>
              ) : (
                <a
                  data-language={item}
                  key={item}
                  href={internationalPath(item, selectedSection)}
                  hrefLang={item}
                  lang={item}
                  aria-current={item === current ? "true" : undefined}
                  onClick={() => choose(item)}
                >
                  {content}
                </a>
              );
            })}
          </nav>
          {!supported && (
            <p className="language-picker-coverage">{copy.coverage}</p>
          )}
        </div>
      )}
    </div>
  );
}
