export type SearchCategory = "beauty" | "food";
export type SearchProviderName = "exa" | "tavily";
export type CandidateStatus = "search_qualified" | "needs_review" | "hard_reject" | "qualified";
export type VerificationStatus = "needs_instagram" | "verified" | "insufficient" | "private" | "rejected" | "hard_reject";
export type ReelMetricsStatus = "not_checked" | "ready" | "insufficient";
export type DuplicateCheckStatus = "not_checked" | "available" | "duplicate" | "protected" | "unknown";

export type RawSearchResult = {
  provider: SearchProviderName;
  url: string;
  title: string;
  text: string;
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
  evidenceKind: "profile" | "content";
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
  discoveredAt: string;
};

export type DiscoveryResponse = {
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

export interface SearchProvider {
  name: SearchProviderName;
  search(query: string, limit: number): Promise<RawSearchResult[]>;
}
