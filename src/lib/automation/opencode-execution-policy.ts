export type OpenCodeExecutionMode = "duplicate" | "verification" | "dm" | "dm-sync";

const AGENT_BY_MODE: Record<OpenCodeExecutionMode, string> = {
  duplicate: "fixup-duplicate",
  verification: "fixup-verification",
  dm: "fixup-dm",
  "dm-sync": "fixup-dm-sync",
};

export function getOpenCodeAgent(mode: unknown): string {
  if (mode !== "duplicate" && mode !== "verification" && mode !== "dm" && mode !== "dm-sync") {
    throw new Error(`Unsupported OpenCode execution mode: ${String(mode)}`);
  }
  return AGENT_BY_MODE[mode];
}
