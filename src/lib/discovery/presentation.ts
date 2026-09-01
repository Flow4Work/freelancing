import type { DiscoveryCandidate } from "./types";

export type CandidateViewState =
  | "verification_needed"
  | "recommended"
  | "duplicate_passed"
  | "final_verification"
  | "dm_ready"
  | "unmapped";

export function getCandidateViewState(candidate: DiscoveryCandidate): CandidateViewState {
  if (
    candidate.candidateStatus === "hard_reject"
    || candidate.verificationStatus === "hard_reject"
    || candidate.verificationStatus === "private"
    || candidate.verificationStatus === "rejected"
    || candidate.duplicateCheckStatus === "duplicate"
    || candidate.duplicateCheckStatus === "protected"
  ) {
    return "unmapped";
  }

  // 중복 통과 후 최종 검증이 끝나지 않았거나 필수값이 부족하면 중복 통과에 남겨 재검증한다.
  if (candidate.duplicateCheckStatus === "available") {
    if (candidate.verificationStatus === "needs_instagram" || candidate.verificationStatus === "insufficient") {
      return "duplicate_passed";
    }

    // 실제 모집조건을 모두 통과한 qualified + verified만 최종 검증 완료로 보낸다.
    if (candidate.verificationStatus === "verified" && candidate.candidateStatus === "qualified") {
      return "final_verification";
    }

    return "unmapped";
  }

  // 중복 검사 전에는 후보 찾기에서 저장된 의미가 명확한 정상 조합만 매핑한다.
  if (
    (candidate.duplicateCheckStatus === "not_checked" || candidate.duplicateCheckStatus === "unknown")
    && candidate.verificationStatus === "needs_instagram"
  ) {
    if (candidate.candidateStatus === "search_qualified") {
      return "recommended";
    }

    if (candidate.candidateStatus === "needs_review") {
      return "verification_needed";
    }
  }

  return "unmapped";
}
