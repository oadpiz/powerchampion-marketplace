import { describe, expect, it } from "vitest";
import { voiceAdminErrorText } from "../components/admin-voice-dialogs";
import { PortalError } from "../lib/portal-client";
import { PHONE_LIKE } from "../lib/voice-calls";
import { NOTE_PHONE_PATTERN } from "../lib/voice-quality";
import vectors from "./support/phone-like-vectors.json";

/*
 * Phase 2 checks that span the store page (P2-2), the Quality tab (P2-6) and the phase 1 number dialogs, written
 * when the branches were merged. The backend half of each check is server/test_voice_calls_sync.py and
 * server/test_voice_calls_note_sync.py (LESSONS 2026-10-21: shared enums and rules need a sync test).
 */
describe("phase 2 front-end and back-end sync", () => {
  // phone-like-vectors.json is also run through server/voice_calls.has_phone_number by test_voice_calls_note_sync.py.
  it("checks Quality notes and listening summaries for phone numbers exactly like the backend and the store page", () => {
    for (const text of vectors.number) expect(NOTE_PHONE_PATTERN.test(text), JSON.stringify(text)).toBe(true);
    // U+FEFF between digits is not a number for Python's \s; JavaScript's \s would call it one.
    for (const text of vectors.not_number) expect(NOTE_PHONE_PATTERN.test(text), JSON.stringify(text)).toBe(false);
    expect(NOTE_PHONE_PATTERN.source).toBe(PHONE_LIKE.source);
  });

  it("words 409 number_in_use from A7/A8 once calls refer to a number (§4.4, §12.1)", () => {
    const error = new PortalError(409, "number_in_use", "This number already has 3 call(s); only the end date and note can change.");
    expect(voiceAdminErrorText(error, "zh")).toBe("這個號碼已經有通話紀錄，只能改迄日和備註；要換店請設迄日後另建一筆。");
    expect(voiceAdminErrorText(error, "en")).toBe(
      "This number already has calls; only the end date and note can change. To move it to another store, set an end date and add a new entry.",
    );
  });
});
