import { FOOD_REVIEW_SIGNALS, getQueryPlan } from "./query-plan";
import { extractInstagramHandle, profileUrl } from "./instagram";
import { getConfiguredProviders } from "./providers";
import type { DiscoveryCandidate, DiscoveryResponse, RawSearchResult, SearchCategory, SearchProvider } from "./types";
import { findExistingHandles, saveCandidates } from "@/lib/supabase/candidates";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

export class NoSearchProvidersError extends Error {}

type DiscoverInput = { category: SearchCategory; targetCount: number };

export async function discoverCreators({ category, targetCount }: DiscoverInput): Promise<DiscoveryResponse> {
  const providers = getConfiguredProviders();
  if (!providers.length) throw new NoSearchProvidersError();

  const queries = getQueryPlan(category);
  const concurrency = clamp(Number(process.env.DISCOVERY_CONCURRENCY ?? 4), 1, 8);
  const fresh = new Map<string, DiscoveryCandidate>();
  const knownExisting = new Set<string>();
  const warnings: string[] = [];
  let skippedDuplicates = 0;
  let queriesRun = 0;

  for (let offset = 0; offset < queries.length && fresh.size < targetCount; offset += concurrency) {
    const wave = queries.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      wave.map((query, index) => searchWithFallback(query, providers, (offset + index) % providers.length)),
    );
    queriesRun += wave.length;

    const raw = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const candidates = rawToCandidates(raw, category);
    const handles = [...new Set(candidates.map((candidate) => candidate.handle).filter((handle) => !fresh.has(handle) && !knownExisting.has(handle)))];

    const existing = await findExistingHandles(handles);
    existing.forEach((handle) => knownExisting.add(handle));
    skippedDuplicates += existing.size;

    for (const candidate of candidates) {
      if (knownExisting.has(candidate.handle) || fresh.has(candidate.handle)) continue;
      fresh.set(candidate.handle, candidate);
    }
  }

  const candidates = [...fresh.values()].slice(0, targetCount);
  await saveCandidates(candidates);

  if (!isSupabaseConfigured()) warnings.push("Supabase가 설정되지 않아 실행 간 중복 기록은 저장되지 않습니다.");
  if (candidates.length < targetCount) warnings.push(`검색 풀에서 ${candidates.length}명만 확보했습니다. 다음 단계에서 검색어 확장 로직을 추가해야 합니다.`);

  return {
    category,
    targetCount,
    candidates,
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
      return await provider.search(query, 12);
    } catch (error) {
      lastError = error;
    }
  }
  console.warn("search_query_failed", { query, error: lastError });
  return [];
}

function rawToCandidates(results: RawSearchResult[], category: SearchCategory) {
  const now = new Date().toISOString();
  return results.flatMap((result): DiscoveryCandidate[] => {
    const combined = `${result.title}\n${result.text}`;
    const handle = extractInstagramHandle(result.url, combined);
    if (!handle) return [];

    const evidenceText = cleanText(result.text || result.title).slice(0, 320);
    const flags = category === "food"
      ? FOOD_REVIEW_SIGNALS.filter((signal) => combined.toLowerCase().includes(signal.toLowerCase())).map((signal) => `제외검토:${signal}`)
      : [];

    return [{
      handle,
      profileUrl: profileUrl(handle),
      category,
      sourceProvider: result.provider,
      evidenceUrl: result.url,
      evidenceText,
      flags,
      followers: null,
      reelAverage: null,
      reelMedian: null,
      reelSampleSize: null,
      verificationStatus: "needs_instagram",
      discoveredAt: now,
    }];
  });
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
