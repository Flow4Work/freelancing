import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type ApiConnectionRequirement = "required-one-of" | "recommended" | "optional";
export type ApiConnectionGroup = "search" | "google-search" | "opencode";

export type ApiConnection = {
  id: string;
  label: string;
  group: ApiConnectionGroup;
  requirement: ApiConnectionRequirement;
  requirementLabel: string;
  note: string;
  connected: boolean;
  storage: "env.local" | "opencode";
};

type ConnectionDefinition = Omit<ApiConnection, "connected"> & {
  envKey?: string;
  providerId?: string;
};

const ENV_PATH = path.join(process.cwd(), ".env.local");
const OPENCODE_AUTH_PATH = path.join(homedir(), ".local", "share", "opencode", "auth.json");

const CONNECTIONS: ConnectionDefinition[] = [
  { id: "exa", label: "Exa", group: "search", requirement: "required-one-of", requirementLabel: "둘 중 하나 필수", note: "기본 Creator 검색", storage: "env.local", envKey: "EXA_API_KEY" },
  { id: "tavily", label: "Tavily", group: "search", requirement: "required-one-of", requirementLabel: "둘 중 하나 필수", note: "기본 Creator 검색", storage: "env.local", envKey: "TAVILY_API_KEY" },
  { id: "serper", label: "Serper", group: "google-search", requirement: "optional", requirementLabel: "선택", note: "Google 추가 찾기", storage: "env.local", envKey: "SERPER_API_KEY" },
  { id: "serpapi", label: "SerpApi", group: "google-search", requirement: "optional", requirementLabel: "선택", note: "Google 추가 찾기 fallback", storage: "env.local", envKey: "SERPAPI_API_KEY" },
  { id: "opencode", label: "OpenCode Zen", group: "opencode", requirement: "optional", requirementLabel: "선택", note: "Spark fallback", storage: "opencode", providerId: "opencode" },
  { id: "openrouter", label: "OpenRouter", group: "opencode", requirement: "optional", requirementLabel: "선택", note: "Nemotron fallback", storage: "opencode", providerId: "openrouter" },
  { id: "bai", label: "B.AI", group: "opencode", requirement: "recommended", requirementLabel: "권장", note: "DeepSeek V4.1 Flash / Direct API", storage: "opencode", providerId: "bai" },
  { id: "zai-coding-plan", label: "Z.AI Coding Plan", group: "opencode", requirement: "optional", requirementLabel: "선택", note: "GLM fallback", storage: "opencode", providerId: "zai-coding-plan" },
  { id: "venice", label: "Venice", group: "opencode", requirement: "optional", requirementLabel: "선택", note: "Ox Alpha fallback", storage: "opencode", providerId: "venice" },
];

export function getApiConnections(): ApiConnection[] {
  const env = readEnvLocal();
  const auth = readOpenCodeAuth();
  return CONNECTIONS.map((item) => ({
    id: item.id,
    label: item.label,
    group: item.group,
    requirement: item.requirement,
    requirementLabel: item.requirementLabel,
    note: item.note,
    storage: item.storage,
    connected: item.storage === "env.local"
      ? Boolean(item.envKey && (process.env[item.envKey]?.trim() || env[item.envKey]?.trim()))
      : Boolean(item.providerId && auth[item.providerId]?.type === "api" && auth[item.providerId]?.key?.trim()),
  }));
}

export function saveApiConnection(id: string, apiKeyInput: string) {
  const definition = CONNECTIONS.find((item) => item.id === id);
  if (!definition) throw new Error("지원하지 않는 API 연결입니다.");
  const apiKey = apiKeyInput.trim();
  if (apiKey.length < 8 || /[\r\n]/.test(apiKey)) throw new Error("API Key 형식이 올바르지 않습니다.");

  if (definition.storage === "env.local") {
    if (!definition.envKey) throw new Error("API 환경변수 설정이 없습니다.");
    upsertEnvValue(definition.envKey, apiKey);
    process.env[definition.envKey] = apiKey;
  } else {
    if (!definition.providerId) throw new Error("OpenCode provider 설정이 없습니다.");
    const auth = readOpenCodeAuth();
    auth[definition.providerId] = { type: "api", key: apiKey };
    mkdirSync(path.dirname(OPENCODE_AUTH_PATH), { recursive: true });
    writeFileSync(OPENCODE_AUTH_PATH, `${JSON.stringify(auth, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  return getApiConnections();
}

function readEnvLocal() {
  const output: Record<string, string> = {};
  let raw = "";
  try { raw = readFileSync(ENV_PATH, "utf8"); } catch { return output; }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    output[match[1]] = unquoteEnvValue(match[2]);
  }
  return output;
}

function upsertEnvValue(key: string, value: string) {
  let raw = "";
  try { raw = readFileSync(ENV_PATH, "utf8"); } catch {}
  const lines = raw ? raw.replace(/\r\n?/g, "\n").split("\n") : [];
  const nextLine = `${key}=${JSON.stringify(value)}`;
  const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
  if (index >= 0) lines[index] = nextLine;
  else lines.push(nextLine);
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  writeFileSync(ENV_PATH, `${lines.join("\n")}\n`, "utf8");
}

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed) as string; } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

type OpenCodeAuth = Record<string, { type?: string; key?: string }>;

function readOpenCodeAuth(): OpenCodeAuth {
  try {
    const parsed = JSON.parse(readFileSync(OPENCODE_AUTH_PATH, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as OpenCodeAuth : {};
  } catch {
    return {};
  }
}
export async function testBaiConnection() {
  const apiKey = readOpenCodeAuth().bai?.key?.trim();
  if (!apiKey) return { ok: false, code: "not_configured", error: "B.AI API Key를 먼저 저장해 주세요." };
  const started = Date.now();
  try {
    const response = await fetch("https://api.b.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "deepseek-v4.1-flash", messages: [{ role: "user", content: "Reply exactly: ok" }], max_tokens: 16 }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = String(payload?.error?.message ?? payload?.message ?? "");
      const code = response.status === 401 || response.status === 403 ? "auth"
        : response.status === 402 || /insufficient.*(?:credit|balance|quota)|(?:credit|balance).*insufficient/i.test(detail) ? "quota"
        : response.status === 429 ? "rate_limit"
        : response.status === 404 || /model.*(?:not found|invalid|unknown)/i.test(detail) ? "invalid_model"
        : response.status >= 500 ? "provider_unavailable" : "malformed_request";
      const messages: Record<string, string> = { auth: "B.AI 인증 실패", quota: "B.AI 잔액 부족", rate_limit: "B.AI 요청 한도 초과 (429)", invalid_model: "B.AI 모델 없음", provider_unavailable: "B.AI API 일시 오류", malformed_request: "B.AI 요청 형식 오류" };
      return { ok: false, code, error: messages[code] };
    }
    if (typeof payload?.choices?.[0]?.message?.content !== "string" || payload.choices[0].message.content.trim().toLowerCase() !== "ok") {
      return { ok: false, code: "invalid_response", error: "B.AI 연결 확인 응답이 올바르지 않습니다." };
    }
    const usage = payload?.usage;
    console.info("fixup_llm_test", { provider: "bai", model: "deepseek-v4.1-flash", inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null, outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null, duration: Date.now() - started, success: true });
    return { ok: true, provider: "bai", model: "deepseek-v4.1-flash", message: "B.AI / deepseek-v4.1-flash 연결 성공" };
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    return { ok: false, code: timeout ? "timeout" : "network", error: timeout ? "B.AI 응답 시간 초과" : "B.AI API 연결 오류" };
  }
}
