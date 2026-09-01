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
  if (input.japaneseTarget === false) {
    return { discoveryStatus: "hard_reject", verificationStatus: "rejected", reason: "일본 타깃 아님" };
  }
  if (input.koreaConnection === false) {
    return { discoveryStatus: "hard_reject", verificationStatus: "rejected", reason: "한국 접점 없음" };
  }
  if (input.categoryRelevant === false) {
    return { discoveryStatus: "hard_reject", verificationStatus: "rejected", reason: input.category === "beauty" ? "미용 관련성 없음" : "맛집 관련성 없음" };
  }
  if (input.recentActivity === false) {
    return { discoveryStatus: "hard_reject", verificationStatus: "rejected", reason: "최근 90일 활동 없음" };
  }

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

  if (coreUnknown) {
    return { discoveryStatus: "needs_review", verificationStatus: "insufficient", reason: "검증값 일부 확인 불가" };
  }

  if (input.followers! < CURRENT_MIN_FOLLOWERS) {
    return { discoveryStatus: "needs_review", verificationStatus: "verified", reason: "팔로워 1K 최소조건 미달" };
  }

  if (input.category === "beauty") {
    if (input.reelMetrics.status !== "ready" || input.reelMetrics.average === null) {
      return { discoveryStatus: "needs_review", verificationStatus: "insufficient", reason: "최근 Reels 조회수 검증 필요" };
    }

    if (input.reelMetrics.average < CURRENT_BEAUTY_MIN_REEL_AVERAGE) {
      return { discoveryStatus: "needs_review", verificationStatus: "verified", reason: "최근 Reels 평균 1K 최소조건 미달" };
    }
  }

  return { discoveryStatus: "qualified", verificationStatus: "verified", reason: "현재 최소 모집조건 충족" };
}
