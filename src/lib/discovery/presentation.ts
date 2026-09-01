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

  // Google Apps Script 중복 통과 이후에만 Instagram 최종 검증 단계로 이동한다.
  if (candidate.duplicateCheckStatus === "available") {
    if (
      candidate.candidateStatus === "search_qualified"
      && candidate.verificationStatus === "verified"
      && candidate.verifiedAt !== null
      && candidate.verificationNote?.startsWith("현재 최소 모집조건 충족")
    ) {
      return "dm_ready";
    }

    if (candidate.verificationStatus === "needs_instagram") {
      return "duplicate_passed";
    }

    if (candidate.verificationStatus === "verified" || candidate.verificationStatus === "insufficient") {
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
