import { hasStrongKoreaAccess, hasActualKBeautyContent } from "@/lib/discovery/quality";
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
  creatorSignals: string[];
  targetSignals: string[];
  koreaSignals: string[];
  categorySignals: string[];
  reelMetrics: ReelMetrics;
  note?: string | null;
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

  const identityConflict = detectObviousNonTargetIdentity(input);
  if (identityConflict === "reject") {
    return { discoveryStatus: "hard_reject", verificationStatus: "rejected", reason: "명백한 사업체/유흥업 자기영업 계정" };
  }

  const followerRejection = getFollowerPolicyRejection(input.category, input.followers);
  const evidenceText = [input.bio ?? "", ...input.creatorSignals, ...input.koreaSignals, ...input.categorySignals].join("\n");
  const smallCreatorEvidence = followerRejection === "under_min"
    && input.isPersonalCreator === true && input.japaneseTarget === true
    && input.koreaConnection === true && input.categoryRelevant === true
    && input.creatorSignals.length > 0 && input.targetSignals.length > 0
    && input.koreaSignals.length > 0 && input.categorySignals.length > 0;
  const smallCreatorReview = smallCreatorEvidence
    && hasStrongKoreaAccess(evidenceText) && hasActualKBeautyContent(evidenceText);
  if (followerRejection === "under_min" && !smallCreatorReview) {
    if (smallCreatorEvidence && hasIncompleteVerificationNote(input.note) && /예외\s*충족/.test(input.note ?? "")) {
      return { discoveryStatus: "needs_review", verificationStatus: "insufficient", reason: "소규모 creator 예외 근거 확인 후 Reels 재검증 필요" };
    }
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

  if (identityConflict === "review") {
    return { discoveryStatus: "needs_review", verificationStatus: "insufficient", reason: "개인 creator와 자기영업 성격이 혼재해 추가 확인 필요" };
  }

  if (input.isPersonalCreator === true && input.creatorSignals.length === 0) {
    return { discoveryStatus: "needs_review", verificationStatus: "insufficient", reason: "개인 creator 판정의 Instagram 근거 없음" };
  }
  if (input.japaneseTarget === true && input.targetSignals.length === 0) {
    return { discoveryStatus: "needs_review", verificationStatus: "insufficient", reason: "일본 타깃 판정의 Instagram 근거 없음" };
  }
  if (input.koreaConnection === true && input.koreaSignals.length === 0) {
    return { discoveryStatus: "needs_review", verificationStatus: "insufficient", reason: "한국 접점 판정의 Instagram 근거 없음" };
  }
  if (input.categoryRelevant === true && input.categorySignals.length === 0) {
    return { discoveryStatus: "needs_review", verificationStatus: "insufficient", reason: "카테고리 적합 판정의 Instagram 근거 없음" };
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

  if (smallCreatorReview) {
    const ratio = input.followers! > 0 ? (input.reelMetrics.average / input.followers!).toFixed(2) : "확인 불가";
    return { discoveryStatus: "needs_review", verificationStatus: "insufficient",
      reason: `3K 미만 예외 검토 · Reels ${input.reelMetrics.sampleSize}개 / 평균 ${input.reelMetrics.average} / 중앙 ${input.reelMetrics.median} / 팔로워 대비 ${ratio}배` };
  }
  const followers = input.followers!;
  const priority = classifyFinalPriority({
    category: input.category,
    followers,
    reelAverage: input.reelMetrics.average,
    bio: input.bio ?? null,
  });

  if (priority === "\uc81c\uc678") {
    const reason = followers < 1000
      ? "\uc81c\uc678 \xb7 \ud314\ub85c\uc6cc 1K \ubbf8\ub9cc"
      : "\uc81c\uc678 \xb7 \ucd5c\uadfc Reels \ud3c9\uade0 1K \ubbf8\ub9cc";
    return { discoveryStatus: "hard_reject", verificationStatus: "verified", reason };
  }

  return { discoveryStatus: "qualified", verificationStatus: "verified", reason: `${priority} \xb7 \ucd5c\uc885 \uac80\uc99d \uc644\ub8cc` };
}

export function classifyFinalPriority(input: {
  category: SearchCategory;
  followers: number;
  reelAverage: number;
  bio: string | null;
}): FinalPriority {
  const { category, followers, reelAverage, bio } = input;

  if (followers < 1000 || reelAverage < 1000) return "\uc81c\uc678";
  if (category === "beauty" && followers < MIN_TARGET_FOLLOWERS) return "\uc81c\uc678";

  const firstPriority = (
    category === "food"
    && followers >= 3000
    && followers <= 7000
    && reelAverage >= 3000
  ) || (
    category === "beauty"
    && hasExplicitFemaleSignal(bio)
    && followers >= 10000
    && followers <= 20000
    && reelAverage >= 10000
  );
  if (firstPriority) return "1\uc21c\uc704";

  if (followers >= 2000 && followers <= 10000 && reelAverage >= 2000) {
    return "2\uc21c\uc704";
  }

  if (
    (followers >= 1000 && followers <= 3000 && reelAverage >= 1000)
    || (followers >= 10000 && reelAverage >= 1000 && reelAverage < 10000)
    || (category === "food" && followers >= 3000 && followers <= 7000 && reelAverage >= 1000 && reelAverage < 3000)
  ) {
    return "3\uc21c\uc704";
  }

  return "3\uc21c\uc704";
}
function hasIncompleteVerificationNote(note: string | null | undefined) {
  if (!note) return false;
  return /확인\s*(?:실패|불가)|로딩\s*실패|조회수.{0,20}(?:확인\s*불가|미수집)|reels?.{0,20}(?:실패|미수집|불가)|재검증\s*필요|tool.{0,12}fail|browser.{0,12}error|timeout/i.test(note);
}

function hasExplicitFemaleSignal(bio: string | null) {
  if (!bio) return false;
  return /(女性|女子|主婦|ママ|母|妻|여성|여자|주부|엄마|female|woman|mom|mother)/i.test(bio);
}
function detectObviousNonTargetIdentity(input: VerificationDecisionInput): "reject" | "review" | null {
  const evidence = [input.bio ?? "", ...input.creatorSignals]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!evidence) return null;

  const nightlife = /(?:ホスト|ホストクラブ|host\s*club|キャバクラ|夜職|ゲスト出勤|指名\s*(?:DM|予約)|nightlife)/i;
  if (nightlife.test(evidence)) return "reject";

  const officialInstitution = /(?:公式(?:アカウント|Instagram|インスタグラム)|official).{0,60}(?:株式会社|会社|ブランド|クリニック|病院|医院|大学|学校|協会|航空会社)|(?:株式会社|医療法人|学校法人|一般社団法人|大学|学校|協会|航空会社).{0,60}(?:公式|official|採用|求人)/i;
  if (officialInstitution.test(evidence)) return "reject";

  const ownerOrManager = /(?:代表取締役|代表|オーナー|owner|CEO|経営|店長)/i;
  const salonBusiness = /(?:美容室|ヘアサロン|サロン|salon|\d+\s*店舗|採用|求人|スタッフ募集|中途(?:スタイリスト|アシスタント)|予約受付|ご予約)/i;
  const hairJob = /(?:美容師|ヘアデザイナー|スタイリスト|hair\s*stylist|hairdresser)/i;
  const serviceCta = /(?:ご予約|予約受付|指名|採用|求人|スタッフ募集|recruit|booking)/i;
  const selfBusiness = (ownerOrManager.test(evidence) && salonBusiness.test(evidence))
    || (hairJob.test(evidence) && salonBusiness.test(evidence) && serviceCta.test(evidence));
  if (!selfBusiness) return null;

  const strongPersonalFit = input.creatorSignals.length > 0
    && input.koreaSignals.length > 0
    && input.categorySignals.length > 0;
  const personalContentMain = /日常|暮らし|ファッション|コーデ|私の|個人レビュー|VLOG/i.test(evidence);
  const contentEvidence = [evidence, ...input.koreaSignals, ...input.categorySignals].join("\n");
  if (strongPersonalFit && personalContentMain && input.isPersonalCreator === true
    && input.japaneseTarget === true && input.targetSignals.length > 0
    && hasStrongKoreaAccess(contentEvidence) && hasActualKBeautyContent(contentEvidence)
    && !serviceCta.test(evidence)) return null;
  return strongPersonalFit ? "review" : "reject";
}
