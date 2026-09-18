import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type OpenCodeModelPreset = "A" | "B" | "C" | "D";
type ModelKey = "spark" | "nemotron" | "bai" | "glm53" | "venice" | "glm47";

const DEFAULT_MODELS: Record<ModelKey, string> = {
  spark: "opencode/muse-spark-1.2-contributor-free",
  nemotron: "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
  bai: "bai/deepseek-v4.1-flash",
  glm53: "zai-coding-plan/glm-5.3-flash",
  venice: "venice/stealth-ox-alpha",
  glm47: "zai-coding-plan/glm-4.7",
};

const MODEL_ENV: Record<ModelKey, string> = {
  spark: "FIXUP_OPENCODE_PRIMARY_MODEL",
  nemotron: "FIXUP_OPENCODE_NEMOTRON_MODEL",
  bai: "FIXUP_OPENCODE_BAI_MODEL",
  glm53: "FIXUP_OPENCODE_GLM53_MODEL",
  venice: "FIXUP_OPENCODE_VENICE_MODEL",
  glm47: "FIXUP_OPENCODE_GLM47_MODEL",
};

const PRESET_ORDERS: Record<OpenCodeModelPreset, readonly ModelKey[]> = {
  A: ["spark", "nemotron", "bai", "glm53", "venice", "glm47"],
  B: ["nemotron", "bai", "glm53", "venice", "glm47", "spark"],
  C: ["glm53", "glm47", "spark", "nemotron", "bai", "venice"],
  D: ["bai", "spark", "nemotron", "glm53", "venice", "glm47"],
};

const SETTINGS_PATH = path.join(
  process.env.LOCALAPPDATA?.trim() || tmpdir(),
  "fixup-scout",
  "settings.json",
);

export function isOpenCodeModelPreset(value: unknown): value is OpenCodeModelPreset {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

export function getOpenCodeModelPreset(): OpenCodeModelPreset {
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as { openCodeModelPreset?: unknown };
    return isOpenCodeModelPreset(parsed.openCodeModelPreset) ? parsed.openCodeModelPreset : "A";
  } catch {
    return "A";
  }
}

export function setOpenCodeModelPreset(preset: OpenCodeModelPreset) {
  const directory = path.dirname(SETTINGS_PATH);
  mkdirSync(directory, { recursive: true });

  let current: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
  } catch {}

  writeFileSync(
    SETTINGS_PATH,
    `${JSON.stringify({ ...current, openCodeModelPreset: preset }, null, 2)}\n`,
    "utf8",
  );
  return preset;
}

export function getOpenCodeModelChain(preset = getOpenCodeModelPreset()) {
  const resolved = Object.fromEntries(
    (Object.keys(DEFAULT_MODELS) as ModelKey[]).map((key) => [
      key,
      process.env[MODEL_ENV[key]]?.trim() || DEFAULT_MODELS[key],
    ]),
  ) as Record<ModelKey, string>;

  if (resolved.nemotron !== DEFAULT_MODELS.nemotron) {
    throw new Error(`FIXUP_OPENCODE_NEMOTRON_MODEL must resolve to ${DEFAULT_MODELS.nemotron}; refusing an unverified model/variant`);
  }
  if (resolved.bai !== DEFAULT_MODELS.bai) {
    throw new Error("B.AI model must be bai/deepseek-v4.1-flash");
  }
  const chain = [...new Set(PRESET_ORDERS[preset].map((key) => resolved[key]))];
  if (chain.some((model) => /^vercel\//i.test(model))) {
    throw new Error("Vercel LLM routing is disabled. Select a direct provider.");
  }
  return chain;
}

export function getOpenCodeModelPresets() {
  return (Object.keys(PRESET_ORDERS) as OpenCodeModelPreset[]).map((id) => ({
    id,
    models: getOpenCodeModelChain(id),
  }));
}

// One argument policy for the supervisor child, DM and DM-sync PowerShell launchers.
export function getOpenCodeVariant(model: string): "high" | undefined {
  return model === DEFAULT_MODELS.nemotron ? "high" : undefined;
}

export function getOpenCodeVariantArgsScript(modelVariable: "$Model" | "$env:FIXUP_SCOUT_MODEL") {
  return `$VariantArgs = @(); if (${modelVariable} -eq "${DEFAULT_MODELS.nemotron}") { $VariantArgs = @("--variant", "${getOpenCodeVariant(DEFAULT_MODELS.nemotron)}") }`;
}
