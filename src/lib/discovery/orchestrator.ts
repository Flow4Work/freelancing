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
type CandidateBatch = { candidates: DiscoveryCandidate[]; filteredNoise: number };
type ExtractedEvidence = { result: RawSearchResult; extraction: InstagramCandidateExtraction };

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

  // 같은 실행 안의 여러 검색 결과를 handle별로 합친 뒤, 이전 실행에서 review였던
  // 저장 근거까지 한 번 더 합쳐 판정한다. 부족한 근거가 쌓이면 review -> 유력으로 승격된다.
  const batch = rawToCandidates(rawResults, category);
  const enriched = await mergeWithStoredReviewEvidence(batch.candidates, category);
  const existing = await findExistingHandles(enriched.map((candidate) => candidate.handle));
  const fresh = enriched.filter((candidate) => !existing.has(candidate.handle));
  const rejected = fresh.filter((candidate) => candidate.candidateStatus === "hard_reject");
  const viable = fresh.filter((candidate) => candidate.candidateStatus !== "hard_reject");

  await saveCandidates(fresh);

  const ranked = viable.sort(compareCandidates);
  const candidates = ranked.slice(0, targetCount);
  const qualifiedCount = candidates.filter((candidate) => candidate.candidateStatus === "search_qualified").length;
  const reviewCount = candidates.filter((candidate) => candidate.candidateStatus === "needs_review").length;
  const filteredNoise = batch.filteredNoise + rejected.length;

  if (!isSupabaseConfigured()) warnings.push("Supabase가 설정되지 않아 실행 간 중복 기록은 저장되지 않습니다.");
  if (candidates.length < targetCount) warnings.push(`이번 검색에서는 신규/보강 후보 ${candidates.length}명만 확보했습니다. 다음 검색 lane에서 이어서 찾습니다.`);
  if (reviewCount > 0) warnings.push(`${reviewCount}명은 Instagram 원본 검증 또는 추가 검색 근거가 더 필요합니다.`);

  return {
    category,
    targetCount,
    runNo,
    candidates,
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

function rawToCandidates(results: RawSearchResult[], category: SearchCategory): CandidateBatch {
  const now = new Date().toISOString();
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

  const candidates: DiscoveryCandidate[] = [];

  for (const [handle, evidence] of grouped) {
    const profileEvidence = evidence.filter((item) => item.extraction.evidenceKind === "profile");
    const evidenceKind = profileEvidence.length ? "profile" : "content";
    const primary = profileEvidence[0] ?? evidence[0];
    const combinedText = joinEvidence(evidence.map((item) => `${item.result.title}\n${item.result.text}`), 2400);
    const profileText = joinEvidence(profileEvidence.map((item) => `${item.result.title}\n${item.result.text}`), 1600);

    const assessment = assessCandidate({
      handle,
      evidenceKind,
      title: "",
      text: combinedText,
      profileText,
      category,
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

  return { candidates, filteredNoise };
}

function joinEvidence(values: string[], maxLength: number) {
  const unique = [...new Set(values.map(cleanText).filter((value) => value.length >= 2))];
  return unique.join("\n").slice(0, maxLength);
}

function cleanText(value: string) {
  return value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compareCandidates(a: DiscoveryCandidate, b: DiscoveryCandidate) {
  const statusRank: Record<CandidateStatus, number> = { hard_reject: 0, needs_review: 1, search_qualified: 2 };
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
