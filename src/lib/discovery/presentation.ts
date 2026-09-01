import type { DiscoveryCandidate } from "./types";

export type CandidateViewState =
  | "verification_needed"
  | "recommended"
  | "duplicate_passed"
  | "final_verification"
  | "dm_ready"
  | "unmapped";

const KNOWN_DISCOVERY_STATUSES = new Set([
  "discovered",
  "search_qualified",
  "needs_review",
  "hard_reject",
  "qualified",
  "private",
  "contacted",
]);
const KNOWN_VERIFICATION_STATUSES = new Set([
  "needs_instagram",
  "verified",
  "insufficient",
  "private",
  "rejected",
  "hard_reject",
]);
const KNOWN_DUPLICATE_STATUSES = new Set([
  "not_checked",
  "available",
  "duplicate",
  "protected",
  "unknown",
]);

export function getCandidateViewState(candidate: DiscoveryCandidate): CandidateViewState {
  const discoveryStatus = candidate.storedDiscoveryStatus ?? candidate.candidateStatus;
  const verificationStatus = candidate.storedVerificationStatus ?? candidate.verificationStatus;
  const duplicateStatus = candidate.storedDuplicateCheckStatus ?? candidate.duplicateCheckStatus;

  if (
    !KNOWN_DISCOVERY_STATUSES.has(discoveryStatus)
    || !KNOWN_VERIFICATION_STATUSES.has(verificationStatus)
    || !KNOWN_DUPLICATE_STATUSES.has(duplicateStatus)
  ) {
    return "unmapped";
  }

  // 컨택 완료·제외·중복 후보는 데이터는 보존하되 새 작업 단계로 추측 이동시키지 않는다.
  if (
    candidate.isContacted
    || discoveryStatus === "contacted"
    || discoveryStatus === "hard_reject"
    || discoveryStatus === "private"
    || verificationStatus === "hard_reject"
    || duplicateStatus === "duplicate"
    || duplicateStatus === "protected"
  ) {
    return "unmapped";
  }

  // Google Apps Script 중복 통과 이후 단계는 반드시 Instagram 최종 검증 순서를 따른다.
  if (duplicateStatus === "available") {
    if (discoveryStatus === "qualified" && verificationStatus === "verified") {
      return "dm_ready";
    }

    if (candidate.instagramVerificationPending) {
      return "final_verification";
    }

    if (verificationStatus === "needs_instagram") {
      return "duplicate_passed";
    }

    if (verificationStatus === "verified" || verificationStatus === "insufficient") {
      return "final_verification";
    }

    return "unmapped";
  }

  // 중복 검사 전 단계는 기존 저장 의미가 명확한 정상 조합만 매핑한다.
  if ((duplicateStatus === "not_checked" || duplicateStatus === "unknown") && verificationStatus === "needs_instagram") {
    if (discoveryStatus === "search_qualified") {
      return "recommended";
    }

    if (discoveryStatus === "discovered" || discoveryStatus === "needs_review") {
      return "verification_needed";
    }
  }

  return "unmapped";
}
