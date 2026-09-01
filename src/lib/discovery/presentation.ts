import type { DiscoveryCandidate } from "./types";

export type CandidateViewState = "qualified" | "priority" | "review";

export function getCandidateViewState(candidate: DiscoveryCandidate): CandidateViewState {
  if (candidate.candidateStatus === "search_qualified" && candidate.verificationStatus === "verified") {
    return "qualified";
  }
  if (candidate.candidateStatus === "search_qualified" && candidate.verificationStatus === "needs_instagram") {
    return "priority";
  }
  return "review";
}
