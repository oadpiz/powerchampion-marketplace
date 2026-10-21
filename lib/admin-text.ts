/**
 * Client-side text checks that mirror the portal backend (server/support.py, server/admin_personas.py):
 * lengths count code points like Python's len(), and the same characters are refused.
 */

/** Length in code points (an emoji or a CJK extension character counts once, as on the server). */
export const codePoints = (text: string) => [...text].length;

// C0 and C1 controls, DEL, bidi embedding/override/isolate characters and unpaired surrogates.
// eslint-disable-next-line no-control-regex
const UNSAFE_MULTILINE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
// Single-line fields also refuse tab/newline and invisible characters (zero-width, LRM/RLM, word joiner, ALM).
// eslint-disable-next-line no-control-regex
const UNSAFE_LINE = /[\u0009\u000a\u000d\u200b-\u200f\u2060\u061c]/;

export type TextProblem = "empty" | "unsafe" | "long" | null;

/** Why a single-line value (label, name, note) would be refused; trimmed like the server. */
export function lineProblem(value: string, maximum: number, required = true): TextProblem {
  if (UNSAFE_MULTILINE.test(value) || UNSAFE_LINE.test(value)) return "unsafe";
  const trimmed = value.trim();
  if (required && !trimmed) return "empty";
  return codePoints(trimmed) > maximum ? "long" : null;
}

/** Why a multi-line value (system prompt, example, try input) would be refused; newlines and tabs are fine. */
export function textProblem(value: string, maximum: number): TextProblem {
  if (UNSAFE_MULTILINE.test(value)) return "unsafe";
  return codePoints(value) > maximum ? "long" : null;
}

export function unsafeMessage(field: { en: string; zh: string }, zh: boolean) {
  return zh
    ? `${field.zh}含有控制字元或隱藏字元（例如零寬度或方向控制字元），請刪除後重新輸入。`
    : `The ${field.en} contains a control or hidden character (such as a zero-width or direction-control character). Remove it and type it again.`;
}
