import { classifySearchStage } from "./classification";
import type { DiscoveryCandidate } from "./types";

export type CandidateViewState =
  | "verification_needed"
  | "recommended"
  | "duplicate_passed"
  | "final_verification"
  | "dm_ready"
  | "unmapped";

export function getSearchStageViewState(candidate: DiscoveryCandidate): "verification_needed" | "recommended" | "unmapped" {
  // 후보 찾기 당시 저장된 판정을 우선 사용한다. 최종 검증에서 갱신된 프로필 값으로 원래 판정을 다시 계산하지 않는다.
  if (candidate.candidateStatus === "search_qualified") return "recommended";
  if (candidate.candidateStatus === "needs_review") return "verification_needed";

  const status = classifySearchStage({
    category: candidate.category,
    accountAvailability: candidate.accountAvailability,
    accountType: candidate.accountType,
    koreaAffinity: candidate.koreaAffinity,
    contentFit: candidate.contentFit,
    eligibility: candidate.eligibility,
  });

  if (status === "search_qualified") return "recommended";
  if (status === "needs_review") return "verification_needed";
  return "unmapped";
}

export function getCandidateViewState(candidate: DiscoveryCandidate): CandidateViewState {
  if (
    candidate.verificationStatus === "hard_reject"
    || candidate.verificationStatus === "private"
    || candidate.verificationStatus === "rejected"
    || candidate.duplicateCheckStatus === "duplicate"
    || candidate.duplicateCheckStatus === "protected"
  ) {
    return "unmapped";
  }

  if (candidate.duplicateCheckStatus === "available") {
    const sourceState = getSearchStageViewState(candidate);
    if (sourceState === "unmapped") return "unmapped";

    // 중복 통과 후 최종 검증이 끝나지 않았거나 필수값이 부족하면 중복 통과에 남겨 재검증한다.
    if (candidate.verificationStatus === "needs_instagram" || candidate.verificationStatus === "insufficient") {
      return "duplicate_passed";
    }

    // 최종 검증 이후 생성된 DM만 DM 준비로 보낸다. 재검증이 더 최신이면 다시 생성해야 한다.
    if (candidate.verificationStatus === "verified" && candidate.candidateStatus === "qualified") {
      const dmGeneratedAt = candidate.dmGeneratedAt ? Date.parse(candidate.dmGeneratedAt) : Number.NaN;
      const verifiedAt = candidate.verifiedAt ? Date.parse(candidate.verifiedAt) : Number.NaN;
      const dmIsCurrent = Boolean(candidate.dmText)
        && Number.isFinite(dmGeneratedAt)
        && (!Number.isFinite(verifiedAt) || dmGeneratedAt >= verifiedAt);
      return dmIsCurrent ? "dm_ready" : "final_verification";
    }

    return "unmapped";
  }

  if (
    (candidate.duplicateCheckStatus === "not_checked" || candidate.duplicateCheckStatus === "unknown")
    && candidate.verificationStatus === "needs_instagram"
  ) {
    return getSearchStageViewState(candidate);
  }

  return "unmapped";
}
