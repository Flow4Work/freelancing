import { FOOD_REVIEW_SIGNALS, getQueryPlan } from "./query-plan";
import { extractInstagramCandidate, profileUrl } from "./instagram";
import { assessCandidate } from "./quality";
import { getConfiguredProviders } from "./providers";
import type { CandidateStatus, DiscoveryCandidate, DiscoveryResponse, RawSearchResult, SearchCategory, SearchProvider } from "./types";
import { findExistingHandles, saveCandidates } from "@/lib/supabase/candidates";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

export class NoSearchProvidersError extends Error {}

type DiscoverInput = { category: SearchCategory; targetCount: number };

type CandidateBatch = {
  candidates: DiscoveryCandidate[];
  filteredNoise: number;
};

export async function discoverCreators({ category, targetCount }: DiscoverInput): Promise<DiscoveryResponse> {
  const providers = getConfiguredProviders();
  if (!providers.length) throw new NoSearchProvidersError();

  const queries = getQueryPlan(category);
  const concurrency = clamp(Number(process.env.DISCOVERY_CONCURRENCY ?? 4), 1, 8);
  const fresh = new Map<string, DiscoveryCandidate>();
  const rejected = new Map<string, DiscoveryCandidate>();
  const knownExisting = new Set<string>();
  const warnings: string[] = [];
  let skippedDuplicates = 0;
  let filteredNoise = 0;
  let queriesRun = 0;

  // 모든 검색 lane을 실행한 뒤 유력 후보를 먼저 정렬한다.
  // "목표 수를 먼저 채운 검색 결과"가 품질 좋은 후반 쿼리를 막지 않게 하기 위함이다.
  for (let offset = 0; offset < queries.length; offset += concurrency) {
    const wave = queries.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      wave.map((query, index) => searchWithFallback(query, providers, (offset + index) % providers.length)),
    );
    queriesRun += wave.length;

    const raw = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const batch = rawToCandidates(raw, category);
    filteredNoise += batch.filteredNoise;

    const lookupHandles = [...new Set(
      batch.candidates
        .map((candidate) => candidate.handle)
        .filter((handle) => !knownExisting.has(handle) && !fresh.has(handle) && !rejected.has(handle)),
    )];

    const existing = await findExistingHandles(lookupHandles);
    existing.forEach((handle) => knownExisting.add(handle));
    skippedDuplicates += existing.size;

    for (const candidate of batch.candidates) {
      if (knownExisting.has(candidate.handle)) continue;

      if (candidate.candidateStatus === "hard_reject") {
        if (!rejected.has(candidate.handle)) filteredNoise += 1;
        fresh.delete(candidate.handle);
        rejected.set(candidate.handle, candidate);
        continue;
      }

      if (rejected.has(candidate.handle)) continue;
      const previous = fresh.get(candidate.handle);
      if (!previous || isBetterEvidence(candidate, previous)) fresh.set(candidate.handle, candidate);
    }
  }

  // 명백한 사업체/공식계정도 상태와 사유를 저장해 다음 검색에서 반복 노출되지 않게 한다.
  await saveCandidates([...fresh.values(), ...rejected.values()]);

  const ranked = [...fresh.values()].sort(compareCandidates);
  const candidates = ranked.slice(0, targetCount);
  const qualifiedCount = candidates.filter((candidate) => candidate.candidateStatus === "search_qualified").length;
  const reviewCount = candidates.filter((candidate) => candidate.candidateStatus === "needs_review").length;

  if (!isSupabaseConfigured()) warnings.push("Supabase가 설정되지 않아 실행 간 중복 기록은 저장되지 않습니다.");
  if (candidates.length < targetCount) warnings.push(`엄격 필터 후 ${candidates.length}명만 확보했습니다. 후보를 억지로 채우지 않고 검색 확장이 필요합니다.`);
  if (reviewCount > 0) warnings.push(`${reviewCount}명은 일본 타깃·한국 접점·장르 중 일부 근거가 약해 Instagram 원본 확인이 필요합니다.`);

  return {
    category,
    targetCount,
    candidates,
    qualifiedCount,
    reviewCount,
    filteredNoise,
    skippedDuplicates,
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
      // 검색 호출 수를 늘리지 않고 query당 recall을 높인다.
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
  const candidates: DiscoveryCandidate[] = [];
  let filteredNoise = 0;

  for (const result of results) {
    const extraction = extractInstagramCandidate(result.url, result.title, result.text);
    if (!extraction) {
      filteredNoise += 1;
      continue;
    }

    const assessment = assessCandidate({
      handle: extraction.handle,
      evidenceKind: extraction.evidenceKind,
      title: result.title,
      text: result.text,
      category,
    });

    const foodFlags = category === "food"
      ? FOOD_REVIEW_SIGNALS.filter((signal) => `${result.title}\n${result.text}`.toLowerCase().includes(signal.toLowerCase())).map((signal) => `제외검토:${signal}`)
      : [];

    candidates.push({
      handle: extraction.handle,
      profileUrl: profileUrl(extraction.handle),
      category,
      sourceProvider: result.provider,
      evidenceUrl: result.url,
      evidenceText: evidenceText(result),
      evidenceKind: extraction.evidenceKind,
      candidateStatus: assessment.candidateStatus,
      targetSignals: assessment.targetSignals,
      koreaSignals: assessment.koreaSignals,
      rejectReasons: assessment.rejectReasons,
      flags: [...assessment.flags, ...foodFlags],
      followers: null,
      reelAverage: null,
      reelMedian: null,
      reelSampleSize: null,
      verificationStatus: assessment.candidateStatus === "hard_reject" ? "hard_reject" : "needs_instagram",
      discoveredAt: now,
    });
  }

  return { candidates, filteredNoise };
}

function evidenceText(result: RawSearchResult) {
  const text = cleanText(result.text);
  const title = cleanText(result.title);
  return (text.length >= 20 ? text : title).slice(0, 360);
}

function cleanText(value: string) {
  return value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "")
    .replace(/!\[[^\]]*\]\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBetterEvidence(next: DiscoveryCandidate, previous: DiscoveryCandidate) {
  const statusRank: Record<CandidateStatus, number> = { hard_reject: 0, needs_review: 1, search_qualified: 2 };
  if (statusRank[next.candidateStatus] !== statusRank[previous.candidateStatus]) {
    return statusRank[next.candidateStatus] > statusRank[previous.candidateStatus];
  }
  if (next.evidenceKind !== previous.evidenceKind) return next.evidenceKind === "profile";
  return next.evidenceText.length > previous.evidenceText.length;
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
