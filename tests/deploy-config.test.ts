import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(`${process.cwd()}/docker-compose.dokploy.yml`, "utf8").replace(/^\s*#.*$/gm, "");

/** Text of one top-level service, up to the next service or top-level key. */
function service(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`missing service ${name}`);
  const rest = compose.slice(start + name.length + 5);
  const end = rest.search(/^(?: {2}[a-z0-9-]+:|[a-z]+:)\s*$/m);
  // Comments explain intent; assertions apply to configuration only.
  return (end < 0 ? rest : rest.slice(0, end)).replace(/^\s*#.*$/gm, "");
}

describe("Dokploy deployment behind Traefik", () => {
  const website = service("powerchampion-marketplace");
  const portal = service("powerchampion-portal");

  it("trusts the forwarded protocol so production requests resolve to https://powerchampion.ai", () => {
    expect(website).toMatch(/^\s+VINEXT_TRUST_PROXY:\s*"1"\s*$/m);
  });

  it("publishes no host ports, so only Traefik can supply forwarded headers", () => {
    expect(compose).not.toMatch(/^\s+ports:/m);
  });

  it("keeps the account service private to the website container", () => {
    expect(website).toMatch(/^\s+PC_PORTAL_ORIGIN:\s*http:\/\/powerchampion-portal:3020\s*$/m);
    expect(portal).not.toMatch(/traefik|dokploy-network/);
    expect(portal).toMatch(/^\s+- default\s*$/m);
  });

  it("runs the account service with production cookies, an exact origin and durable storage", () => {
    expect(portal).toMatch(/^\s+PC_PORTAL_ENV:\s*production\s*$/m);
    expect(portal).toMatch(/^\s+PC_PORTAL_SECURE_COOKIES:\s*"1"\s*$/m);
    expect(portal).toMatch(/^\s+PC_PORTAL_ALLOWED_ORIGINS:\s*https:\/\/powerchampion\.ai\s*$/m);
    expect(portal).toMatch(/^\s+- portal-data:\/data\s*$/m);
    expect(compose).toMatch(/^volumes:\s*\n\s+portal-data:/m);
  });

  it("leaves gateway key self-service and the anonymous trial disconnected", () => {
    expect(compose).not.toMatch(/^\s+PC_GATEWAY_ADMIN_TOKEN\s*:/m);
    expect(compose).not.toMatch(/^\s+PC_TRIAL_API_KEY\s*:/m);
    expect(portal).toMatch(/^\s+PC_TRIAL_ENABLED:\s*"0"\s*$/m);
  });
});
