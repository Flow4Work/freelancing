import type { DiscoveryCandidate, DuplicateCheckStatus, ReelMetricsStatus, ReelSnapshot, SearchCategory, SearchProviderName, VerificationStatus } from "@/lib/discovery/types";
import { getCandidateViewState } from "@/lib/discovery/presentation";
import { isValidHandle } from "@/lib/discovery/instagram";
import { assessCandidate } from "@/lib/discovery/quality";
import { getSupabaseAdmin } from "./admin";

const DUPLICATE_BLOCKING_STATUSES = new Set(["search_qualified", "hard_reject", "qualified", "private", "contacted"]);
const FINAL_VERIFICATION_STATUSES = new Set(["verified", "insufficient", "private", "rejected", "hard_reject"]);
const VISIBLE_STATUSES = ["discovered", "search_qualified", "needs_review", "qualified"];

export type CandidateAutomationMode = "duplicate" | "instagram";

export async function findExistingHandles(handles: string[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase || handles.length === 0) return new Set<string>();

  const normalized = [...new Set(handles.map((handle) => handle.toLowerCase()))];
  const blocked = new Set<string>();
  const { data, error } = await supabase
    .from("creator_candidates")
    .select("normalized_handle, discovery_status, verification_status")
    .in("normalized_handle", normalized);

  if (error) {
    console.warn("supabase_duplicate_check_failed", error.message);
  } else {
    for (const row of data ?? []) {
      if (
        DUPLICATE_BLOCKING_STATUSES.has(String(row.discovery_status))
        || FINAL_VERIFICATION_STATUSES.has(String(row.verification_status))
      ) {
        blocked.add(String(row.normalized_handle));
      }
    }
  }

  const contacted = await findContactedHandles(normalized);
  contacted.forEach((handle) => blocked.add(handle));
  return blocked;
}

export async function mergeWithStoredReviewEvidence(candidates: DiscoveryCandidate[], category: SearchCategory) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !candidates.length) return candidates;

  const handles = [...new Set(candidates.map((candidate) => candidate.handle))];
  const { data, error } = await supabase
    .from("creator_candidates")
    .select("normalized_handle, source_provider, evidence_url, evidence_text, evidence_kind, flags, discovery_status")
    .eq("category", category)
    .eq("verification_status", "needs_instagram")
    .in("normalized_handle", handles)
    .in("discovery_status", ["discovered", "needs_review"]);

  if (error) {
    console.warn("supabase_review_evidence_merge_failed", error.message);
    return candidates;
  }

  const previous = new Map((data ?? []).map((row) => [String(row.normalized_handle), row]));

  return candidates.map((candidate) => {
    const prior = previous.get(candidate.handle);
    if (!prior) return candidate;

    const priorText = String(prior.evidence_text ?? "");
    const priorKind = prior.evidence_kind === "profile" ? "profile" : "content";
    const evidenceKind = candidate.evidenceKind === "profile" || priorKind === "profile" ? "profile" : "content";
    const combinedText = mergeEvidenceText(priorText, candidate.evidenceText);
    const profileText = mergeEvidenceText(
      priorKind === "profile" ? priorText : "",
      candidate.evidenceKind === "profile" ? candidate.evidenceText : "",
      1600,
    );

    const assessment = assessCandidate({
      handle: candidate.handle,
      evidenceKind,
      title: "",
      text: combinedText,
      profileText,
      category,
    });

    const preservedReviewFlags = [
      ...stringArray(prior.flags),
      ...candidate.flags,
    ].filter((flag) => flag.startsWith("제외검토:"));

    const usePriorPrimary = priorKind === "profile" && candidate.evidenceKind !== "profile";

    return {
      ...candidate,
      sourceProvider: usePriorPrimary ? normalizeProvider(prior.source_provider) : candidate.sourceProvider,
      evidenceUrl: usePriorPrimary ? String(prior.evidence_url ?? candidate.evidenceUrl) : candidate.evidenceUrl,
      evidenceText: combinedText,
      evidenceKind,
      candidateStatus: assessment.candidateStatus,
      targetSignals: assessment.targetSignals,
      koreaSignals: assessment.koreaSignals,
      rejectReasons: assessment.rejectReasons,
      flags: [...new Set([...assessment.flags, ...preservedReviewFlags])],
      verificationStatus: assessment.candidateStatus === "hard_reject" ? "hard_reject" : "needs_instagram",
    };
  });
}

export async function listCandidates(category: SearchCategory) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("creator_candidates")
    .select("normalized_handle, profile_url, category, source_provider, evidence_url, evidence_text, evidence_kind, target_signals, korea_signals, flags, duplicate_check_status, duplicate_check_message, duplicate_checked_at, bio, followers, reel_average, reel_median, reel_sample_size, reel_checked_count, reel_total_considered, reel_metrics_status, reel_views, last_activity_at, verification_note, verification_status, discovery_status, verified_at, first_seen_at, last_seen_at")
    .eq("category", category)
    .in("discovery_status", VISIBLE_STATUSES)
    .order("first_seen_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.warn("supabase_candidate_list_failed", error.message);
    return [];
  }

  const handles = (data ?? []).map((row) => String(row.normalized_handle));
  const contacted = await findContactedHandles(handles);

  return (data ?? []).flatMap((row): DiscoveryCandidate[] => {
    const handle = String(row.normalized_handle);
    if (!isValidHandle(handle) || contacted.has(handle)) return [];

    const rawStatus = String(row.discovery_status);
    const evidenceKind = row.evidence_kind === "content" ? "content" : "profile";
    const evidenceText = String(row.evidence_text ?? "");
    let candidateStatus: "search_qualified" | "needs_review" = rawStatus === "search_qualified" || rawStatus === "qualified"
      ? "search_qualified"
      : "needs_review";
    let targetSignals = stringArray(row.target_signals);
    let koreaSignals = stringArray(row.korea_signals);
    let flags = stringArray(row.flags).filter((flag) => !flag.startsWith("제외:") && flag !== "기존 결과·재검증 필요");

    if (rawStatus === "discovered") {
      const assessment = assessCandidate({ handle, evidenceKind, title: "", text: evidenceText, category });
      if (assessment.candidateStatus === "hard_reject") return [];
      candidateStatus = assessment.candidateStatus === "search_qualified" ? "search_qualified" : "needs_review";
      targetSignals = assessment.targetSignals;
      koreaSignals = assessment.koreaSignals;
      flags = assessment.flags;
    }

    return [{
      handle,
      profileUrl: String(row.profile_url),
      category,
      sourceProvider: normalizeProvider(row.source_provider),
      evidenceUrl: String(row.evidence_url ?? row.profile_url),
      evidenceText,
      evidenceKind,
      candidateStatus,
      targetSignals,
      koreaSignals,
      rejectReasons: [],
      flags,
      duplicateCheckStatus: normalizeDuplicateCheckStatus(row.duplicate_check_status),
      duplicateCheckMessage: nullableString(row.duplicate_check_message),
      duplicateCheckedAt: nullableString(row.duplicate_checked_at),
      bio: nullableString(row.bio),
      followers: numberOrNull(row.followers),
      reelAverage: numberOrNull(row.reel_average),
      reelMedian: numberOrNull(row.reel_median),
      reelSampleSize: numberOrNull(row.reel_sample_size),
      reelCheckedCount: numberOrNull(row.reel_checked_count),
      reelTotalConsidered: numberOrNull(row.reel_total_considered),
      reelMetricsStatus: normalizeReelMetricsStatus(row.reel_metrics_status),
      reelViews: normalizeReelViews(row.reel_views),
      lastActivityAt: nullableString(row.last_activity_at),
      verificationNote: nullableString(row.verification_note),
      verificationStatus: normalizeVerificationStatus(row.verification_status),
      verifiedAt: nullableString(row.verified_at),
      discoveredAt: String(row.first_seen_at ?? row.last_seen_at ?? new Date().toISOString()),
    }];
  });
}

export async function saveCandidates(candidates: DiscoveryCandidate[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase || candidates.length === 0) return;

  const contacted = await findContactedHandles(candidates.map((candidate) => candidate.handle));
  const rows = candidates
    .filter((candidate) => !contacted.has(candidate.handle))
    .map((candidate) => ({
      handle: candidate.handle,
      normalized_handle: candidate.handle,
      profile_url: candidate.profileUrl,
      category: candidate.category,
      source_provider: candidate.sourceProvider,
      evidence_url: candidate.evidenceUrl,
      evidence_text: candidate.evidenceText,
      evidence_kind: candidate.evidenceKind,
      target_signals: candidate.targetSignals,
      korea_signals: candidate.koreaSignals,
      flags: [...candidate.flags, ...candidate.rejectReasons.map((reason) => `제외:${reason}`)],
      verification_status: candidate.verificationStatus,
      discovery_status: candidate.candidateStatus,
      last_seen_at: candidate.discoveredAt,
    }));

  if (!rows.length) return;

  const { error } = await supabase.from("creator_candidates").upsert(rows, { onConflict: "normalized_handle" });
  if (error) {
    console.error("supabase_candidate_save_failed", error.message);
    throw new Error(`후보 저장 실패: ${error.message}`);
  }
}

export async function getAutomationCandidates(
  category: SearchCategory,
  handles: string[],
  mode: CandidateAutomationMode,
) {
  const requested = new Set(handles.map((handle) => handle.toLowerCase()));
  const candidates = await listCandidates(category);

  return candidates.filter((candidate) => {
    if (!requested.has(candidate.handle)) return false;
    const state = getCandidateViewState(candidate);
    if (mode === "duplicate") return state === "qualified";
    return state === "priority";
  });
}

export async function getVerificationCandidates(category: SearchCategory, handles: string[]) {
  return getAutomationCandidates(category, handles, "instagram");
}

async function findContactedHandles(handles: string[]) {
  const supabase = getSupabaseAdmin();
  if (!supabase || handles.length === 0) return new Set<string>();
  const normalized = [...new Set(handles.map((handle) => handle.toLowerCase()))];
  const { data, error } = await supabase
    .from("creator_contacted_handles")
    .select("normalized_handle")
    .in("normalized_handle", normalized);

  if (error) {
    console.warn("supabase_contacted_check_failed", error.message);
    return new Set<string>();
  }
  return new Set((data ?? []).map((row) => String(row.normalized_handle)));
}

function mergeEvidenceText(first: string, second: string, maxLength = 2400) {
  return [...new Set([first, second].map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))]
    .join("\n")
    .slice(0, maxLength);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function nullableString(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeProvider(value: unknown): SearchProviderName {
  return value === "tavily" ? "tavily" : "exa";
}

function normalizeVerificationStatus(value: unknown): VerificationStatus {
  const allowed: VerificationStatus[] = ["needs_instagram", "verified", "insufficient", "private", "rejected", "hard_reject"];
  return allowed.includes(value as VerificationStatus) ? value as VerificationStatus : "needs_instagram";
}

function normalizeDuplicateCheckStatus(value: unknown): DuplicateCheckStatus {
  const allowed: DuplicateCheckStatus[] = ["not_checked", "available", "duplicate", "protected", "unknown"];
  return allowed.includes(value as DuplicateCheckStatus) ? value as DuplicateCheckStatus : "not_checked";
}

function normalizeReelMetricsStatus(value: unknown): ReelMetricsStatus {
  return value === "ready" || value === "insufficient" ? value : "not_checked";
}

function normalizeReelViews(value: unknown): ReelSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { url: nullableString(row.url), views: numberOrNull(row.views), postedAt: nullableString(row.postedAt) };
  });
}
