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
  { id: "opencode", label: "OpenCode Zen", group: "opencode", requirement: "recommended", requirementLabel: "권장", note: "Spark 기본 모델 연결", storage: "opencode", providerId: "opencode" },
  { id: "openrouter", label: "OpenRouter", group: "opencode", requirement: "optional", requirementLabel: "선택", note: "Nemotron fallback", storage: "opencode", providerId: "openrouter" },
  { id: "vercel", label: "Vercel AI Gateway", group: "opencode", requirement: "optional", requirementLabel: "선택", note: "Qwen fallback", storage: "opencode", providerId: "vercel" },
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