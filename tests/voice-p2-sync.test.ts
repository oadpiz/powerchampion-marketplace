import { describe, expect, it } from "vitest";
import { voiceAdminErrorText } from "../components/admin-voice-dialogs";
import { PortalError } from "../lib/portal-client";
import { PHONE_NUMERALS, hasPhoneNumber, phoneMask, phoneText } from "../lib/voice-calls";
import { noteHasPhoneNumber } from "../lib/voice-quality";
import vectors from "./support/phone-like-vectors.json";

/*
 * Phase 2 checks that span the store page (P2-2), the Quality tab (P2-6) and the phase 1 number dialogs, written
 * when the branches were merged. The backend half of each check is server/test_voice_calls_sync.py and
 * server/test_voice_calls_note_sync.py (LESSONS 2026-10-21: shared enums and rules need a sync test).
 */
describe("phase 2 front-end and back-end sync", () => {
  // phone-like-vectors.json is also run through server/voice_calls.has_phone_number by test_voice_calls_note_sync.py.
  it("checks Quality notes and listening summaries for phone numbers exactly like the backend and the store page", () => {
    for (const text of vectors.number) expect(noteHasPhoneNumber(text), JSON.stringify(text)).toBe(true);
    for (const text of vectors.not_number) expect(noteHasPhoneNumber(text), JSON.stringify(text)).toBe(false);
    expect(noteHasPhoneNumber).toBe(hasPhoneNumber);
  });

  // The same lists are server/test_voice_calls_note_sync.py's (voice_calls.has_phone_number, phone_mask).
  it("does not take a date, an IP address, a version or an amount for a phone number, and still takes a comma-separated number", () => {
    for (const text of [
      "2026/10/22", "2026.10.22", "2026-10-22", "G0 盲聽 2026/10/22", "IP 172.16.10.23", "2026/1/5", "22/10/2026", "10-22-2026",
      "２０２６／１０／２２", "2026/10/22 14:30", "2026/10/22-2026/10/25", "10.0.0.0/8", "192.168.0.1:8080", "版本 20.11.0.123456",
      "ver. 2026.10.22.1", "build 2026.10.22.1", "v1.2.3.4.5.6.7.8", "2026.10.22.1", "10,000,000", "報價 1,234,567,890 元",
      "共 20,000,000 與 30,000,000", "35,000, 42,000", "1,2,3,4,5,6,7,8",
    ]) {
      expect(hasPhoneNumber(text), text).toBe(false);
    }
    for (const text of [
      "0912,345,678", "0912，345，678", "0912、345、678", "０９１２，３４５，６７８", "電話 0912,345,678 請回電", "0912,345 678",
      "0912-345,678", "09,12,34,56,78", "912,345,678", "2026/10/22 0912 345 678", "1234 2026/10/22 5678 9012",
      "IP 172.16.10.23 回電 0912345678", "10,000,000 0912345678", "20261022", "172.016.010.023", "1.2.3.4.5.6.7.8", "ver 3 0912345678",
      "v0912.345.678", "version 0912.345.678",
    ]) {
      expect(hasPhoneNumber(text), text).toBe(true);
    }
    expect(phoneMask("IP 172.16.10.23 on 2026/10/22 v1.2.3 / 10,000,000")).toBe("IP | on | | / |");
    // A masked span is neither a digit nor a separator, so it never joins the digits on its two sides.
    expect(phoneMask("0912 2026/10/22 345 678")).toBe("0912 | 345 678");
    expect(hasPhoneNumber("0912 2026/10/22 345")).toBe(false);
  });

  it("reads Chinese numerals with the backend's table (voice_calls.PHONE_NUMERALS)", () => {
    expect(PHONE_NUMERALS).toEqual(vectors.numerals);
    for (const [digit, chars] of Object.entries(vectors.numerals)) {
      for (const char of chars) {
        expect(phoneText(char.repeat(8)), char).toBe(digit.repeat(8));
        expect(hasPhoneNumber(char.repeat(8)), char).toBe(true);
      }
    }
  });

  it("words 409 number_in_use from A7/A8 once calls refer to a number (§4.4, §12.1)", () => {
    const error = new PortalError(409, "number_in_use", "This number already has 3 call(s); only the end date and note can change.");
    expect(voiceAdminErrorText(error, "zh")).toBe("這個號碼已經有通話紀錄，只能改迄日和備註；要換店請設迄日後另建一筆。");
    expect(voiceAdminErrorText(error, "en")).toBe(
      "This number already has calls; only the end date and note can change. To move it to another store, set an end date and add a new entry.",
    );
  });
});
