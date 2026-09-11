import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(`${process.cwd()}/docker-compose.dokploy.yml`, "utf8");

describe("Dokploy deployment behind Traefik", () => {
  it("trusts the forwarded protocol so production requests resolve to https://powerchampion.ai", () => {
    expect(compose).toMatch(/^\s+VINEXT_TRUST_PROXY:\s*"1"\s*$/m);
  });

  it("publishes no host ports, so only Traefik can supply forwarded headers", () => {
    expect(compose).not.toMatch(/^\s+ports:/m);
  });
});
