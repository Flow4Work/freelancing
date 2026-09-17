export type SearchCategory = "beauty" | "food";
export type DiscoverySource = "standard" | "google";
export type SearchProviderName = "exa" | "tavily" | "serper" | "serpapi";
export type GoogleSearchProviderName = Extract<SearchProviderName, "serper" | "serpapi">;
export type CandidateStatus = "search_qualified" | "needs_review" | "hard_reject" | "qualified";
export type VerificationStatus = "needs_instagram" | "verified" | "insufficient" | "private" | "rejected" | "hard_reject";
export type ReelMetricsStatus = "not_checked" | "ready" | "insufficient";
export type DuplicateCheckStatus = "not_checked" | "available" | "duplicate" | "protected" | "unknown";
export type AccountAvailability = "active" | "unavailable" | "unknown";
export type AccountType = "creator" | "business" | "unknown";
export type KoreaAffinity = "strong" | "yes" | "none" | "unknown";
export type ContentFit = "beauty" | "food" | "korea_travel" | "lifestyle" | "other";
export type Eligibility = "possible" | "fail" | "unknown";
export type CandidateActivity = "active" | "unknown";
export type DmProvider = "groq" | "scaleway" | "fallback" | "deterministic";
export type FollowerSource = "search" | "instagram";

export type DiscoveryDropReason =
  | "unsupported_instagram_url"
  | "owner_unresolved"
  | "invalid_handle"
  | "reserved_path"
  | "existing_candidate"
  | "contacted_candidate"
  | "obvious_business"
  | "non_japan_target"
  | "insufficient_korea_affinity"
  | "category_mismatch"
  | "exa_japan_gate"
  | "profile_enrichment_failed"
  | "account_unavailable"
  | "follower_under_min"
  | "provider_failure"
  | "other_filtered";

export type DiscoveryFilterDiagnostics = Record<DiscoveryDropReason, number>;

export type RawSearchResult = {
  provider: SearchProviderName;
  url: string;
  title: string;
  text: string;
  query?: string;
};

export type ReelSnapshot = {
  url: string | null;
  views: number | null;
  postedAt: string | null;
};

export type DiscoveryCandidate = {
  handle: string;
  profileUrl: string;
  category: SearchCategory;
  sourceProvider: SearchProviderName;
  evidenceUrl: string;
  evidenceText: string;
  discoveryQuery?: string | null;
  evidenceKind: "profile" | "content";
  accountAvailability: AccountAvailability;
  accountType: AccountType;
  koreaAffinity: KoreaAffinity;
  contentFit: ContentFit;
  eligibility: Eligibility;
  activity: CandidateActivity;
  candidateStatus: CandidateStatus;
  targetSignals: string[];
  koreaSignals: string[];
  rejectReasons: string[];
  flags: string[];
  duplicateCheckStatus: DuplicateCheckStatus;
  duplicateCheckMessage: string | null;
  duplicateCheckedAt: string | null;
  bio: string | null;
  followers: number | null;
  followersSource?: FollowerSource | null;
  reelAverage: number | null;
  reelMedian: number | null;
  reelSampleSize: number | null;
  reelCheckedCount: number | null;
  reelTotalConsidered: number | null;
  reelMetricsStatus: ReelMetricsStatus;
  reelViews: ReelSnapshot[];
  lastActivityAt: string | null;
  verificationNote: string | null;
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
  dmPersonalizationSource?: string | null;
  dmPersonalizationBasis?: string | null;
  dmPersonalizationLine?: string | null;
  dmText?: string | null;
  dmProvider?: DmProvider | null;
  dmModel?: string | null;
  dmGeneratedAt?: string | null;
  discoveredAt: string;
};

export type DiscoveryResponse = {
  source: DiscoverySource;
  category: SearchCategory;
  targetCount: number;
  runNo: number;
  candidates: DiscoveryCandidate[];
  qualifiedCount: number;
  reviewCount: number;
  filteredNoise: number;
  skippedDuplicates: number;
  queriesRun: number;
  providersUsed: SearchProviderName[];
  warnings: string[];
  sourceResultCount: number;
  rawUrlCount: number;
  extractedResultCount: number;
  instagramHandleCount: number;
  existingExcludedCount: number;
  newCandidateCount: number;
  newSavedCount: number;
  additionalLaneCount: number;
  recommendedCount: number;
  priorityContactCount: number;
  needsReviewCount: number;
  excludedCount: number;
  enrichmentLookupCount: number;
  enrichmentSkippedCount: number;
  availabilityCheckCount: number;
  executionMs: number;
  sameRunRepeatCount: number;
  providerFailureCount: number;
  filterDiagnostics: DiscoveryFilterDiagnostics;
};

export type CandidateListResponse = {
  category: SearchCategory;
  candidates: DiscoveryCandidate[];
};

export type VerificationPromptResponse = {
  jobId: string;
  candidateCount: number;
  prompt: string;
};

export type SearchOptions = {
  depth?: number;
};

export interface SearchProvider {
  name: SearchProviderName;
  search(query: string, limit: number, options?: SearchOptions): Promise<RawSearchResult[]>;
}
