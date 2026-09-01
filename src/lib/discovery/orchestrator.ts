import { checkAccountAvailabilities } from "./account-availability";
import { FOOD_REVIEW_SIGNALS, getQueryPlan } from "./query-plan";
import { extractInstagramCandidate, profileUrl, type InstagramCandidateExtraction } from "./instagram";
import { assessCandidate } from "./quality";
import { getConfiguredProviders } from "./providers";
import type { CandidateStatus, DiscoveryCandidate, DiscoveryResponse, RawSearchResult, SearchCategory, SearchProvider } from "./types";
import { findExistingHandles, mergeWithStoredReviewEvidence, saveCandidates } from "@/lib/supabase/candidates";
import { beginDiscoveryRun } from "@/lib/supabase/discovery-runs";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

export class NoSearchProvidersError extends Error {}

type DiscoverInput = { category: SearchCategory; targetCount: number };
type ExtractedEvidence = { result: RawSearchResult; extraction: InstagramCandidateExtraction };
type GroupedEvidence = { grouped: Map<string, ExtractedEvidence[]>; filteredNoise: number };

export async function discoverCreators({ category, targetCount }: DiscoverInput): Promise<DiscoveryResponse> {
  const providers = getConfiguredProviders();
  if (!providers.length) throw new NoSearchProvidersError();

  const runNo = await beginDiscoveryRun(category);
  const queries = getQueryPlan(category, runNo);
  const concurrency = clamp(Number(process.env.DISCOVERY_CONCURRENCY ?? 4), 1, 8);
  const rawResults: RawSearchResult[] = [];
  const warnings: string[] = [];
  let queriesRun = 0;

  for (let offset = 0; offset < queries.length; offset += concurrency) {
    const wave = queries.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      wave.map((query, index) => searchWithFallback(query, providers, (offset + index) % providers.length)),
    );
    queriesRun += wave.length;
    rawResults.push(...settled.flatMap((result) => result.status === "fulfilled" ? result.value : []));
  }

  const groupedBatch = groupRawEvidence(rawResults);
  const existing = await findExistingHandles([...groupedBatch.grouped.keys()]);
  const freshGrouped = new Map(
    [...groupedBatch.grouped.entries()].filter(([handle]) => !existing.has(handle)),
  );

  // Instagram 원본에는 프로필 존재 여부만 가볍게 확인한다.
  // BIO/팔로워/Reels는 이 단계에서 열지 않고, 접근 실패는 없는 계정으로 단정하지 않는다.
  const candidates = await groupedToCandidates(freshGrouped, category);
  const enriched = await mergeWithStoredReviewEvidence(candidates, category);
  const rejected = enriched.filter((candidate) => candidate.candidateStatus === "hard_reject");
  const viable = enriched.filter((candidate) => candidate.candidateStatus !== "hard_reject");

  await saveCandidates(enriched);

  const ranked = viable.sort(compareCandidates);
  const selected = ranked.slice(0, targetCount);
  const qualifiedCount = selected.filter((candidate) => candidate.candidateStatus === "search_qualified").length;
  const reviewCount = selected.filter((candidate) => candidate.candidateStatus === "needs_review").length;
  const filteredNoise = groupedBatch.filteredNoise + rejected.length;

  if (!isSupabaseConfigured()) warnings.push("Supabase가 설정되지 않아 실행 간 중복 기록은 저장되지 않습니다.");
  if (selected.length < targetCount) warnings.push(`이번 검색에서는 신규/보강 후보 ${selected.length}명만 확보했습니다. 다음 검색 lane에서 이어서 찾습니다.`);
  if (reviewCount > 0) warnings.push(`${reviewCount}명은 계정 존재 또는 핵심 판단 근거를 추가 확인해야 합니다.`);

  return {
    category,
    targetCount,
    runNo,
    candidates: selected,
    qualifiedCount,
    reviewCount,
    filteredNoise,
    skippedDuplicates: existing.size,
    queriesRun,
    providersUsed: providers.map((provider) => provider.name),
    warnings,
  };
}

async function searchWithFallback(query: string, providers: SearchProvider[], startIndex: number) {
  let lastError: unknown;
  for (let attempt = 0; attempt < providers.length; attempt += 1) {
    const provider = providers[(startIndex + attempt) % providers.length];
    try {
      return await provider.search(query, 18);
    } catch (error) {
      lastError = error;
    }
  }
  console.warn("search_query_failed", { query, error: lastError });
  return [];
}

function groupRawEvidence(results: RawSearchResult[]): GroupedEvidence {
  const grouped = new Map<string, ExtractedEvidence[]>();
  let filteredNoise = 0;

  for (const result of results) {
    const extraction = extractInstagramCandidate(result.url, result.title, result.text);
    if (!extraction) {
      filteredNoise += 1;
      continue;
    }
    const current = grouped.get(extraction.handle) ?? [];
    current.push({ result, extraction });
    grouped.set(extraction.handle, current);
  }

  return { grouped, filteredNoise };
}

async function groupedToCandidates(grouped: Map<string, ExtractedEvidence[]>, category: SearchCategory) {
  const now = new Date().toISOString();
  const availability = await checkAccountAvailabilities([...grouped.keys()]);
  const candidates: DiscoveryCandidate[] = [];

  for (const [handle, evidence] of grouped) {
    const profileEvidence = evidence.filter((item) => item.extraction.evidenceKind === "profile");
    const evidenceKind = profileEvidence.length ? "profile" : "content";
    const primary = profileEvidence[0] ?? evidence[0];
    const combinedText = joinEvidence(evidence.map((item) => `${item.result.title}\n${item.result.text}`), 2400);
    const profileText = joinEvidence(profileEvidence.map((item) => `${item.result.title}\n${item.result.text}`), 1600);
    const accountAvailability = availability.get(handle) ?? "unknown";

    const assessment = assessCandidate({
      handle,
      evidenceKind,
      title: "",
      text: combinedText,
      profileText,
      category,
      accountAvailability,
    });

    const foodFlags = category === "food"
      ? FOOD_REVIEW_SIGNALS
          .filter((signal) => combinedText.toLowerCase().includes(signal.toLowerCase()))
          .map((signal) => `제외검토:${signal}`)
      : [];

    candidates.push({
      handle,
      profileUrl: profileUrl(handle),
      category,
      sourceProvider: primary.result.provider,
      evidenceUrl: primary.result.url,
      evidenceText: combinedText.slice(0, 1200),
      evidenceKind,
      accountAvailability,
      accountType: assessment.accountType,
      koreaAffinity: assessment.koreaAffinity,
      contentFit: assessment.contentFit,
      eligibility: assessment.eligibility,
      activity: assessment.activity,
      candidateStatus: assessment.candidateStatus,
      targetSignals: assessment.targetSignals,
      koreaSignals: assessment.koreaSignals,
      rejectReasons: assessment.rejectReasons,
      flags: [...new Set([...assessment.flags, ...foodFlags])],
      duplicateCheckStatus: "not_checked",
      duplicateCheckMessage: null,
      duplicateCheckedAt: null,
      bio: null,
      followers: null,
      reelAverage: null,
      reelMedian: null,
      reelSampleSize: null,
      reelCheckedCount: null,
      reelTotalConsidered: null,
      reelMetricsStatus: "not_checked",
      reelViews: [],
      lastActivityAt: null,
      verificationNote: null,
      verificationStatus: assessment.candidateStatus === "hard_reject" ? "hard_reject" : "needs_instagram",
      verifiedAt: null,
      discoveredAt: now,
    });
  }

  return candidates;
}

function joinEvidence(values: string[], maxLength: number) {
  const unique = [...new Set(values.map(cleanText).filter((value) => value.length >= 2))];
  return unique.join("\n").slice(0, maxLength);
}

function cleanText(value: string) {
  return value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compareCandidates(a: DiscoveryCandidate, b: DiscoveryCandidate) {
  const statusRank: Record<CandidateStatus, number> = { hard_reject: 0, needs_review: 1, search_qualified: 2, qualified: 3 };
  const statusDiff = statusRank[b.candidateStatus] - statusRank[a.candidateStatus];
  if (statusDiff) return statusDiff;
  if (a.evidenceKind !== b.evidenceKind) return a.evidenceKind === "profile" ? -1 : 1;
  const aSignals = a.targetSignals.length + a.koreaSignals.length;
  const bSignals = b.targetSignals.length + b.koreaSignals.length;
  return bSignals - aSignals;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
