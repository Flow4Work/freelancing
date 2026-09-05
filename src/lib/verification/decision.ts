import type { DuplicateCheckStatus, SearchCategory } from "@/lib/discovery/types";
import { getFollowerPolicyRejection, MAX_TARGET_FOLLOWERS_EXCLUSIVE, MIN_TARGET_FOLLOWERS } from "./policy";
import type { ReelMetrics } from "./metrics";

export type FinalPriority = "1순위" | "2순위" | "3순위" | "제외";

export type VerificationDecisionInput = {
  category: SearchCategory;
  duplicateStatus: DuplicateCheckStatus;
  exists: boolean | null;
  isPrivate: boolean | null;
  isPersonalCreator: boolean | null;
  bio?: string | null;
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

  const followerRejection = getFollowerPolicyRejection(input.followers);
  if (followerRejection === "under_min") {
    return {
      discoveryStatus: "hard_reject",
      verificationStatus: "rejected",
      reason: `팔로워 ${MIN_TARGET_FOLLOWERS.toLocaleString()} 미만`,
    };
  }
  if (followerRejection === "over_max") {
    return {
      discoveryStatus: "hard_reject",
      verificationStatus: "rejected",
      reason: `팔로워 ${MAX_TARGET_FOLLOWERS_EXCLUSIVE.toLocaleString()} 이상`,
    };
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

  const coreUnknown = input.exists === null
    || input.isPrivate === null
    || input.isPersonalCreator === null
    || input.japaneseTarget === null
    || input.koreaConnection === null
    || input.categoryRelevant === null
    || input.followers === null;

  if (coreUnknown) {
    return { discoveryStatus: "needs_review", verificationStatus: "insufficient", reason: "검증값 일부 확인 불가" };
  }

  // Reels 조회수가 실제로 확보되지 않으면 낮은 성과로 추정하지 않고 재검증으로 남긴다.
  if (input.reelMetrics.status !== "ready" || input.reelMetrics.average === null) {
    return { discoveryStatus: "needs_review", verificationStatus: "insufficient", reason: "최근 Reels 조회수 검증 필요" };
  }

  const followers = input.followers!;
  const priority = classifyFinalPriority({
    category: input.category,
    followers,
    reelAverage: input.reelMetrics.average,
    bio: input.bio ?? null,
  });

  if (priority === "제외") {
    const reason = followers < MIN_TARGET_FOLLOWERS
      ? `제외 · 팔로워 ${MIN_TARGET_FOLLOWERS.toLocaleString()} 미만`
      : "제외 · 최근 Reels 평균 1K 미만";
    return { discoveryStatus: "hard_reject", verificationStatus: "verified", reason };
  }

  return { discoveryStatus: "qualified", verificationStatus: "verified", reason: `${priority} · 최종 검증 완료` };
}

export function classifyFinalPriority(input: {
  category: SearchCategory;
  followers: number;
  reelAverage: number;
  bio: string | null;
}): FinalPriority {
  const { category, followers, reelAverage, bio } = input;

  if (followers < MIN_TARGET_FOLLOWERS || reelAverage < 1000) return "제외";

  const firstPriority = category === "beauty"
    && hasExplicitFemaleSignal(bio)
    && followers >= 10000
    && followers <= 20000
    && reelAverage >= 10000;
  if (firstPriority) return "1순위";

  // 기존 2순위 규칙 중 현재 10K 하한과 겹치는 경계값만 보존한다.
  if (followers === MIN_TARGET_FOLLOWERS && reelAverage >= 2000) {
    return "2순위";
  }

  if (followers >= MIN_TARGET_FOLLOWERS && reelAverage >= 1000 && reelAverage < 10000) {
    return "3순위";
  }

  // 제외 기준은 아니지만 1/2순위 조건에도 들지 않는 검증 완료 후보는 기존과 동일하게 3순위로 둔다.
  return "3순위";
}

function hasExplicitFemaleSignal(bio: string | null) {
  if (!bio) return false;
  return /(女性|女子|主婦|ママ|母|妻|여성|여자|주부|엄마|female|woman|mom|mother)/i.test(bio);
}
