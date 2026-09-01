import type { DiscoveryCandidate } from "./types";

export type CandidateViewState = "qualified" | "priority" | "review";

export function getCandidateViewState(candidate: DiscoveryCandidate): CandidateViewState {
  if (candidate.candidateStatus !== "search_qualified") {
    return "review";
  }

  // 중복 확인을 통과한 후보만 Instagram 원본 검증 단계로 보낸다.
  if (candidate.verificationStatus === "needs_instagram" && candidate.duplicateCheckStatus === "available") {
    return "priority";
  }

  // 검색 유력 후보는 중복 확인 전에는 유력에 남고,
  // Instagram 검증까지 끝난 최종 유력 후보도 기존처럼 유력에 유지한다.
  if (candidate.verificationStatus === "needs_instagram" || candidate.verificationStatus === "verified") {
    return "qualified";
  }

  return "review";
}
