import { describe, expect, it } from "vitest";
import { webAnalyticsToken } from "../lib/analytics";

describe("web analytics token", () => {
  it("accepts a Cloudflare site token", () => {
    expect(webAnalyticsToken("0123456789abcdef0123456789ABCDEF")).toBe("0123456789abcdef0123456789ABCDEF");
    expect(webAnalyticsToken("  0123456789abcdef0123456789abcdef  ")).toBe("0123456789abcdef0123456789abcdef");
  });

  it("keeps the beacon off for anything else", () => {
    for (const value of [
      undefined, "", "   ", "not-a-token", "0123456789abcdef", `${"a".repeat(32)}x`,
      '0123456789abcdef0123456789abcdef" onload="alert(1)',
      "<script>alert(1)</script>",
    ]) {
      expect(webAnalyticsToken(value)).toBeNull();
    }
  });
});
