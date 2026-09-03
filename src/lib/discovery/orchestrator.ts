import { checkAccountAvailabilities } from "./account-availability";
import { FOOD_REVIEW_SIGNALS, getGoogleQueryPlan, getQueryPlan } from "./query-plan";
import { extractInstagramCandidate, profileUrl, type InstagramCandidateExtraction } from "./instagram";
import { assessCandidate } from "./quality";
import { getConfiguredGoogleProviders, getConfiguredProviders } from "./providers";
import type {
  CandidateStatus,
  DiscoveryCandidate,
  DiscoveryResponse,
  DiscoverySource,
  GoogleSearchProviderName,
  RawSearchResult,
  SearchCategory,
  SearchProvider,
  SearchProviderName,
} from "./types";
import { findExistingHandles, saveCandidates } from "@/lib/supabase/candidates";
import {
  beginDiscoveryRun,
  completeDiscoveryRun,
  countManualExcludedHandles,
} from "@/lib/supabase/discovery-runs";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

export class NoSearchProvidersError extends Error {}
export class NoGoogleSearchProvidersError extends Error {}
export class GoogleSearchFailedError extends Error {}

type DiscoverInput = { category: SearchCategory; targetCount: number };
type ExtractedEvidence = { result: RawSearchResult; extraction: InstagramCandidateExtraction };
type GroupedEvidence = { grouped: Map<string, ExtractedEvidence[]>; filteredNoise: number };
type SearchOutcome = { results: RawSearchResult[]; failureCount: number };
type GoogleProviderOutcome = SearchOutcome & { successCount: number; queriesRun: number };
type ProcessInput = {
  source: DiscoverySource;
  category: SearchCategory;
  targetCount: number;
  runNo: number;
  rawResults: RawSearchResult[];
  queriesRun: number;
  providerFailureCount: number;
  providersUsed: SearchProviderName[];
};

export async function discoverCreators({ category, targetCount }: DiscoverInput): Promise<DiscoveryResponse> {
  const providers = getConfiguredProviders();
  if (!providers.length) throw new NoSearchProvidersError();

  const runNo = await beginDiscoveryRun(category);
  const queries = getQueryPlan(category, runNo);
  const concurrency = clamp(Number(process.env.DISCOVERY_CONCURRENCY ?? 4), 1, 8);
  const rawResults: RawSearchResult[] = [];
  let queriesRun = 0;
  let providerFailureCount = 0;

  for (let offset = 0; offset < queries.length; offset += concurrency) {
    const wave = queries.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      wave.map((query, index) => searchWithFallback(query, providers, (offset + index) % providers.length)),
    );
    queriesRun += wave.length;
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      rawResults.push(...result.value.results);
      providerFailureCount += result.value.failureCount;
    }
  }

  return processDiscoveryResults({
    source: "standard",
    category,
    targetCount,
    runNo,
    rawResults,
    queriesRun,
    providerFailureCount,
    providersUsed: providers.map((provider) => provider.name),
  });
}

export async function discoverGoogleCreators({ category, targetCount }: DiscoverInput): Promise<DiscoveryResponse> {
  const providers = getConfiguredGoogleProviders();
  if (!providers.length) throw new NoGoogleSearchProvidersError();

  const runNo = await beginDiscoveryRun(category);
  const concurrency = clamp(Number(process.env.DISCOVERY_CONCURRENCY ?? 4), 1, 8);
  const outcomes = await Promise.all(providers.map(async (provider): Promise<GoogleProviderOutcome> => {
    if (provider.name !== "serper" && provider.name !== "serpapi") {
      return { results: [], failureCount: 0, successCount: 0, queriesRun: 0 };
    }
    const queries = getGoogleQueryPlan(category, runNo, provider.name as GoogleSearchProviderName);
    return searchGoogleProvider(provider, queries, concurrency);
  }));

  const rawResults = outcomes.flatMap((outcome) => outcome.results);
  const queriesRun = outcomes.reduce((sum, outcome) => sum + outcome.queriesRun, 0);
  const providerFailureCount = outcomes.reduce((sum, outcome) => sum + outcome.failureCount, 0);
  const successCount = outcomes.reduce((sum, outcome) => sum + outcome.successCount, 0);

  if (successCount === 0) throw new GoogleSearchFailedError();

  return processDiscoveryResults({
    source: "google",
    category,
    targetCount,
    runNo,
    rawResults,
    queriesRun,
    providerFailureCount,
    providersUsed: providers.map((provider) => provider.name),
  });
}

async function processDiscoveryResults(input: ProcessInput): Promise<DiscoveryResponse> {
  const warnings: string[] = [];
  const preparedResults = input.source === "google" ? dedupeRawResultsByUrl(input.rawResults) : input.rawResults;
  const groupedBatch = groupRawEvidence(preparedResults);
  const groupedHandles = [...groupedBatch.grouped.keys()];
  const existing = await findExistingHandles(groupedHandles);
  const manualExcludedCount = await countManualExcludedHandles(input.category, [...existing]);
  const freshGrouped = new Map(
    [...groupedBatch.grouped.entries()].filter(([handle]) => !existing.has(handle)),
  );

  // DB에 한 번이라도 저장된 handle은 여기까지 오지 않는다.
  // 신규 handle만 기존 account availability/품질 판정과 동일 저장 로직을 탄다.
  const candidates = await groupedToCandidates(freshGrouped, input.category);
  const rejected = candidates.filter((candidate) => candidate.candidateStatus === "hard_reject");
  const viable = candidates.filter((candidate) => candidate.candidateStatus !== "hard_reject");

  await saveCandidates(candidates);

  const ranked = viable.sort(compareCandidates);
  const selected = ranked.slice(0, input.targetCount);
  const qualifiedCount = selected.filter((candidate) => candidate.candidateStatus === "search_qualified").length;
  const reviewCount = selected.filter((candidate) => candidate.candidateStatus === "needs_review").length;
  const recommendedCount = candidates.filter((candidate) => candidate.candidateStatus === "search_qualified" || candidate.candidateStatus === "qualified").length;
  const needsReviewCount = candidates.filter((candidate) => candidate.candidateStatus === "needs_review").length;
  const filteredNoise = groupedBatch.filteredNoise + rejected.length;

  await completeDiscoveryRun(input.category, input.runNo, {
    targetCount: input.targetCount,
    queryCount: input.queriesRun,
    exaRawCount: input.rawResults.filter((result) => result.provider === "exa").length,
    tavilyRawCount: input.rawResults.filter((result) => result.provider === "tavily").length,
    rawUrlCount: new Set(preparedResults.map((result) => result.url)).size,
    extractedResultCount: preparedResults.length - groupedBatch.filteredNoise,
    uniqueHandleCount: groupedBatch.grouped.size,
    existingCandidateCount: existing.size,
    hardRejectCount: rejected.length,
    manualExcludedCount,
    otherFilteredCount: groupedBatch.filteredNoise,
    newSavedCount: candidates.length,
    evidenceEnrichedCount: 0,
    finalAddedCount: selected.length,
    providerFailureCount: input.providerFailureCount,
  });

  if (!isSupabaseConfigured()) warnings.push("Supabase가 설정되지 않아 실행 간 DB 기존 후보 제외가 적용되지 않습니다.");
  if (selected.length < input.targetCount) warnings.push(`이번 검색에서는 신규 후보 ${selected.length}명만 확보했습니다. 다음 검색 lane에서 이어서 찾습니다.`);
  if (reviewCount > 0) warnings.push(`${reviewCount}명은 계정 존재 또는 핵심 판단 근거를 추가 확인해야 합니다.`);
  if (input.providerFailureCount > 0) warnings.push(`검색 provider 호출 ${input.providerFailureCount}회가 실패했지만 성공한 provider 결과는 정상 처리했습니다.`);

  return {
    source: input.source,
    category: input.category,
    targetCount: input.targetCount,
    runNo: input.runNo,
    candidates: selected,
    qualifiedCount,
    reviewCount,
    filteredNoise,
    skippedDuplicates: existing.size,
    queriesRun: input.queriesRun,
    providersUsed: input.providersUsed,
    warnings,
    sourceResultCount: input.rawResults.length,
    instagramHandleCount: groupedBatch.grouped.size,
    existingExcludedCount: existing.size,
    newCandidateCount: freshGrouped.size,
    recommendedCount,
    needsReviewCount,
    excludedCount: rejected.length,
  };
}

async function searchWithFallback(query: string, providers: SearchProvider[], startIndex: number): Promise<SearchOutcome> {
  let lastError: unknown;
  let failureCount = 0;
  for (let attempt = 0; attempt < providers.length; attempt += 1) {
    const provider = providers[(startIndex + attempt) % providers.length];
    try {
      return { results: await provider.search(query, 18), failureCount };
    } catch (error) {
      lastError = error;
      failureCount += 1;
    }
  }
  console.warn("search_query_failed", { query, error: lastError });
  return { results: [], failureCount };
}

async function searchGoogleProvider(provider: SearchProvider, queries: string[], concurrency: number): Promise<GoogleProviderOutcome> {
  const results: RawSearchResult[] = [];
  let failureCount = 0;
  let successCount = 0;

  for (let offset = 0; offset < queries.length; offset += concurrency) {
    const wave = queries.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(wave.map((query) => provider.search(query, 10)));
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      if (result.status === "fulfilled") {
        successCount += 1;
        results.push(...result.value);
      } else {
        failureCount += 1;
        console.warn("google_search_query_failed", { provider: provider.name, query: wave[index] });
      }
    }
  }

  return { results, failureCount, successCount, queriesRun: queries.length };
}

function dedupeRawResultsByUrl(results: RawSearchResult[]) {
  const seen = new Set<string>();
  const deduped: RawSearchResult[] = [];

  for (const result of results) {
    const key = normalizeResultUrl(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

function normalizeResultUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
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
    const followers = extractFollowerReference(profileEvidence.length ? profileEvidence : evidence);

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
      followers,
      followersSource: followers === null ? null : "search",
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

function extractFollowerReference(evidence: ExtractedEvidence[]) {
  for (const item of evidence) {
    const value = extractFollowerCount(`${item.result.title}\n${item.result.text}`);
    if (value !== null) return value;
  }
  return null;
}

function extractFollowerCount(value: string) {
  const text = cleanText(value);
  const amount = "(\\d{1,3}(?:[,.]\\d{3})+|\\d+(?:[.,]\\d+)?)\\s*(万|[kKmM])?";
  const label = "(?:followers?|フォロワー(?:数)?)";
  const patterns = [
    new RegExp(`${label}\\s*[:：·\\-]?\\s*${amount}(?:\\s*(?:人|名))?`, "i"),
    new RegExp(`${amount}(?:\\s*(?:人|名))?\\s*${label}`, "i"),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = parseFollowerAmount(match[1], match[2] ?? "");
    if (parsed !== null) return parsed;
  }
  return null;
}

function parseFollowerAmount(rawNumber: string, rawUnit: string) {
  const unit = rawUnit.toLowerCase();
  let normalizedNumber = rawNumber;
  if (unit && /^\d+,\d{1,2}$/.test(rawNumber)) normalizedNumber = rawNumber.replace(",", ".");
  else normalizedNumber = rawNumber.replace(/,/g, "");

  const number = Number(normalizedNumber);
  if (!Number.isFinite(number) || number < 0) return null;

  const multiplier = rawUnit === "万" ? 10_000 : unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1;
  const followers = Math.round(number * multiplier);
  return Number.isSafeInteger(followers) && followers <= 2_000_000_000 ? followers : null;
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
