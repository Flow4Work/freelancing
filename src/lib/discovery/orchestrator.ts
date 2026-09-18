import { hasStrongSmallCreatorEvidence, hasStrongKoreaAccess } from "./quality";
import { checkAccountAvailabilities } from "./account-availability";
import { MAX_TARGET_FOLLOWERS_EXCLUSIVE, MIN_TARGET_FOLLOWERS } from "@/lib/verification/policy";
import { FOOD_REVIEW_SIGNALS, getCreatorNeighborSeedQueries, getGoogleQueryFamilyPlan, getGoogleSeedQueryPlan, getStandardQueryFamilyPlan, type GoogleQueryFamily, type StandardQueryFamily } from "./query-plan";
import { getRecommendationAssessment } from "./recommendation";
import { extractExaInstagramCandidate, extractInstagramCandidate, getInstagramExtractionFailureReason, profileUrl, type InstagramCandidateExtraction } from "./instagram";
import { assessDiscoveryCandidate, getDiscoveryPreRejectReason, getTavilyObviousBusinessProfileReason, hasExaJapanTargetEvidence } from "./discovery-quality";
import { getConfiguredGoogleProviders, getConfiguredProviders } from "./providers";
import type {
  CandidateStatus,
  DiscoveryCandidate,
  DiscoveryFilterDiagnostics,
  DiscoveryDropReason,
  DiscoveryResponse,
  DiscoverySource,
  GoogleSearchProviderName,
  RawSearchResult,
  SearchCategory,
  SearchProvider,
  SearchProviderName,
} from "./types";
import { findContactedHandles, findExistingHandles, listCandidates, listKnownCandidateHandles, saveCandidates } from "@/lib/supabase/candidates";
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
type GroupedEvidence = { grouped: Map<string, ExtractedEvidence[]>; filteredNoise: number; filterDiagnostics: DiscoveryFilterDiagnostics };
type SearchOutcome = { results: RawSearchResult[]; failureCount: number };
type StandardProviderName = "exa" | "tavily";
type StandardProviderQueries = Record<StandardProviderName, string>;
type GoogleRunSearchOutcome = SearchOutcome & {
  successCount: number;
  queriesRun: number;
  newHandleCount: number;
  additionalLaneCount: number;
  laneDiagnostics: GoogleLaneDiagnostic[];
};
type ProfileEnrichmentOutcome = { grouped: Map<string, ExtractedEvidence[]>; enrichedCount: number; failureCount: number; lookupCount: number; skippedCount: number; unresolvedCount: number };
type ProcessInput = {
  source: DiscoverySource;
  category: SearchCategory;
  targetCount: number;
  runNo: number;
  rawResults: RawSearchResult[];
  queriesRun: number;
  providerFailureCount: number;
  providersUsed: SearchProviderName[];
  additionalLaneCount?: number;
  laneDiagnostics?: GoogleLaneDiagnostic[];
  startedAtMs: number;
};

export async function discoverCreators({ category, targetCount }: DiscoverInput): Promise<DiscoveryResponse> {
  const startedAtMs = Date.now();
  const providers = getConfiguredProviders();
  if (!providers.length) throw new NoSearchProvidersError();

  const runNo = await beginDiscoveryRun(category);
  const knownHandles = await listKnownCandidateHandles(category);
  const queryFamilies = getStandardQueryFamilyPlan(category, runNo);
  const concurrency = clamp(Number(process.env.DISCOVERY_CONCURRENCY ?? 4), 1, 8);
  const rawResults: RawSearchResult[] = [];
  const seenHandles = new Set<string>();
  const followUps: Array<{ slot: StandardQuerySlot; priority: number }> = [];
  let queriesRun = 0;
  let providerFailureCount = 0;
  let slotIndex = 0;

  for (const family of queryFamilies) {
    const slots = buildStandardFamilySlots(family, slotIndex);
    slotIndex += slots.length;
    const probeSlots = slots.slice(0, 1);
    const probe = await runStandardQuerySlots(probeSlots, providers, concurrency);
    rawResults.push(...probe.results);
    queriesRun += probeSlots.length;
    providerFailureCount += probe.failureCount;

    const quality = evaluateQueryFamily(probe.results, category, seenHandles, 1, knownHandles);
    const contacted = await findContactedHandles(quality.handles);
    logStandardLaneDiagnostic(family.name, probeSlots[0], probe.results.length, quality, contacted);
    if (!quality.lowQuality) {
      for (const [offset, slot] of slots.slice(1).entries()) {
        followUps.push({
          slot,
          priority: getStandardFollowUpPriority(quality, offset),
        });
      }
    }
  }

  followUps.sort((a, b) => b.priority - a.priority);
  for (const { slot } of followUps) {
    if (queriesRun >= STANDARD_QUERY_BUDGET) break;
    const followUp = await runStandardQuerySlots([slot], providers, concurrency);
    rawResults.push(...followUp.results);
    queriesRun += 1;
    providerFailureCount += followUp.failureCount;
    const quality = evaluateQueryFamily(followUp.results, category, seenHandles, 1, knownHandles);
    const contacted = await findContactedHandles(quality.handles);
    logStandardLaneDiagnostic(slot.family, slot, followUp.results.length, quality, contacted);
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
    startedAtMs,
  });
}

export async function discoverGoogleCreators({ category, targetCount }: DiscoverInput): Promise<DiscoveryResponse> {
  const startedAtMs = Date.now();
  const providers = getConfiguredGoogleProviders();
  if (!providers.length) throw new NoGoogleSearchProvidersError();

  const runNo = await beginDiscoveryRun(category);
  const [knownHandles, storedCandidates] = await Promise.all([
    listKnownCandidateHandles(category),
    listCandidates(category),
  ]);
  const seedHandles = storedCandidates
    .filter((candidate) =>
      (candidate.candidateStatus === "qualified" || candidate.candidateStatus === "search_qualified")
      && candidate.accountType === "creator"
      && hasStrongKoreaAccess(candidate.evidenceText)
    )
    .sort((a, b) =>
      Number(b.verificationStatus === "verified") - Number(a.verificationStatus === "verified")
      || getRecommendationAssessment(b).recommendationScore - getRecommendationAssessment(a).recommendationScore
    )
    .map((candidate) => candidate.handle);
  const seedStart = seedHandles.length ? (runNo - 1) % seedHandles.length : 0;
  const rotatedSeeds = [...seedHandles.slice(seedStart), ...seedHandles.slice(0, seedStart)].slice(0, 2);
  const outcome = await searchGoogleProviders(providers, category, runNo, targetCount, knownHandles, rotatedSeeds);

  if (outcome.successCount === 0) throw new GoogleSearchFailedError();

  return processDiscoveryResults({
    source: "google",
    category,
    targetCount,
    runNo,
    rawResults: outcome.results,
    queriesRun: outcome.queriesRun,
    providerFailureCount: outcome.failureCount,
    providersUsed: providers.map((provider) => provider.name),
    additionalLaneCount: outcome.additionalLaneCount,
    laneDiagnostics: outcome.laneDiagnostics,
    startedAtMs,
  });
}
async function processDiscoveryResults(input: ProcessInput): Promise<DiscoveryResponse> {
  const warnings: string[] = [];
  const preparedResults = input.source === "google" ? dedupeRawResultsByUrl(input.rawResults) : input.rawResults;
  const groupedBatch = groupRawEvidence(preparedResults);
  const groupedHandles = [...groupedBatch.grouped.keys()];
  const [existingCandidates, contactedHandles] = await Promise.all([
    findExistingHandles(groupedHandles),
    findContactedHandles(groupedHandles),
  ]);
  const existing = new Set([...existingCandidates, ...contactedHandles]);
  const filterDiagnostics = createFilterDiagnostics();
  mergeFilterDiagnostics(filterDiagnostics, groupedBatch.filterDiagnostics);
  const contactedCandidateCount = groupedHandles.filter((handle) => contactedHandles.has(handle)).length;
  const existingCandidateCount = groupedHandles.filter((handle) => existingCandidates.has(handle) && !contactedHandles.has(handle)).length;
  addFilterDiagnostic(filterDiagnostics, "contacted_candidate", contactedCandidateCount);
  addFilterDiagnostic(filterDiagnostics, "existing_candidate", existingCandidateCount);
  const manualExcludedCount = await countManualExcludedHandles(input.category, [...existingCandidates]);
  const freshGrouped = new Map(
    [...groupedBatch.grouped.entries()].filter(([handle]) => !existing.has(handle)),
  );

  // DB에 한 번이라도 저장된 handle은 여기까지 오지 않는다.
  // 신규 handle만 기존 account availability/품질 판정과 동일 저장 로직을 탄다.
  const profileEnrichment = await enrichContentOnlyProfiles(freshGrouped, input.source);
  const assessed = await groupedToCandidates(profileEnrichment.grouped, input.category, input.source);
  const candidates = assessed.candidates;
  const rejected = candidates.filter((candidate) => candidate.candidateStatus === "hard_reject");
  const viable = candidates.filter((candidate) => candidate.candidateStatus !== "hard_reject");
  const totalProviderFailureCount = input.providerFailureCount + profileEnrichment.failureCount + assessed.categoryEnrichmentFailureCount;
  mergeFilterDiagnostics(filterDiagnostics, assessed.filterDiagnostics);
  addFilterDiagnostic(filterDiagnostics, "profile_enrichment_failed", profileEnrichment.unresolvedCount);
  addFilterDiagnostic(filterDiagnostics, "provider_failure", totalProviderFailureCount);

  await saveCandidates(candidates);
  if (input.laneDiagnostics?.length) logGoogleLaneDiagnostics(input.laneDiagnostics, candidates);

  const recommendationByHandle = new Map(candidates.map((candidate) => [candidate.handle, getRecommendationAssessment(candidate)]));
  for (const candidate of candidates) {
    console.info(`discovery_recommendation ${JSON.stringify({ source: input.source, runNo: input.runNo, handle: candidate.handle, ...recommendationByHandle.get(candidate.handle) })}`);
  }
  const ranked = viable.sort(compareCandidates);
  const selected = ranked.slice(0, input.targetCount);
  const qualifiedCount = selected.filter((candidate) => {
    const tier = getRecommendationAssessment(candidate).tier;
    return tier === "priority" || tier === "recommended";
  }).length;
  const reviewCount = selected.filter((candidate) => getRecommendationAssessment(candidate).tier === "review").length;
  const recommendedCount = candidates.filter((candidate) => {
    const tier = recommendationByHandle.get(candidate.handle)?.tier;
    return tier === "priority" || tier === "recommended";
  }).length;
  const priorityContactCount = candidates.filter((candidate) => recommendationByHandle.get(candidate.handle)?.tier === "priority").length;
  const needsReviewCount = candidates.filter((candidate) => recommendationByHandle.get(candidate.handle)?.tier === "review").length;
  const filteredNoise = groupedBatch.filteredNoise + assessed.filteredNoise + rejected.length;
  const sameRunRepeatCount = [...groupedBatch.grouped.values()].reduce((sum, evidence) => sum + Math.max(0, evidence.length - 1), 0);
  const executionMs = Date.now() - input.startedAtMs;
  console.info(`discovery_enrichment_budget ${JSON.stringify({
    source: input.source,
    profileLookups: profileEnrichment.lookupCount,
    profileLookupSkipped: profileEnrichment.skippedCount,
    categoryEnrichmentAttempted: assessed.categoryEnrichmentAttempted,
    categoryEnrichmentPromoted: assessed.categoryEnrichmentPromoted,
    availabilityChecks: assessed.availabilityCheckCount,
    executionMs,
  })}`);
  console.info(`discovery_filter_diagnostics ${JSON.stringify({ source: input.source, runNo: input.runNo, ...filterDiagnostics })}`);

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
    otherFilteredCount: groupedBatch.filteredNoise + assessed.filteredNoise,
    newSavedCount: candidates.length,
    evidenceEnrichedCount: profileEnrichment.enrichedCount,
    finalAddedCount: selected.length,
    providerFailureCount: totalProviderFailureCount,
  });

  if (!isSupabaseConfigured()) warnings.push("Supabase가 설정되지 않아 실행 간 DB 기존 후보 제외가 적용되지 않습니다.");
  if (selected.length < input.targetCount) warnings.push(`이번 검색에서는 신규 후보 ${selected.length}명만 확보했습니다. 다음 검색 lane에서 이어서 찾습니다.`);
  if (reviewCount > 0) warnings.push(`${reviewCount}명은 계정 존재 또는 핵심 판단 근거를 추가 확인해야 합니다.`);
  if (totalProviderFailureCount > 0) warnings.push(`검색 provider 호출 ${totalProviderFailureCount}회가 실패했지만 성공한 provider 결과는 정상 처리했습니다.`);

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
    rawUrlCount: new Set(preparedResults.map((result) => normalizeResultUrl(result.url))).size,
    extractedResultCount: preparedResults.length - groupedBatch.filteredNoise,
    instagramHandleCount: groupedBatch.grouped.size,
    existingExcludedCount: existing.size,
    newCandidateCount: freshGrouped.size,
    newSavedCount: candidates.length,
    additionalLaneCount: input.additionalLaneCount ?? 0,
    recommendedCount,
    priorityContactCount,
    needsReviewCount,
    excludedCount: rejected.length + assessed.filteredNoise,
    enrichmentLookupCount: profileEnrichment.lookupCount,
    enrichmentSkippedCount: profileEnrichment.skippedCount,
    availabilityCheckCount: assessed.availabilityCheckCount,
    executionMs,
    sameRunRepeatCount,
    providerFailureCount: totalProviderFailureCount,
    filterDiagnostics,
  };
}

const DISCOVERY_DROP_REASONS: DiscoveryDropReason[] = [
  "unsupported_instagram_url",
  "owner_unresolved",
  "invalid_handle",
  "reserved_path",
  "existing_candidate",
  "contacted_candidate",
  "obvious_business",
  "non_japan_target",
  "insufficient_korea_affinity",
  "category_mismatch",
  "exa_japan_gate",
  "profile_enrichment_failed",
  "account_unavailable",
  "follower_under_min",
  "provider_failure",
  "other_filtered",
];

function createFilterDiagnostics(): DiscoveryFilterDiagnostics {
  return Object.fromEntries(DISCOVERY_DROP_REASONS.map((reason) => [reason, 0])) as DiscoveryFilterDiagnostics;
}

function addFilterDiagnostic(diagnostics: DiscoveryFilterDiagnostics, reason: DiscoveryDropReason, count = 1) {
  diagnostics[reason] += Math.max(0, count);
}

function mergeFilterDiagnostics(target: DiscoveryFilterDiagnostics, source: Partial<DiscoveryFilterDiagnostics>) {
  for (const reason of DISCOVERY_DROP_REASONS) target[reason] += source[reason] ?? 0;
}

const STANDARD_QUERY_BUDGET = 12;
const GOOGLE_PROVIDER_QUERY_BUDGET = 10;
const GOOGLE_TOTAL_QUERY_BUDGET = 20;
const GOOGLE_INITIAL_PROBE_BUDGET = 12;
const GOOGLE_SEED_QUERY_BUDGET = 2;
const GOOGLE_MAX_DEPTH = 2;
const GOOGLE_PROFILE_ENRICHMENT_BUDGET = 12;
const GOOGLE_AVAILABILITY_CHECK_BUDGET = 18;
const CATEGORY_EVIDENCE_ENRICHMENT_BUDGET = 4;

type StandardQuerySlot = {
  index: number;
  family: string;
  queries: StandardProviderQueries;
};

function buildStandardFamilySlots(family: StandardQueryFamily, startIndex: number): StandardQuerySlot[] {
  const count = Math.max(family.exa.length, family.tavily.length);
  if (!count) return [];
  return Array.from({ length: count }, (_, offset) => ({
    index: startIndex + offset,
    family: family.name,
    queries: {
      exa: family.exa[offset % family.exa.length],
      tavily: family.tavily[offset % family.tavily.length],
    },
  }));
}

async function runStandardQuerySlots(
  slots: StandardQuerySlot[],
  providers: SearchProvider[],
  concurrency: number,
): Promise<SearchOutcome> {
  const results: RawSearchResult[] = [];
  let failureCount = 0;

  for (let offset = 0; offset < slots.length; offset += concurrency) {
    const wave = slots.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      wave.map((slot) => searchWithFallback(slot.queries, providers, slot.index % providers.length)),
    );
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") continue;
      results.push(...outcome.value.results);
      failureCount += outcome.value.failureCount;
    }
  }

  return { results, failureCount };
}

export function evaluateQueryFamily(
  results: RawSearchResult[],
  category: SearchCategory,
  seenHandles: Set<string>,
  minNewHandles: number,
  knownHandles?: ReadonlySet<string>,
) {
  let profileUrlCount = 0;
  let contentUrlCount = 0;
  let resolvedContentOwnerCount = 0;
  for (const result of results) {
    const extraction = result.provider === "exa"
      ? extractExaInstagramCandidate(result.url, result.title, result.text)
      : extractInstagramCandidate(result.url, result.title, result.text);
    if (extraction?.evidenceKind === "profile") profileUrlCount += 1;
    if (extraction?.evidenceKind === "content") {
      contentUrlCount += 1;
      resolvedContentOwnerCount += 1;
    } else if (!extraction && getInstagramExtractionFailureReason(result.url, result.title, result.text) === "owner_unresolved") {
      contentUrlCount += 1;
    }
  }
  const grouped = groupRawEvidence(results);
  const handles = [...grouped.grouped.keys()];
  const existingHandles = handles.filter((handle) => knownHandles?.has(handle));
  const runRepeatHandles = handles.filter((handle) => !knownHandles?.has(handle) && seenHandles.has(handle));
  const newHandles = handles.filter((handle) => !knownHandles?.has(handle) && !seenHandles.has(handle));
  const newHandleSet = new Set(newHandles);
  for (const handle of handles) seenHandles.add(handle);

  let obviousNoiseHandles = 0;
  let followerUnderMinCount = 0;
  let japanGateRejectCount = 0;
  let categoryMismatchCount = 0;
  let profileHandleCount = 0;
  let contentOnlyHandleCount = 0;
  let viableNewHandleCount = 0;

  for (const [handle, evidence] of grouped.grouped) {
    const profileEvidence = evidence.filter((item) => item.extraction.evidenceKind === "profile");
    const evidenceKind: InstagramCandidateExtraction["evidenceKind"] = profileEvidence.length ? "profile" : "content";
    if (profileEvidence.length) profileHandleCount += 1;
    else contentOnlyHandleCount += 1;

    const profileText = joinEvidence(profileEvidence.map((item) => `${item.result.title}\n${item.result.text}`), 1200);
    const combinedText = joinEvidence(evidence.map((item) => `${item.result.title}\n${item.result.text}`), 1600);
    const primary = profileEvidence[0] ?? evidence[0];
    let followers = extractFollowerReference(profileEvidence.length ? profileEvidence : evidence);
    const underMin = getDiscoveryFollowerRejection(category, followers) === "under_min";
    if (underMin) followerUnderMinCount += 1;

    const assessmentInput = {
      handle,
      evidenceKind,
      title: "",
      text: combinedText,
      profileText,
      category,
      accountAvailability: "unknown" as const,
    };
    const preRejectReason = getDiscoveryPreRejectReason(assessmentInput);
    if (preRejectReason === "obvious_business") obviousNoiseHandles += 1;
    if (preRejectReason === "category_mismatch") categoryMismatchCount += 1;

    if (
      primary.result.provider === "tavily"
      && getTavilyObviousBusinessProfileReason(profileText, combinedText, category, evidenceKind)
    ) {
      if (preRejectReason !== "obvious_business") obviousNoiseHandles += 1;
      continue;
    }

    const assessment = preRejectReason ? null : assessDiscoveryCandidate(assessmentInput);
    if (!assessment) continue;
    if (assessment.contentFit !== category) categoryMismatchCount += 1;

    const japanRejected = primary.result.provider === "exa"
      && !hasExaJapanTargetEvidence(assessment.targetSignals, combinedText);
    if (japanRejected) japanGateRejectCount += 1;

    if (
      newHandleSet.has(handle)
      && (!underMin || hasStrongSmallCreatorEvidence(assessment, combinedText))
      && !japanRejected
      && assessment.accountType !== "business"
    ) {
      viableNewHandleCount += 1;
    }
  }

  const extractedCount = results.length - grouped.filteredNoise;
  const extractionRate = results.length ? extractedCount / results.length : 0;
  const obviousNoiseRate = grouped.grouped.size ? obviousNoiseHandles / grouped.grouped.size : 1;
  const lowQuality =
    viableNewHandleCount < minNewHandles
    || extractionRate < 0.2
    || (grouped.grouped.size >= 4 && obviousNoiseRate > 0.6);

  const ownerUnresolvedCount = grouped.filterDiagnostics.owner_unresolved;
  return {
    lowQuality,
    handles,
    rawCount: results.length,
    handleCount: grouped.grouped.size,
    newHandleCount: newHandles.length,
    viableNewHandleCount,
    existingHandleCount: existingHandles.length,
    runRepeatCount: runRepeatHandles.length,
    extractionRate,
    obviousNoiseRate,
    profileHandleCount,
    contentOnlyHandleCount,
    profileUrlCount,
    contentUrlCount,
    resolvedContentOwnerCount,
    ownerUnresolvedCount,
    profileRate: results.length ? profileUrlCount / results.length : 0,
    ownerUnresolvedRate: results.length ? ownerUnresolvedCount / results.length : 0,
    businessRejectCount: obviousNoiseHandles,
    followerUnderMinCount,
    japanGateRejectCount,
    categoryMismatchCount,
  };
}

export function getStandardFollowUpPriority(
  quality: ReturnType<typeof evaluateQueryFamily>,
  offset = 0,
) {
  return quality.viableNewHandleCount * 30
    + quality.newHandleCount * 20
    + quality.handleCount * 2
    + Math.round(quality.extractionRate * 10)
    - quality.existingHandleCount * 3
    - quality.runRepeatCount * 2
    - offset;
}

export function shouldFollowUpGoogleLane(quality: ReturnType<typeof evaluateQueryFamily>) {
  const repeats = quality.existingHandleCount + quality.runRepeatCount;
  return quality.handleCount > 0 && quality.viableNewHandleCount > 0
    && repeats / quality.handleCount < 0.75
    && quality.ownerUnresolvedRate < 0.6;
}

export function getGoogleFollowUpPriority(
  quality: ReturnType<typeof evaluateQueryFamily>,
  offset = 0,
) {
  return quality.viableNewHandleCount * 120
    + quality.newHandleCount * 80
    + quality.profileHandleCount * 12
    + quality.resolvedContentOwnerCount * 4
    + Math.min(quality.rawCount, 10)
    - quality.ownerUnresolvedCount * 10
    - quality.existingHandleCount * 24
    - quality.runRepeatCount * 20
    - offset;
}

function logStandardLaneDiagnostic(
  family: string,
  slot: StandardQuerySlot,
  rawCount: number,
  quality: ReturnType<typeof evaluateQueryFamily>,
  contactedHandles: ReadonlySet<string>,
) {
  const contacted = quality.handles.filter((handle) => contactedHandles.has(handle)).length;
  console.info(`standard_discovery_lane ${JSON.stringify({
    family,
    slot: slot.index,
    raw: rawCount,
    handles: quality.handleCount,
    existing: Math.max(0, quality.existingHandleCount - contacted),
    contacted,
    sameRunRepeat: quality.runRepeatCount,
    genuineNew: quality.newHandleCount,
    viableNew: quality.viableNewHandleCount,
    profileHandles: quality.profileHandleCount,
    contentOnlyHandles: quality.contentOnlyHandleCount,
    ownerUnresolved: quality.ownerUnresolvedCount,
    businessReject: quality.businessRejectCount,
    followerUnderMin: quality.followerUnderMinCount,
    japanGateReject: quality.japanGateRejectCount,
    categoryMismatch: quality.categoryMismatchCount,
  })}`);
}

async function searchWithFallback(queries: StandardProviderQueries, providers: SearchProvider[], startIndex: number): Promise<SearchOutcome> {
  let lastError: unknown;
  let failureCount = 0;
  for (let attempt = 0; attempt < providers.length; attempt += 1) {
    const provider = providers[(startIndex + attempt) % providers.length];
    const query = queries[provider.name as StandardProviderName];
    try {
      return { results: (await provider.search(query, 18)).map((result) => ({ ...result, query })), failureCount };
    } catch (error) {
      lastError = error;
      failureCount += 1;
    }
  }
  console.warn("search_query_failed", { queries, error: lastError });
  return { results: [], failureCount };
}

type GoogleQueryLane = {
  provider: SearchProvider;
  family: string;
  query: string;
  queryIndex: number;
  depth: number;
  seed: boolean;
};

type GoogleLaneDiagnostic = {
  provider: SearchProviderName;
  family: string;
  query: string;
  depth: number;
  rawCount: number;
  handleCount: number;
  newHandleCount: number;
  viableNewHandleCount: number;
  existingHandleCount: number;
  runRepeatCount: number;
  extractionRate: number;
  profileHandleCount: number;
  contentOnlyHandleCount: number;
  profileUrlCount: number;
  contentUrlCount: number;
  resolvedContentOwnerCount: number;
  ownerUnresolvedCount: number;
  profileRate: number;
  ownerUnresolvedRate: number;
  businessRejectCount: number;
  followerUnderMinCount: number;
  japanGateRejectCount: number;
  categoryMismatchCount: number;
};

function buildGoogleQueryLanes(
  providers: SearchProvider[],
  category: SearchCategory,
  runNo: number,
): GoogleQueryLane[] {
  const validProviders = providers.filter(
    (provider) => provider.name === "serper" || provider.name === "serpapi",
  );
  const plans = validProviders.map((provider) => ({
    provider,
    families: getGoogleQueryFamilyPlan(category, runNo, provider.name as GoogleSearchProviderName),
  }));
  const maxFamilyCount = Math.max(0, ...plans.map((plan) => plan.families.length));
  const maxQueryCount = Math.max(
    0,
    ...plans.flatMap((plan) => plan.families.map((family) => family.queries.length)),
  );
  const lanes: GoogleQueryLane[] = [];

  // First probe distinct families, then let observed yield decide where the remaining budget goes.
  for (let queryIndex = 0; queryIndex < maxQueryCount; queryIndex += 1) {
    for (let familyIndex = 0; familyIndex < maxFamilyCount; familyIndex += 1) {
      for (const plan of plans) {
        const family = plan.families[familyIndex];
        const query = family?.queries[queryIndex];
        if (!query) continue;
        lanes.push({ provider: plan.provider, family: family.name, query, queryIndex, depth: 0, seed: false });
      }
    }
  }

  return lanes;
}

function buildGoogleSeedLanes(
  providers: SearchProvider[],
  category: SearchCategory,
  runNo: number,
  seedHandles: string[],
): GoogleQueryLane[] {
  if (!providers.length) return [];
  const creatorSeeds = getCreatorNeighborSeedQueries(category, seedHandles);
  const brandSeeds = getGoogleSeedQueryPlan(category, runNo);
  const seeds = creatorSeeds.length
    ? [creatorSeeds[0], brandSeeds[0]].filter((seed): seed is NonNullable<typeof seed> => Boolean(seed))
    : brandSeeds.slice(0, GOOGLE_SEED_QUERY_BUDGET);
  return seeds.slice(0, GOOGLE_SEED_QUERY_BUDGET).map((seed, index) => ({
    provider: providers[(runNo + index) % providers.length],
    family: `seed:${seed.name}`,
    query: seed.query,
    queryIndex: 0,
    depth: 0,
    seed: true,
  }));
}

async function searchGoogleProviders(
  providers: SearchProvider[],
  category: SearchCategory,
  runNo: number,
  targetCount: number,
  knownHandles: ReadonlySet<string>,
  seedHandles: string[],
): Promise<GoogleRunSearchOutcome> {
  const validProviders = providers.filter(
    (provider) => provider.name === "serper" || provider.name === "serpapi",
  );
  const lanes = buildGoogleQueryLanes(validProviders, category, runNo);
  const probes = lanes.filter((lane) => lane.queryIndex === 0);
  const alternates = lanes.filter((lane) => lane.queryIndex > 0);
  const seedLanes = buildGoogleSeedLanes(validProviders, category, runNo, seedHandles);
  const results: RawSearchResult[] = [];
  const diagnostics: GoogleLaneDiagnostic[] = [];
  const runSeenHandles = new Set<string>();
  const usedLaneKeys = new Set<string>();
  const providerQueryCounts = new Map<SearchProviderName, number>();
  const disabledProviders = new Set<SearchProviderName>();
  const followUps: Array<{ lane: GoogleQueryLane; priority: number }> = [];
  let failureCount = 0;
  let successCount = 0;
  let queriesRun = 0;
  let newHandleCount = 0;

  const enqueue = (lane: GoogleQueryLane, priority: number) => {
    const key = googleLaneKey(lane);
    if (usedLaneKeys.has(key) || followUps.some((item) => googleLaneKey(item.lane) === key)) return;
    followUps.push({ lane, priority });
  };

  const record = (lane: GoogleQueryLane, found: RawSearchResult[]) => {
    results.push(...found.map((result) => ({ ...result, query: lane.query })));
    const quality = evaluateQueryFamily(found, category, runSeenHandles, 1, knownHandles);
    newHandleCount += quality.viableNewHandleCount;
    diagnostics.push({
      provider: lane.provider.name,
      family: lane.family,
      query: lane.query,
      depth: lane.depth,
      rawCount: found.length,
      handleCount: quality.handleCount,
      newHandleCount: quality.newHandleCount,
      viableNewHandleCount: quality.viableNewHandleCount,
      existingHandleCount: quality.existingHandleCount,
      runRepeatCount: quality.runRepeatCount,
      extractionRate: quality.extractionRate,
      profileHandleCount: quality.profileHandleCount,
      contentOnlyHandleCount: quality.contentOnlyHandleCount,
      profileUrlCount: quality.profileUrlCount,
      contentUrlCount: quality.contentUrlCount,
      resolvedContentOwnerCount: quality.resolvedContentOwnerCount,
      ownerUnresolvedCount: quality.ownerUnresolvedCount,
      profileRate: quality.profileRate,
      ownerUnresolvedRate: quality.ownerUnresolvedRate,
      businessRejectCount: quality.businessRejectCount,
      followerUnderMinCount: quality.followerUnderMinCount,
      japanGateRejectCount: quality.japanGateRejectCount,
      categoryMismatchCount: quality.categoryMismatchCount,
    });
    console.info(`google_discovery_lane ${JSON.stringify(diagnostics[diagnostics.length - 1])}`);

    if (lane.seed || !shouldFollowUpGoogleLane(quality)) return;
    if (lane.depth < GOOGLE_MAX_DEPTH) {
      enqueue({ ...lane, depth: lane.depth + 1 }, 20 + getGoogleFollowUpPriority(quality, lane.depth * 5));
    }
    if (lane.queryIndex === 0 && quality.viableNewHandleCount > 0) {
      const alternate = alternates.find((candidate) =>
        candidate.provider.name === lane.provider.name && candidate.family === lane.family,
      );
      if (alternate) enqueue(alternate, 80 + getGoogleFollowUpPriority(quality));
    }
  };

  const executeWave = async (wave: GoogleQueryLane[]) => {
    if (!wave.length) return;
    for (const lane of wave) usedLaneKeys.add(googleLaneKey(lane));
    const settled = await Promise.all(wave.map(async (lane) => {
      try {
        const found = await lane.provider.search(lane.query, 10, { depth: lane.depth });
        return { lane, found, error: null as unknown };
      } catch (error) {
        return { lane, found: [] as RawSearchResult[], error };
      }
    }));

    for (const item of settled) {
      queriesRun += 1;
      providerQueryCounts.set(item.lane.provider.name, (providerQueryCounts.get(item.lane.provider.name) ?? 0) + 1);
      if (item.error) {
        failureCount += 1;
        const errorMessage = item.error instanceof Error ? item.error.message : String(item.error);
        if (/\b(?:401|403|429)\b/.test(errorMessage)) disabledProviders.add(item.lane.provider.name);
        console.warn(`google_search_query_failed ${JSON.stringify({
          provider: item.lane.provider.name,
          query: item.lane.query,
          family: item.lane.family,
          depth: item.lane.depth,
          error: errorMessage,
          providerDisabled: disabledProviders.has(item.lane.provider.name),
        })}`);
        continue;
      }
      successCount += 1;
      record(item.lane, item.found);
    }
  };

  let probeCursor = 0;
  while (
    probeCursor < probes.length
    && queriesRun < Math.min(GOOGLE_INITIAL_PROBE_BUDGET, GOOGLE_TOTAL_QUERY_BUDGET)
    && newHandleCount < targetCount
  ) {
    const wave = takeGoogleWave(probes, probeCursor, validProviders, providerQueryCounts, usedLaneKeys, disabledProviders, queriesRun, GOOGLE_INITIAL_PROBE_BUDGET);
    probeCursor = wave.nextCursor;
    for (const deferred of wave.deferred) enqueue(deferred, 35);
    await executeWave(wave.lanes);
    if (!wave.lanes.length) break;
  }

  // B is intentionally capped: two controlled seed calls max, no seed-derived crawl expansion.
  for (const seedLane of seedLanes) {
    if (queriesRun >= GOOGLE_TOTAL_QUERY_BUDGET || newHandleCount >= targetCount) break;
    if (disabledProviders.has(seedLane.provider.name) || (providerQueryCounts.get(seedLane.provider.name) ?? 0) >= GOOGLE_PROVIDER_QUERY_BUDGET) continue;
    await executeWave([seedLane]);
  }

  // Untested families remain available, but proven high-yield/depth lanes outrank them.
  for (let index = probeCursor; index < probes.length; index += 1) enqueue(probes[index], 35);

  while (followUps.length && queriesRun < GOOGLE_TOTAL_QUERY_BUDGET && newHandleCount < targetCount) {
    followUps.sort((a, b) => b.priority - a.priority);
    const wave: GoogleQueryLane[] = [];
    const waveProviders = new Set<SearchProviderName>();
    for (let index = 0; index < followUps.length && wave.length < Math.max(1, validProviders.length);) {
      const item = followUps[index];
      const providerCount = providerQueryCounts.get(item.lane.provider.name) ?? 0;
      if (
        providerCount >= GOOGLE_PROVIDER_QUERY_BUDGET
        || disabledProviders.has(item.lane.provider.name)
        || usedLaneKeys.has(googleLaneKey(item.lane))
        || waveProviders.has(item.lane.provider.name)
      ) {
        index += 1;
        continue;
      }
      followUps.splice(index, 1);
      wave.push(item.lane);
      waveProviders.add(item.lane.provider.name);
    }
    if (!wave.length) break;
    await executeWave(wave);
  }

  const initialLaneCount = Math.min(validProviders.length, queriesRun);
  return {
    results,
    failureCount,
    successCount,
    queriesRun,
    newHandleCount,
    additionalLaneCount: Math.max(0, queriesRun - initialLaneCount),
    laneDiagnostics: diagnostics,
  };
}

export function takeGoogleWave(
  lanes: GoogleQueryLane[],
  startCursor: number,
  providers: SearchProvider[],
  providerQueryCounts: Map<SearchProviderName, number>,
  usedLaneKeys: Set<string>,
  disabledProviders: Set<SearchProviderName>,
  queriesRun: number,
  budget: number,
) {
  const selected: GoogleQueryLane[] = [];
  const deferred: GoogleQueryLane[] = [];
  const waveProviders = new Set<SearchProviderName>();
  let cursor = startCursor;
  while (cursor < lanes.length && selected.length < Math.max(1, providers.length) && queriesRun + selected.length < budget) {
    const lane = lanes[cursor];
    cursor += 1;
    if (usedLaneKeys.has(googleLaneKey(lane))) continue;
    if ((providerQueryCounts.get(lane.provider.name) ?? 0) >= GOOGLE_PROVIDER_QUERY_BUDGET) continue;
    if (disabledProviders.has(lane.provider.name)) continue;
    if (waveProviders.has(lane.provider.name)) {
      deferred.push(lane);
      continue;
    }
    selected.push(lane);
    waveProviders.add(lane.provider.name);
  }
  return { lanes: selected, deferred, nextCursor: cursor };
}

export function googleLaneKey(lane: GoogleQueryLane) {
  return `${lane.provider.name}\u0000${lane.query}\u0000${lane.depth}`;
}

function logGoogleLaneDiagnostics(diagnostics: GoogleLaneDiagnostic[], candidates: DiscoveryCandidate[]) {
  const queryFamily = new Map<string, string>();
  const families = new Map<string, {
    raw: number;
    handles: number;
    newHandles: number;
    existing: number;
    runRepeats: number;
    profileUrlCount: number;
    contentUrlCount: number;
    resolvedContentOwnerCount: number;
    ownerUnresolvedCount: number;
    saved: number;
    recommended: number;
    needsReview: number;
  }>();

  for (const item of diagnostics) {
    queryFamily.set(item.query, item.family);
    const summary = families.get(item.family) ?? {
      raw: 0, handles: 0, newHandles: 0, existing: 0, runRepeats: 0,
      profileUrlCount: 0, contentUrlCount: 0, resolvedContentOwnerCount: 0, ownerUnresolvedCount: 0,
      saved: 0, recommended: 0, needsReview: 0,
    };
    summary.raw += item.rawCount;
    summary.handles += item.handleCount;
    summary.newHandles += item.newHandleCount;
    summary.existing += item.existingHandleCount;
    summary.runRepeats += item.runRepeatCount;
    summary.profileUrlCount += item.profileUrlCount;
    summary.contentUrlCount += item.contentUrlCount;
    summary.resolvedContentOwnerCount += item.resolvedContentOwnerCount;
    summary.ownerUnresolvedCount += item.ownerUnresolvedCount;
    families.set(item.family, summary);
  }

  for (const candidate of candidates) {
    const family = candidate.discoveryQuery ? queryFamily.get(candidate.discoveryQuery) : undefined;
    if (!family) continue;
    const summary = families.get(family);
    if (!summary) continue;
    summary.saved += 1;
    if (candidate.candidateStatus === "search_qualified" || candidate.candidateStatus === "qualified") summary.recommended += 1;
    if (candidate.candidateStatus === "needs_review") summary.needsReview += 1;
  }

  for (const [family, summary] of families) console.info(`google_discovery_family ${JSON.stringify({
    family,
    ...summary,
    profileRate: summary.raw ? summary.profileUrlCount / summary.raw : 0,
    ownerUnresolvedRate: summary.raw ? summary.ownerUnresolvedCount / summary.raw : 0,
  })}`);
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
  const filterDiagnostics = createFilterDiagnostics();
  let filteredNoise = 0;

  for (const result of results) {
    const extraction = result.provider === "exa"
      ? extractExaInstagramCandidate(result.url, result.title, result.text)
      : extractInstagramCandidate(result.url, result.title, result.text);
    if (!extraction) {
      filteredNoise += 1;
      const reason = getInstagramExtractionFailureReason(result.url, result.title, result.text) ?? "unsupported_instagram_url";
      addFilterDiagnostic(filterDiagnostics, reason);
      continue;
    }
    const current = grouped.get(extraction.handle) ?? [];
    current.push({ result, extraction });
    grouped.set(extraction.handle, current);
  }

  return { grouped, filteredNoise, filterDiagnostics };
}

async function enrichContentOnlyProfiles(
  grouped: Map<string, ExtractedEvidence[]>,
  source: DiscoverySource,
): Promise<ProfileEnrichmentOutcome> {
  const contentOnly = [...grouped.entries()].filter(([, evidence]) =>
    !evidence.some((item) => item.extraction.evidenceKind === "profile"),
  );
  if (!contentOnly.length) {
    return { grouped, enrichedCount: 0, failureCount: 0, lookupCount: 0, skippedCount: 0, unresolvedCount: 0 };
  }

  const providers = source === "google" ? getConfiguredGoogleProviders() : getConfiguredProviders();
  if (!providers.length) {
    return { grouped, enrichedCount: 0, failureCount: 0, lookupCount: 0, skippedCount: contentOnly.length, unresolvedCount: 0 };
  }

  const ranked = contentOnly
    .map(([handle, evidence]) => ({ handle, evidence, score: scoreEvidenceForFollowUp(evidence) }))
    .sort((a, b) => b.score - a.score || a.handle.localeCompare(b.handle));
  const configuredBudget = source === "google"
    ? clamp(Number(process.env.DISCOVERY_GOOGLE_PROFILE_ENRICHMENT_BUDGET ?? GOOGLE_PROFILE_ENRICHMENT_BUDGET), 0, 30)
    : ranked.length;
  const selected = ranked.slice(0, configuredBudget);
  const enriched = new Map(
    [...grouped.entries()].map(([handle, evidence]) => [handle, [...evidence]]),
  );
  const concurrency = clamp(Number(process.env.DISCOVERY_CONCURRENCY ?? 4), 1, 8);
  let enrichedCount = 0;
  let failureCount = 0;
  let unresolvedCount = 0;

  for (let offset = 0; offset < selected.length; offset += concurrency) {
    const wave = selected.slice(offset, offset + concurrency);
    const outcomes = await Promise.all(wave.map(async ({ handle, evidence }) => {
      const evidenceProvider = providers.find((item) => evidence.some(({ result }) => result.provider === item.name));
      const providerOrder = source === "google"
        ? [...providers].sort((a, b) => Number(b.name === "serper") - Number(a.name === "serper"))
        : evidenceProvider
          ? [evidenceProvider, ...providers.filter((item) => item !== evidenceProvider)]
          : providers;
      let outcome: SearchOutcome = { results: [], failureCount: 0 };
      for (const provider of providerOrder) {
        try {
          outcome = { results: await provider.search(buildProfileLookupQuery(handle), 5), failureCount: outcome.failureCount };
          break;
        } catch {
          outcome.failureCount += 1;
        }
      }
      const profileEvidence = outcome.results.flatMap((result): ExtractedEvidence[] => {
        const extraction = extractInstagramCandidate(result.url, result.title, result.text);
        if (!extraction || extraction.handle !== handle || extraction.evidenceKind !== "profile") return [];
        return [{ result, extraction }];
      });
      return { handle, profileEvidence, failureCount: outcome.failureCount };
    }));

    for (const outcome of outcomes) {
      failureCount += outcome.failureCount;
      if (!outcome.profileEvidence.length) { unresolvedCount += 1; continue; }
      const current = enriched.get(outcome.handle) ?? [];
      const knownUrls = new Set(current.map((item) => normalizeResultUrl(item.result.url)));
      let added = false;
      for (const item of outcome.profileEvidence) {
        const key = normalizeResultUrl(item.result.url);
        if (knownUrls.has(key)) continue;
        knownUrls.add(key);
        current.push(item);
        added = true;
      }
      if (added) enrichedCount += 1;
      enriched.set(outcome.handle, current);
    }
  }

  return {
    grouped: enriched,
    enrichedCount,
    failureCount,
    lookupCount: selected.length,
    skippedCount: Math.max(0, contentOnly.length - selected.length),
    unresolvedCount,
  };
}

function getCommercialIntentFlags(text: string) {
  const flags: string[] = [];
  if (/有償PR|タイアップ|アンバサダー|お仕事(?:の)?依頼|PR依頼|案件依頼/i.test(text)) flags.push("commercial:strong");
  if (/(?:お仕事|ご依頼).{0,40}(?:DM|メール|mail|email)/i.test(text)) flags.push("commercial:contact");
  if (/(?:#?PR|提供).{0,80}(?:韓国|K-?Beauty|コスメ|美容|グルメ|カフェ)/i.test(text)) flags.push("commercial:korea-sponsored");
  if (/(?:韓国在住|在韓|毎月.{0,8}(?:渡韓|韓国)|月\s*\d+.{0,8}(?:渡韓|韓国)|渡韓予定)/i.test(text)) flags.push("commercial:korea-access");
  return flags;
}

function commercialIntentScoreFromText(text: string) {
  const flags = getCommercialIntentFlags(text);
  let score = 0;
  if (flags.includes("commercial:strong")) score += 8;
  if (flags.includes("commercial:contact")) score += 5;
  if (flags.includes("commercial:korea-sponsored")) score += 4;
  if (flags.includes("commercial:korea-access")) score += 3;
  return score;
}

function commercialIntentScore(candidate: DiscoveryCandidate) {
  return candidate.flags.reduce((score, flag) => {
    if (flag === "commercial:strong") return score + 8;
    if (flag === "commercial:contact") return score + 5;
    if (flag === "commercial:korea-sponsored") return score + 4;
    if (flag === "commercial:korea-access") return score + 3;
    return score;
  }, 0);
}

function scoreEvidenceForFollowUp(evidence: ExtractedEvidence[]) {
  const text = joinEvidence(evidence.map((item) => `${item.result.title}\n${item.result.text}`), 2400);
  let score = 0;
  const explicitJapan = /日本人|在韓日本人|日本語(?:で|の|発信)|日本向け|\bJapanese\b|🇯🇵/i.test(text);
  const japaneseScriptCount = (text.match(/[ぁ-んァ-ヶー]/g) ?? []).length;
  if (explicitJapan) score += 9;
  else if (japaneseScriptCount >= 12) score += 3;
  if (/韓国在住|在韓|渡韓|訪韓|ソウル|Seoul|韓国旅行|韓国美容|K-?Beauty|韓国コスメ|韓国スキンケア|オリーブヤング/i.test(text)) score += 7;
  if (/美容|コスメ|スキンケア|肌管理|皮膚科|クリニック|beauty|cosmetic|skincare|makeup/i.test(text)) score += 5;
  if (/旅行|旅|暮らし|ライフスタイル|日常|ママ|主婦|会社員|留学生|ワーホリ|日韓夫婦|VLOG/i.test(text)) score += 2;

  score += commercialIntentScoreFromText(text);

  const followers = extractFollowerCount(text);
  if (followers !== null) {
    if (followers >= 5_000 && followers < 50_000) score += 7;
    else if (followers >= 50_000 && followers < MAX_TARGET_FOLLOWERS_EXCLUSIVE) score += 5;
    else if (followers >= MIN_TARGET_FOLLOWERS && followers < 5_000) score += 3;
    else if (followers < MIN_TARGET_FOLLOWERS || followers >= MAX_TARGET_FOLLOWERS_EXCLUSIVE) score -= 8;
  }

  const explicitJapanTarget = /日本人|日本語(?:で|の|発信)|日本向け|\bJapanese\b/i.test(text);
  if (/廣東話|粤語|粵語|繁體中文|简体中文|簡體中文|小紅書|Hong Kong|香港|Taiwan|台湾|中國|中国/i.test(text) && !explicitJapanTarget) score -= 10;
  if (/公式(?:アカウント|Instagram)|official|株式会社|医療法人|情報メディア|ニュースメディア|agency|recruit/i.test(text)) score -= 10;
  return score;
}

function buildProfileLookupQuery(handle: string) {
  return `site:instagram.com/${handle}/ "${handle}"`;
}

function buildCategoryEvidenceLookupQuery(handle: string) {
  return `site:instagram.com/${handle} "${handle}" (followers OR フォロワー OR 韓国美容 OR 韓国コスメ OR スキンケア OR 肌管理 OR PR OR 案件 OR お仕事依頼 OR 提供 OR アンバサダー OR 渡韓 OR 韓国在住)`;
}

export function isCategoryEvidenceEnrichmentEligible(input: {
  category: SearchCategory;
  attempted: number;
  budget: number;
  accountType: DiscoveryCandidate["accountType"];
  targetSignalCount: number;
  koreaAffinity: DiscoveryCandidate["koreaAffinity"];
  contentFit: DiscoveryCandidate["contentFit"];
  accountAvailability: DiscoveryCandidate["accountAvailability"];
  followers: number | null;
}) {
  return input.category === "beauty"
    && input.attempted < input.budget
    && input.accountType === "creator"
    && input.targetSignalCount > 0
    && (input.koreaAffinity === "strong" || input.koreaAffinity === "yes")
    && (input.contentFit === "beauty" || input.contentFit === "korea_travel" || input.contentFit === "lifestyle")
    && input.accountAvailability !== "unavailable"
    && (input.followers === null || (input.followers >= 0 && input.followers < MAX_TARGET_FOLLOWERS_EXCLUSIVE));
}

async function searchCategoryEvidence(
  handle: string,
  source: DiscoverySource,
  preferredProvider?: SearchProviderName,
) {
  const providers = source === "google" ? getConfiguredGoogleProviders() : getConfiguredProviders();
  if (!providers.length) return { evidence: [] as ExtractedEvidence[], failureCount: 0 };
  const provider = source === "google"
    ? providers.find((item) => item.name === "serper") ?? providers[0]
    : providers.find((item) => item.name === preferredProvider) ?? providers[0];
  const query = buildCategoryEvidenceLookupQuery(handle);
  try {
    const results = await provider.search(query, 5);
    const evidence = results.flatMap((result): ExtractedEvidence[] => {
      const extraction = extractInstagramCandidate(result.url, result.title, result.text);
      if (!extraction || extraction.handle !== handle) return [];
      return [{ result: { ...result, query }, extraction }];
    });
    return { evidence, failureCount: 0 };
  } catch (error) {
    console.warn("discovery_category_enrichment_failed", {
      handle,
      provider: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
    return { evidence: [] as ExtractedEvidence[], failureCount: 1 };
  }
}

async function groupedToCandidates(
  grouped: Map<string, ExtractedEvidence[]>,
  category: SearchCategory,
  source: DiscoverySource,
) {
  const now = new Date().toISOString();
  const rankedForAvailability = [...grouped.entries()]
    .map(([handle, evidence]) => ({
      handle,
      score: scoreEvidenceForFollowUp(evidence) + (evidence.some((item) => item.extraction.evidenceKind === "profile") ? 12 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.handle.localeCompare(b.handle));
  const availabilityBudget = source === "google"
    ? clamp(Number(process.env.DISCOVERY_GOOGLE_AVAILABILITY_BUDGET ?? GOOGLE_AVAILABILITY_CHECK_BUDGET), 0, 40)
    : rankedForAvailability.length;
  const availabilityHandles = rankedForAvailability.slice(0, availabilityBudget).map((item) => item.handle);
  const availability = await checkAccountAvailabilities(availabilityHandles);
  const candidates: DiscoveryCandidate[] = [];
  const filterDiagnostics = createFilterDiagnostics();
  const categoryEnrichmentBudget = category === "beauty"
    ? clamp(Number(process.env.DISCOVERY_CATEGORY_ENRICHMENT_BUDGET ?? CATEGORY_EVIDENCE_ENRICHMENT_BUDGET), 0, 8)
    : 0;
  let filteredNoise = 0;
  let categoryEnrichmentAttempted = 0;
  let categoryEnrichmentPromoted = 0;
  let categoryEnrichmentFailureCount = 0;

  const orderedCandidates = [...grouped.entries()].sort((a, b) => scoreEvidenceForFollowUp(b[1]) - scoreEvidenceForFollowUp(a[1]) || a[0].localeCompare(b[0]));

  for (const [handle, evidence] of orderedCandidates) {
    const profileEvidence = evidence.filter((item) => item.extraction.evidenceKind === "profile");
    const evidenceKind: InstagramCandidateExtraction["evidenceKind"] = profileEvidence.length ? "profile" : "content";
    const primary = profileEvidence[0] ?? evidence[0];
    const orderedEvidence = profileEvidence.length
      ? [...profileEvidence, ...evidence.filter((item) => item.extraction.evidenceKind !== "profile")]
      : evidence;
    let combinedText = joinEvidence(orderedEvidence.map((item) => `${item.result.title}\n${item.result.text}`), 2400);
    let profileText = joinEvidence(profileEvidence.map((item) => `${item.result.title}\n${item.result.text}`), 1600);
    const accountAvailability = availability.get(handle) ?? "unknown";
    let followers = extractFollowerReference(profileEvidence.length ? profileEvidence : evidence);
    const assessmentInput = {
      handle,
      evidenceKind,
      title: "",
      text: combinedText,
      profileText,
      category,
      accountAvailability,
    } as const;

    if (primary.result.provider === "tavily" && getTavilyObviousBusinessProfileReason(profileText, combinedText, category, evidenceKind)) {
      filteredNoise += 1;
      addFilterDiagnostic(filterDiagnostics, "obvious_business");
      continue;
    }

    const preRejectReason = getDiscoveryPreRejectReason(assessmentInput);
    if (preRejectReason) {
      filteredNoise += 1;
      addFilterDiagnostic(filterDiagnostics, preRejectReason);
      continue;
    }

    let assessment = assessDiscoveryCandidate(assessmentInput);
    if (!assessment) {
      filteredNoise += 1;
      addFilterDiagnostic(filterDiagnostics, "other_filtered");
      continue;
    }

    const categoryEnrichmentEligible = isCategoryEvidenceEnrichmentEligible({
      category,
      attempted: categoryEnrichmentAttempted,
      budget: categoryEnrichmentBudget,
      accountType: assessment.accountType,
      targetSignalCount: assessment.targetSignals.length,
      koreaAffinity: assessment.koreaAffinity,
      contentFit: assessment.contentFit,
      accountAvailability,
      followers,
    });
    if (categoryEnrichmentEligible) {
      categoryEnrichmentAttempted += 1;
      const enriched = await searchCategoryEvidence(handle, source, primary.result.provider);
      categoryEnrichmentFailureCount += enriched.failureCount;
      if (enriched.evidence.length) {
        combinedText = joinEvidence([
          combinedText,
          ...enriched.evidence.map((item) => `${item.result.title}\n${item.result.text}`),
        ], 2400);
        const enrichedProfiles = enriched.evidence.filter((item) => item.extraction.evidenceKind === "profile");
        if (enrichedProfiles.length) {
          profileText = joinEvidence([
            profileText,
            ...enrichedProfiles.map((item) => `${item.result.title}\n${item.result.text}`),
          ], 1600);
        }
        const enrichedInput = {
          handle,
          evidenceKind: profileText ? "profile" as const : evidenceKind,
          title: "",
          text: combinedText,
          profileText,
          category,
          accountAvailability,
        };
        const enrichedPreRejectReason = getDiscoveryPreRejectReason(enrichedInput);
        if (enrichedPreRejectReason) {
          filteredNoise += 1;
          addFilterDiagnostic(filterDiagnostics, enrichedPreRejectReason);
          continue;
        }
        if (followers === null) followers = extractFollowerReference([...profileEvidence, ...enriched.evidence]);
        const enrichedAssessment = assessDiscoveryCandidate(enrichedInput);
        if (enrichedAssessment) {
          if (assessment.contentFit !== "beauty" && enrichedAssessment.contentFit === "beauty") categoryEnrichmentPromoted += 1;
          assessment = enrichedAssessment;
        }
      }
    }

    const smallCreatorReview = category === "beauty" && followers !== null && followers < MIN_TARGET_FOLLOWERS
      && hasStrongSmallCreatorEvidence(assessment, combinedText);
    if (getDiscoveryFollowerRejection(category, followers) === "under_min" && !smallCreatorReview) {
      filteredNoise += 1;
      addFilterDiagnostic(filterDiagnostics, "follower_under_min");
      continue;
    }
    if (smallCreatorReview) {
      assessment = { ...assessment, candidateStatus: "needs_review",
        flags: [...assessment.flags, "3K 미만·실제 Reels 성과 검토 필요"] };
    }

    if (primary.result.provider === "exa" && !hasExaJapanTargetEvidence(assessment.targetSignals, combinedText)) {
      filteredNoise += 1;
      addFilterDiagnostic(filterDiagnostics, "exa_japan_gate");
      continue;
    }

    if (accountAvailability === "unavailable") addFilterDiagnostic(filterDiagnostics, "account_unavailable");
    if (assessment.candidateStatus === "hard_reject") {
      if (assessment.koreaAffinity === "unknown") addFilterDiagnostic(filterDiagnostics, "insufficient_korea_affinity");
      if (assessment.contentFit !== category) addFilterDiagnostic(filterDiagnostics, "category_mismatch");
    }

    const foodFlags = category === "food"
      ? FOOD_REVIEW_SIGNALS
          .filter((signal) => combinedText.toLowerCase().includes(signal.toLowerCase()))
          .map((signal) => `제외검토:${signal}`)
      : [];
    const commercialFlags = getCommercialIntentFlags(combinedText);

    candidates.push({
      handle,
      profileUrl: profileUrl(handle),
      category,
      sourceProvider: primary.result.provider,
      evidenceUrl: primary.result.url,
      evidenceText: combinedText.slice(0, 1200),
      discoveryQuery: evidence.find((item) => item.result.query)?.result.query ?? null,
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
      flags: [...new Set([...assessment.flags, ...foodFlags, ...commercialFlags])],
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

  return {
    candidates,
    filteredNoise,
    availabilityCheckCount: availabilityHandles.length,
    categoryEnrichmentAttempted,
    categoryEnrichmentPromoted,
    categoryEnrichmentFailureCount,
    filterDiagnostics,
  };
}

export function getDiscoveryFollowerRejection(category: SearchCategory, followers: number | null) {
  if (category === "beauty" && followers !== null && followers < MIN_TARGET_FOLLOWERS) return "under_min" as const;
  return null;
}

function extractFollowerReference(evidence: ExtractedEvidence[]) {
  for (const item of evidence) {
    const value = extractFollowerCount(`${item.result.title}\n${item.result.text}`);
    if (value !== null) return value;
  }
  return null;
}

export function extractFollowerCount(value: string) {
  const text = cleanText(value);
  const amount = "(\\d{1,3}(?:[,.]\\d{3})+|\\d+(?:[.,]\\d+)?)\\s*(万|[kKmM])?";
  const label = "(?:followers?|フォロワー(?:数)?)";
  const patterns = [
    new RegExp(`${amount}\\s*\\+?(?:\\s*(?:人|名))?\\s*${label}`, "i"),
    new RegExp(`${label}\\s*[:：\\-]?\\s*${amount}\\s*\\+?(?:\\s*(?:人|名))?`, "i"),
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
  const tierRank = { ineligible: 0, review: 1, recommended: 2, priority: 3 } as const;
  const aRecommendation = getRecommendationAssessment(a);
  const bRecommendation = getRecommendationAssessment(b);
  const tierDiff = tierRank[bRecommendation.tier] - tierRank[aRecommendation.tier];
  if (tierDiff) return tierDiff;
  const scoreDiff = bRecommendation.recommendationScore - aRecommendation.recommendationScore;
  if (scoreDiff) return scoreDiff;
  return a.handle.localeCompare(b.handle);
}

function discoveryCommercialRank(candidate: DiscoveryCandidate) {
  let score = 0;
  if (candidate.accountType === "creator") score += 20;
  if (candidate.targetSignals.length) score += 10;
  if (candidate.koreaAffinity === "strong") score += 14;
  else if (candidate.koreaAffinity === "yes") score += 9;
  if (candidate.contentFit === candidate.category) score += 12;
  if (candidate.evidenceKind === "profile") score += 5;
  if (candidate.followers !== null) {
    score += 3;
    if (
      candidate.category !== "beauty"
      || (candidate.followers >= MIN_TARGET_FOLLOWERS && candidate.followers < MAX_TARGET_FOLLOWERS_EXCLUSIVE)
    ) score += 8;
  }
  score += commercialIntentScore(candidate);
  if (candidate.flags.includes("commercial:korea-access")) score += 6;
  return score;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
