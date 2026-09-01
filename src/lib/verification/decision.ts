import type { DuplicateCheckStatus, SearchCategory } from "@/lib/discovery/types";
import type { ReelMetrics } from "./metrics";

export type VerificationDecisionInput = {
  category: SearchCategory;
  duplicateStatus: DuplicateCheckStatus;
  exists: boolean | null;
  isPrivate: boolean | null;
  isPersonalCreator: boolean | null;
  followers: number | null;
  recentActivity: boolean | null;
  japaneseTarget: boolean | null;
  koreaConnection: boolean | null;
  categoryRelevant: boolean | null;
  reelMetrics: ReelMetrics;
};

export type VerificationDecision = {
  discoveryStatus: "qualified" | "needs_review" | "hard_reject" | "private";
  verificationStatus: "needs_instagram" | "verified" | "insufficient" | "private" | "rejected";
  reason: string;
};

// 현재 모집 프로젝트의 최소 공통선만 사용한다.
// 검색 자체를 좁히지 않고, Instagram 원본 검증 뒤 명백한 오류만 유력에서 제거한다.
const ABSOLUTE_LOW_FOLLOWER_REJECT = 500;
const CURRENT_MIN_FOLLOWERS = 1000;
const CURRENT_BEAUTY_MIN_REEL_AVERAGE = 1000;

export function decideVerification(input: VerificationDecisionInput): VerificationDecision {
  if (input.duplicateStatus === "duplicate" || input.duplicateStatus === "protected") {
    return { discoveryStatus: "hard_reject", verificationStatus: "rejected", reason: "FixUp 중복/보호목록" };
  }

  if (input.duplicateStatus !== "available") {
    return { discoveryStatus: "needs_review", verificationStatus: "needs_instagram", reason: "FixUp 중복 확인 필요" };
  }

  if (input.exists === false) {
    return { discoveryStatus: "hard_reject", verificationStatus: "rejected", reason: "현재 존재하지 않는 계정" };
  }
  if (input.isPrivate === true) {
    return { discoveryStatus: "private", verificationStatus: "private", reason: "비공개 계정" };
  }
  if (input.isPersonalCreator === false) {
    return { discoveryStatus: "hard_reject", verificationStatus: "rejected", reason: "개인 크리에이터가 아닌 계정" };
  }

  // 35명 수준처럼 현재 FixUp 모집 범위와 명백히 동떨어진 계정만 hard reject.
  // 500~999명은 향후 성장/변동 가능성을 고려해 검토로 남긴다.
  if (input.followers !== null && input.followers < ABSOLUTE_LOW_FOLLOWER_REJECT) {
    return { discoveryStatus: "hard_reject", verificationStatus: "rejected", reason: "팔로워 규모가 현저히 부족" };
  }

  const coreUnknown = input.exists === null
    || input.isPrivate === null
    || input.isPersonalCreator === null
    || input.japaneseTarget === null
    || input.koreaConnection === null
    || input.categoryRelevant === null
    || input.recentActivity === null
    || input.followers === null;

  const qualitativePass = input.exists === true
    && input.isPrivate === false
    && input.isPersonalCreator === true
    && input.japaneseTarget === true
    && input.koreaConnection === true
    && input.categoryRelevant === true
    && input.recentActivity === true;

  const followerPass = input.followers !== null && input.followers >= CURRENT_MIN_FOLLOWERS;
  const performanceReady = input.category === "food" || input.reelMetrics.status === "ready";
  const performancePass = input.category === "food"
    || (input.reelMetrics.average !== null && input.reelMetrics.average >= CURRENT_BEAUTY_MIN_REEL_AVERAGE);

  if (qualitativePass && !coreUnknown && followerPass && performanceReady && performancePass) {
    return { discoveryStatus: "qualified", verificationStatus: "verified", reason: "현재 최소 모집조건 충족" };
  }

  const insufficient = coreUnknown || !performanceReady;
  if (!followerPass) {
    return { discoveryStatus: "needs_review", verificationStatus: insufficient ? "insufficient" : "verified", reason: "팔로워 1K 최소조건 미달" };
  }
  if (!performancePass) {
    return { discoveryStatus: "needs_review", verificationStatus: "verified", reason: "최근 Reels 평균 1K 최소조건 미달" };
  }

  return {
    discoveryStatus: "needs_review",
    verificationStatus: insufficient ? "insufficient" : "verified",
    reason: insufficient ? "검증값 일부 부족" : "정성 조건 추가 확인 필요",
  };
}
