import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPlaygroundCode, isPlaygroundModel, PLAYGROUND_MODELS } from "../lib/playground";

type CapturedRequest = { url: string; method: string; headers: Record<string, string>; body: string };
const endpoint = "https://b300.powerchampion.ai/v1/chat/completions";
const adversarial = '繁體中文 🚀\n"quotes" and \'single\' \\ path $(printf injected) `printf injected` ${injected}';

async function runJavaScript(code: string, apiKey = "runtime-javascript-key") {
  const requests: CapturedRequest[] = [];
  await runInNewContext(`(async () => {\n${code}\n})()`, {
    process: { env: { POWERCHAMPION_API_KEY: apiKey } },
    console: { log() {} },
    fetch: async (url: string, options: Omit<CapturedRequest, "url">) => {
      requests.push({ url, ...options });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Example answer" } }] }) };
    },
  });
  return requests;
}

function runPython(code: string) {
  const harness = `import contextlib, io, json, sys, urllib.request
captured = []
def capture(request, **kwargs):
    captured.append({"url": request.full_url, "method": request.get_method(), "headers": dict(request.header_items()), "body": request.data.decode("utf-8")})
    return io.BytesIO(b'{"choices":[{"message":{"content":"Example answer"}}]}')
urllib.request.urlopen = capture
with contextlib.redirect_stdout(io.StringIO()):
    exec(sys.stdin.read(), {"__name__": "__main__"})
print(json.dumps(captured))`;
  return JSON.parse(execFileSync("python3", ["-I", "-c", harness], {
    input: code, encoding: "utf8", env: { ...process.env, POWERCHAMPION_API_KEY: "runtime-python-key" },
  })) as CapturedRequest[];
}

afterEach(() => vi.unstubAllEnvs());

describe("Playground request snippets", () => {
  it("keeps default cURL shell-safe while preserving all selected settings", () => {
    const code = buildPlaygroundCode("qwen3-vl-30b", ` ${adversarial} `, " Follow instructions. ", 3072);
    const args = execFileSync("/bin/bash", ["-c", `curl() { printf '%s\\0' "$@"; }\n${code}`], {
      encoding: "utf8", env: { ...process.env, POWERCHAMPION_API_KEY: "runtime-curl-key" },
    }).split("\0").filter(Boolean);
    expect(args.slice(0, 6)).toEqual([endpoint, "-H", "Authorization: Bearer runtime-curl-key", "-H", "Content-Type: application/json", "-d"]);
    expect(JSON.parse(args[6])).toEqual({
      model: "qwen3-vl-30b", messages: [{ role: "system", content: "Follow instructions." }, { role: "user", content: adversarial }],
      max_tokens: 3072, stream: false,
    });
  });

  it("runs JavaScript with literal prompt text and an environment-only credential", async () => {
    vi.stubEnv("POWERCHAMPION_API_KEY", "must-not-be-embedded");
    const code = buildPlaygroundCode("glm-5.2-fp8", adversarial, " Be concise. ", 1024, "javascript");
    expect(code).not.toContain("must-not-be-embedded");
    const requests = await runJavaScript(code);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: endpoint, method: "POST", headers: { Authorization: "Bearer runtime-javascript-key", "Content-Type": "application/json" } });
    expect(JSON.parse(requests[0].body)).toEqual({
      model: "glm-5.2-fp8", messages: [{ role: "system", content: "Be concise." }, { role: "user", content: adversarial }],
      max_tokens: 1024, stream: false,
    });
  });

  it("runs Python without a third-party SDK and preserves literal text", () => {
    vi.stubEnv("POWERCHAMPION_API_KEY", "must-not-be-embedded");
    const code = buildPlaygroundCode("qwen3-vl-30b", adversarial, " 中文指示。 ", 4096, "python");
    expect(code).not.toContain("must-not-be-embedded");
    const requests = runPython(code);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: endpoint, method: "POST", headers: { Authorization: "Bearer runtime-python-key", "Content-type": "application/json" } });
    expect(JSON.parse(requests[0].body)).toEqual({
      model: "qwen3-vl-30b", messages: [{ role: "system", content: "中文指示。" }, { role: "user", content: adversarial }],
      max_tokens: 4096, stream: false,
    });
  });

  it.each(["python", "javascript"] as const)("omits an empty system instruction and uses a usable default prompt in %s", async (language) => {
    const code = buildPlaygroundCode("glm-5.2-fp8", " \n ", " \n ", 256, language);
    const requests = language === "python" ? runPython(code) : await runJavaScript(code);
    expect(JSON.parse(requests[0].body)).toEqual({
      model: "glm-5.2-fp8", messages: [{ role: "user", content: "Explain how an API works in two sentences." }],
      max_tokens: 256, stream: false,
    });
  });

  it("keeps non-chat catalog models out of the supported request choices", () => {
    expect(PLAYGROUND_MODELS.map((model) => model.modelId)).toEqual(["glm-5.2-fp8", "qwen3-vl-30b"]);
    expect(isPlaygroundModel("flux-schnell")).toBe(false);
    expect(isPlaygroundModel("qwen3-vl-30b")).toBe(true);
  });
});
