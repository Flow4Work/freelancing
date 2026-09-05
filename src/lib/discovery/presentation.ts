import { getFollowerPolicyRejection } from "@/lib/verification/policy";
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

    // FixUp 등록 가능 뒤 Instagram 프로필에서 정확한 followers까지 확인된 후보만 중복 통과로 보낸다.
    // 계정/페이지가 없으면 저장 단계에서 rejected 처리되고, Instagram 상태나 followers를 확인하지 못한 후보는 원래 후보 탭에 남는다.
    if (candidate.followers === null || candidate.followersSource !== "instagram") {
      return sourceState;
    }

    // 과거 데이터가 남아 있어도 현재 타깃 팔로워 범위를 벗어난 정확값은 활성 탭으로 다시 노출하지 않는다.
    if (getFollowerPolicyRejection(candidate.followers)) {
      return "unmapped";
    }

    // 중복 통과 후 최종 검증이 끝나지 않았거나 필수값이 부족하면 중복 통과에 남겨 재검증한다.
    if (candidate.verificationStatus === "needs_instagram" || candidate.verificationStatus === "insufficient") {
      return "duplicate_passed";
    }

    // DM 생성/승인/발송 이력은 후보 상태와 분리한다. 최종 검증 완료 후보는 DM을 준비해도 이 탭에 그대로 유지한다.
    if (candidate.verificationStatus === "verified" && candidate.candidateStatus === "qualified") {
      return "final_verification";
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
