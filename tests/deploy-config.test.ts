import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(`${process.cwd()}/docker-compose.dokploy.yml`, "utf8").replace(/^\s*#.*$/gm, "");
const dockerIgnore = readFileSync(`${process.cwd()}/.dockerignore`, "utf8")
  .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));

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

  it.each([".env", ".env.*", ".dev.vars*", ".local", ".worktrees", "outputs", "work"])(
    "excludes %s from the shared Docker build context before COPY . .",
    (pattern) => {
      expect(dockerIgnore).toContain(pattern);
      expect(dockerIgnore).not.toContain(`!${pattern}`);
    },
  );

  it("keeps website and portal source directories in the shared build context", () => {
    for (const source of ["app", "components", "lib", "public", "server", "package.json", "package-lock.json"]) {
      expect(dockerIgnore).not.toContain(source);
      expect(dockerIgnore).not.toContain(`${source}/`);
    }
    expect(dockerIgnore).not.toContain("*");
    expect(dockerIgnore).not.toContain("**");
  });

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

  it("keeps the Postgres service internal, healthchecked and on its own volume", () => {
    const db = service("powerchampion-db");
    expect(db).not.toMatch(/^\s+ports:|traefik|dokploy-network/m);
    expect(db).toMatch(/^\s+- default\s*$/m);
    expect(db).toMatch(/^\s+- portal-pg-data:\/var\/lib\/postgresql\/data\s*$/m);
    expect(db).toMatch(/^\s+healthcheck:/m);
    expect(db).toMatch(/pg_isready[^\n]*-h 127\.0\.0\.1/);
    // The portal fails fast and restarts; a depends_on would also block the SQLite rollback path.
    expect(portal).not.toMatch(/^\s+depends_on:/m);
    expect(portal).not.toMatch(/PC_PORTAL_DB_PASSWORD/);
    expect(db).toMatch(/^\s+- portal-pg-dumps:\/var\/lib\/postgresql\/dumps\s*$/m);
    expect(compose).toMatch(/^volumes:\s*\n(?:\s+[a-z-]+:\s*\n)*\s+portal-pg-data:/m);
  });

  it("wires the gateway admin token from the environment and keeps the trial and customer issuance off", () => {
    // Value comes from the Dokploy environment (empty by default); a literal token must never be committed.
    expect(portal).toMatch(/^\s+PC_GATEWAY_ADMIN_TOKEN:\s*\$\{PC_GATEWAY_ADMIN_TOKEN:-\}\s*$/m);
    expect(compose).not.toMatch(/^\s+PC_GATEWAY_ADMIN_TOKEN\s*:\s*(?!\$\{PC_GATEWAY_ADMIN_TOKEN:-\}\s*$)\S/m);
    // Customer self-service issuance stays off unless the operator opts in.
    expect(portal).toMatch(/^\s+PC_CUSTOMER_KEY_ISSUANCE:\s*\$\{PC_CUSTOMER_KEY_ISSUANCE:-0\}\s*$/m);
    expect(compose).not.toMatch(/^\s+PC_TRIAL_API_KEY\s*:/m);
    expect(portal).toMatch(/^\s+PC_TRIAL_ENABLED:\s*"0"\s*$/m);
  });

  it("passes the video studio settings to the portal from the environment only", () => {
    // Optional on purpose: the agent is a separate compose app, and unset values only make /studio
    // answer 503 studio_unconfigured, so they can never block this stack's deploy.
    for (const name of ["PC_STUDIO_AGENT_URL", "SHORTVIDEO_SERVICE_TOKEN", "SHORTVIDEO_GRANT_SECRET", "SHORTVIDEO_QUOTE_SECRET"]) {
      expect(portal).toMatch(new RegExp(`^\\s+${name}:\\s*\\$\\{${name}:-\\}\\s*$`, "m"));
      // A literal value must never be committed, and no other service gets the secrets.
      expect(compose.match(new RegExp(`^\\s+${name}\\s*:`, "gm"))).toHaveLength(1);
    }
    expect(portal).toMatch(/^\s+PC_STUDIO_SWEEPER:\s*\$\{PC_STUDIO_SWEEPER:-1\}\s*$/m);
    expect(portal).toMatch(/^\s+PC_STUDIO_INTERNAL_VOICES:\s*\$\{PC_STUDIO_INTERNAL_VOICES:-tw_ref,test\}\s*$/m);
    expect(portal).toMatch(/^\s+PC_STUDIO_DRAFTS_PER_DAY:\s*\$\{PC_STUDIO_DRAFTS_PER_DAY:-30\}\s*$/m);
    expect(portal).toMatch(/^\s+PC_STUDIO_MEDIA_ORIGIN:\s*\$\{PC_STUDIO_MEDIA_ORIGIN:-\}\s*$/m);
    expect(website).not.toMatch(/SHORTVIDEO_|PC_STUDIO_/);
  });
});

/** Network names of one service (configuration text only; comment lines are blank). */
function networks(text: string): string[] {
  const block = text.match(/^ {4}networks:[ \t]*\n((?:(?: {6}- .*|[ \t]*)\n)+)/m);
  return block ? [...block[1].matchAll(/^ {6}- ([a-z0-9-]+)\s*$/gm)].map((m) => m[1]) : [];
}

describe("Video studio agent link (S4, studio-spec 2.1, 12.1)", () => {
  const website = service("powerchampion-marketplace");
  const portal = service("powerchampion-portal");
  const db = service("powerchampion-db");

  it("joins the portal, and only the portal, to the external studio-internal network", () => {
    expect(networks(portal)).toEqual(["default", "studio-internal"]);
    expect(networks(website)).not.toContain("studio-internal");
    expect(networks(db)).toEqual(["default"]);
    expect(compose).toMatch(/^networks:\s*\n(?:.*\n)*?\s{2}studio-internal:\s*\n\s{4}external:\s*true\s*$/m);
  });

  it("keeps the shortvideo services out of this stack", () => {
    // They live in the agent repo (docker-compose.studio.yml), so studio settings cannot block this deploy.
    expect(compose).not.toMatch(/^\s{2}shortvideo-(api|media):/m);
    expect(compose).not.toMatch(/SHORTVIDEO_MEDIA_KEY|B300_API_KEY|shortvideo-(data|uploads)/);
  });

  it("never requires a studio variable", () => {
    expect(compose).not.toMatch(/\$\{(?:PC_STUDIO_[A-Z_]+|SHORTVIDEO_[A-Z_]+|STUDIO_[A-Z_]+):\?/);
  });
});
