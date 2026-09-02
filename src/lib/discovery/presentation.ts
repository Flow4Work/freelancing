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

    if (candidate.verificationStatus === "needs_instagram") {
      return "duplicate_passed";
    }

    if (candidate.verificationStatus === "insufficient") {
      return "final_verification";
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
