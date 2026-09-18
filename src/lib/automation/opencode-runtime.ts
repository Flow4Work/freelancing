import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type OpenCodeRuntimeStatus = "pending" | "running" | "completed" | "failed";

export function getOpenCodeRuntimeRoot() {
  return path.join(tmpdir(), "fixup-scout");
}

export function getVerificationPostFailurePath(jobId: string) {
  return path.join(getOpenCodeRuntimeRoot(), `${jobId}.verification-post-failed`);
}

export async function getOpenCodeFailureTrace(jobId: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(jobId)) return null;
  const root = getOpenCodeRuntimeRoot();
  let raw = "";
  try { raw = await readFile(path.join(root, `${jobId}.opencode.log`), "utf8"); } catch { return null; }

  let sequence: number | null = null;
  const attempts: Array<{ sequence: number | null; model: string; classification: string; detail: string }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const control = line.match(/^\[FixUp Scout\]\[control\].*?\bmodel=(\S+)\s+attempt=(\d+)\b/);
    if (control) { sequence = Number.parseInt(control[2], 10); continue; }
    const attempt = line.match(/^\[FixUp Scout\]\[attempt\].*?\bmodel=(\S+)\s+classification=(\S+)\s+fallback=(?:True|False)\s+detail=(.*)$/);
    if (attempt && attempt[2] !== "completed") attempts.push({ sequence, model: attempt[1], classification: attempt[2], detail: attempt[3] });
  }
  if (!attempts.length) return null;

  const parts = await Promise.all(attempts.map(async (attempt) => {
    const label = attempt.model.includes("/") ? attempt.model.slice(attempt.model.indexOf("/") + 1) : attempt.model;
    if (attempt.model.startsWith("openrouter/")) {
      let dailyQuota = /OpenRouter.*일일|free-models-per-day/i.test(attempt.detail);
      if (!dailyQuota && attempt.sequence) {
        try { dailyQuota = /free-models-per-day/i.test(await readFile(path.join(root, `${jobId}.attempt-${attempt.sequence}.stderr.log`), "utf8")); } catch {}
      }
      if (dailyQuota) return `${label}=OpenRouter 일일한도`;
    }
    const reason = attempt.classification === "quota" ? "quota"
      : attempt.classification === "rate_limit" ? "429"
      : attempt.classification === "provider_unavailable" ? "5xx/일시장애"
      : attempt.classification === "browser_unavailable" ? "브라우저/MCP"
      : attempt.classification === "tool_execution" ? "브라우저/도구실행"
      : attempt.classification === "incomplete" ? "미완료"
      : attempt.classification === "verification_post_failure" ? "POST실패"
      : attempt.classification;
    return `${label}=${reason}`;
  }));
  return `${attempts.some((a) => !["quota", "rate_limit", "provider_unavailable"].includes(a.classification)) ? "로컬 실행 중단" : "fallback 전체 실패"} · ${parts.join(" → ")}`;
}

export async function signalVerificationPostFailure(jobId: string, message: string) {
  const root = getOpenCodeRuntimeRoot();
  await mkdir(root, { recursive: true });
  const clean = message.replace(/[\t\r\n ]+/g, " ").trim().slice(0, 500) || "verification POST failed";
  await writeFile(getVerificationPostFailurePath(jobId), clean, { encoding: "utf8" });
}

export async function clearVerificationPostFailure(jobId: string) {
  await rm(getVerificationPostFailurePath(jobId), { force: true });
}

export async function getOpenCodeRuntimeStatus(jobId: string, terminal: "pending" | "completed" | "failed"): Promise<OpenCodeRuntimeStatus> {
  if (terminal !== "pending") return terminal;
  try {
    const heartbeat = await stat(path.join(getOpenCodeRuntimeRoot(), `${jobId}.heartbeat`));
    if (Date.now() - heartbeat.mtimeMs <= 30_000) return "running";
  } catch {}
  return "pending";
}
