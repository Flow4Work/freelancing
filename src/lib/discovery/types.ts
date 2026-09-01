export type SearchCategory = "beauty" | "food";
export type SearchProviderName = "exa" | "tavily";
export type CandidateStatus = "search_qualified" | "needs_review" | "hard_reject";

export type RawSearchResult = {
  provider: SearchProviderName;
  url: string;
  title: string;
  text: string;
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
  followers: number | null;
  reelAverage: number | null;
  reelMedian: number | null;
  reelSampleSize: number | null;
  verificationStatus: "needs_instagram" | "hard_reject";
  discoveredAt: string;
};

export type DiscoveryResponse = {
  category: SearchCategory;
  targetCount: number;
  candidates: DiscoveryCandidate[];
  qualifiedCount: number;
  reviewCount: number;
  filteredNoise: number;
  skippedDuplicates: number;
  queriesRun: number;
  providersUsed: SearchProviderName[];
  warnings: string[];
};

export interface SearchProvider {
  name: SearchProviderName;
  search(query: string, limit: number): Promise<RawSearchResult[]>;
}
