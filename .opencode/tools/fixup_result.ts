import { z } from "zod";
import { verificationPayloadSchema } from "../../src/lib/verification/result-contract";

const SYNC_RESERVED_HANDLES = new Set([
  "about", "accounts", "api", "challenge", "developer", "direct", "directory", "emails",
  "explore", "graphql", "legal", "oauth", "p", "popular", "privacy", "reel", "reels",
  "session", "settings", "stories", "terms", "tv", "web", "web_search",
]);
const syncHandleSchema = z.string().min(1).max(30)
  .regex(/^(?=.{1,30}$)[A-Za-z0-9_](?:[A-Za-z0-9._]*[A-Za-z0-9_])?$/)
  .refine((value) => value === value.toLowerCase() && !value.includes("..") && !SYNC_RESERVED_HANDLES.has(value), "Invalid Instagram handle");
const syncContactFields = { contactId: z.string().uuid(), handle: syncHandleSchema };
const syncErrorField = z.string().max(300).optional().nullable();
export const syncPayloadSchema = z.discriminatedUnion("status", [
  z.object({ ...syncContactFields, status: z.literal("sent"), evidence: z.object({
    text: z.string().min(1).max(10000),
    direction: z.literal("outgoing"),
    currentAttempt: z.literal("yes"),
  }) }),
  z.object({ ...syncContactFields, status: z.literal("not_sent"), error: syncErrorField }),
  z.object({ ...syncContactFields, status: z.literal("uncertain"), error: syncErrorField }),
]);

// No command, URL, file path, or database access is accepted from the agent.
function submit(agent: string, endpoint: string, payloadSchema: z.ZodType = z.record(z.string(), z.unknown())) {
  return {
    description: "Submit verified FixUp result JSON to this agent's fixed localhost endpoint. Stop on any error.",
    args: { payload: payloadSchema.describe("Complete result payload as a JSON object, exactly as specified in the task") },
    async execute(args: { payload: Record<string, unknown> }, context: { agent: string }) {
      if (context.agent !== agent) throw new Error("FIXUP_PERMISSION_DENIED: result endpoint belongs to " + agent);
      try {
        const parsed = payloadSchema.safeParse(args.payload);
        if (!parsed.success) {
          const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`).join("; ");
          throw new Error("FIXUP_TOOL_VALIDATION_FAILED: " + detail);
        }
        const payload = parsed.data as Record<string, unknown>;
        const response = await fetch("http://localhost:3000" + endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(15000),
        });
        const body = await response.text();
        if (!response.ok) throw new Error("HTTP " + response.status + " " + body);
        const result = JSON.parse(body);
        if (result.ok !== true) throw new Error("Result not saved: " + body);
        return JSON.stringify({ ...result, fixupReceipt: { endpoint, id: payload.contactId || payload.jobId, handle: payload.handle } });
      } catch (error) {
        throw new Error("FIXUP_POST_FAILED " + endpoint + ": " + (error instanceof Error ? error.message : String(error)));
      }
    },
  };
}
export const duplicate = submit("fixup-duplicate", "/api/duplicate/results");
export const verification = submit("fixup-verification", "/api/verification/results", verificationPayloadSchema);
export const dm = submit("fixup-dm", "/api/dm/opencode-result");
export const sync = submit("fixup-dm-sync", "/api/dm/sync-result", syncPayloadSchema);
