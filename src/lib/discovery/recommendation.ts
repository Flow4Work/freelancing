import { hasStrongSmallCreatorEvidence } from "./quality";
import { getFollowerPolicyRejection, MAX_TARGET_FOLLOWERS_EXCLUSIVE, MIN_TARGET_FOLLOWERS } from "@/lib/verification/policy";
import type { DiscoveryCandidate } from "./types";

export type RecommendationTier = "priority" | "recommended" | "review" | "ineligible";
export type RecommendationStrength = "strong" | "yes" | "weak" | "unknown";
export type FollowerBand =
  | "under_3k"
  | "3k_5k"
  | "5k_30k"
  | "30k_50k"
  | "50k_100k"
  | "100k_plus"
  | "unknown";

export type RecommendationAssessment = {
  tier: RecommendationTier;
  followerBand: FollowerBand;
  koreaStrength: DiscoveryCandidate["koreaAffinity"];
  beautyStrength: RecommendationStrength;
  creatorStrength: RecommendationStrength;
  recentActivitySignal: RecommendationStrength;
  commercialIntentSignal: RecommendationStrength;
  koreaAccessSignal: RecommendationStrength;
  profileEvidenceStrength: RecommendationStrength;
  recommendationScore: number;
  recommendationReasons: string[];
  recommendationWeaknesses: string[];
};
const EXPLICIT_CREATOR = /(?:個人(?:クリエイター|アカウント|ブログ)|クリエイター|インフルエンサー|ブロガー|美容家|ライター|UGC|VLOG|会社員|OL|主婦|ママ|留学生|ワーホリ|日韓夫婦)/i;
const DIRECT_K_BEAUTY = /(?:韓国美容|美容渡韓|韓国コスメ|K-?Beauty|韓国スキンケア|オリーブヤング|韓国(?:皮膚科|クリニック|美容医療|薬局)|肌管理)/i;
const BEAUTY_EXPERIENCE = /(?:レビュー|体験|使用|使って|使い|購入|購入品|愛用|使い切り|リピ(?:ート|買い)?|受け(?:た|て)|施術|経過|紹介|投稿)/i;
const FOOD_DIRECT = /(?:韓国グルメ|ソウルグルメ|韓国カフェ|食べ歩き|韓国料理|カフェ巡り|実食|食レポ)/i;
const RECENT_EVIDENCE = /(?:2026年|2026[./-]\d|今月|今週|最近|今日|昨日|\d+\s*(?:時間|日|週間)前|\b(?:hours?|days?|weeks?)\s+ago\b)/i;
const COMMERCIAL_STRONG = /(?:有償PR|タイアップ|アンバサダー|案件(?:依頼)?|お仕事(?:の)?依頼|PR依頼|提供(?:品|いただ|案件)?|gifted|collab(?:oration)?)/i;
const COMMERCIAL_LIGHT = /(?:#PR\b|\bPR\b|広告|協業|コラボ)/i;
const KOREA_ACCESS_STRONG = /(?:韓国在住|在韓|毎月.{0,10}(?:渡韓|韓国)|月\s*\d+.{0,10}(?:渡韓|韓国)|何度も渡韓|頻繁に渡韓|渡韓\s*\d+\s*(?:回|回目|回以上))/i;
const KOREA_ACCESS_LIGHT = /(?:渡韓予定|最近.{0,10}渡韓|韓国旅行|ソウル旅行|釜山旅行|訪韓)/i;

export function getFollowerBand(followers: number | null): FollowerBand {
  if (followers === null) return "unknown";
  if (followers < MIN_TARGET_FOLLOWERS) return "under_3k";
  if (followers < 5_000) return "3k_5k";
  if (followers < 30_000) return "5k_30k";
  if (followers < 50_000) return "30k_50k";
  if (followers < MAX_TARGET_FOLLOWERS_EXCLUSIVE) return "50k_100k";
  return "100k_plus";
}

export function getRecommendationAssessment(candidate: DiscoveryCandidate): RecommendationAssessment {
  const text = [candidate.bio ?? "", candidate.evidenceText, ...candidate.flags].join("\n");
  const followerBand = getFollowerBand(candidate.followers);
  const creatorStrength = getCreatorStrength(candidate, text);
  const beautyStrength = getCategoryStrength(candidate, text);
  const recentActivitySignal = getRecentActivityStrength(candidate, text);
  const commercialIntentSignal = getCommercialStrength(candidate, text);
  const koreaAccessSignal = getKoreaAccessStrength(candidate, text);
  const profileEvidenceStrength = getProfileEvidenceStrength(candidate);
  const koreaStrength = candidate.koreaAffinity;

  let score = 0;
  score += strengthScore(creatorStrength, 18, 12, 5);
  score += koreaStrength === "strong" ? 20 : koreaStrength === "yes" ? 12 : 0;
  score += strengthScore(beautyStrength, 22, 12, 4);
  score += strengthScore(recentActivitySignal, 12, 7, 0);
  score += strengthScore(commercialIntentSignal, 12, 7, 0);
  score += strengthScore(koreaAccessSignal, 12, 7, 0);
  score += strengthScore(profileEvidenceStrength, 8, 5, 2);
  score += followerScore(followerBand);
  if (candidate.accountAvailability === "active") score += 2;

  const reasons = buildReasons({
    followerBand, koreaStrength, beautyStrength, creatorStrength, recentActivitySignal,
    commercialIntentSignal, koreaAccessSignal, profileEvidenceStrength,
  });
  const weaknesses = buildWeaknesses({
    followerBand, koreaStrength, beautyStrength, creatorStrength, recentActivitySignal,
    commercialIntentSignal, profileEvidenceStrength,
  });

  const followerRejection = getFollowerPolicyRejection(candidate.category, candidate.followers);
  const basicEligible = candidate.accountType === "creator"
    && candidate.targetSignals.length > 0
    && (candidate.koreaAffinity === "strong" || candidate.koreaAffinity === "yes")
    && candidate.contentFit === candidate.category
    && candidate.eligibility === "possible"
    && candidate.accountAvailability !== "unavailable";

  let tier: RecommendationTier = "review";
  if (
    candidate.candidateStatus === "hard_reject"
    || candidate.accountType === "business"
    || candidate.accountAvailability === "unavailable"
    || (followerRejection && !(followerRejection === "under_min" && hasStrongSmallCreatorEvidence(candidate, text)))
  ) {
    tier = "ineligible";
  } else if (!basicEligible || candidate.followers === null || followerBand === "under_3k" || candidate.candidateStatus === "needs_review") {
    tier = "review";
  } else if (
    candidate.reelMetricsStatus === "ready"
    && candidate.reelAverage !== null && candidate.reelMedian !== null
    && (candidate.reelSampleSize ?? 0) >= 3
    && candidate.reelAverage >= Math.max(1000, candidate.followers)
    && candidate.reelMedian >= Math.max(1000, candidate.followers * 0.5)
    && score >= 92
    && koreaStrength === "strong"
    && beautyStrength === "strong"
    && recentActivitySignal !== "unknown"
    && (commercialIntentSignal !== "unknown" || koreaAccessSignal !== "unknown" || creatorStrength === "strong")
  ) {
    tier = "priority";
  } else if (score >= 52) {
    tier = "recommended";
  } else {
    tier = "review";
  }
  return {
    tier,
    followerBand,
    koreaStrength,
    beautyStrength,
    creatorStrength,
    recentActivitySignal,
    commercialIntentSignal,
    koreaAccessSignal,
    profileEvidenceStrength,
    recommendationScore: score,
    recommendationReasons: reasons,
    recommendationWeaknesses: weaknesses,
  };
}

function getCreatorStrength(candidate: DiscoveryCandidate, text: string): RecommendationStrength {
  if (candidate.accountType !== "creator") return candidate.accountType === "unknown" ? "unknown" : "weak";
  if (candidate.evidenceKind === "profile" && EXPLICIT_CREATOR.test(text)) return "strong";
  if (candidate.evidenceKind === "profile") return "yes";
  return "weak";
}

function getCategoryStrength(candidate: DiscoveryCandidate, text: string): RecommendationStrength {
  if (candidate.category === "beauty") {
    if (DIRECT_K_BEAUTY.test(text) && BEAUTY_EXPERIENCE.test(text)) return "strong";
    if (DIRECT_K_BEAUTY.test(text) && candidate.koreaSignals.length >= 2) return "strong";
    return candidate.contentFit === "beauty" ? "yes" : "unknown";
  }
  if (FOOD_DIRECT.test(text) && BEAUTY_EXPERIENCE.test(text)) return "strong";
  return candidate.contentFit === "food" ? "yes" : "unknown";
}

function getRecentActivityStrength(candidate: DiscoveryCandidate, text: string): RecommendationStrength {
  if (candidate.lastActivityAt) {
    const timestamp = Date.parse(candidate.lastActivityAt);
    if (Number.isFinite(timestamp)) {
      const ageMs = Date.now() - timestamp;
      if (ageMs >= 0 && ageMs <= 90 * 24 * 60 * 60 * 1000) return "strong";
    }
  }
  if (candidate.activity === "active") return "yes";
  return RECENT_EVIDENCE.test(text) ? "yes" : "unknown";
}

function getCommercialStrength(candidate: DiscoveryCandidate, text: string): RecommendationStrength {
  if (
    candidate.flags.includes("commercial:strong")
    || candidate.flags.includes("commercial:korea-sponsored")
    || COMMERCIAL_STRONG.test(text)
  ) return "strong";
  if (candidate.flags.includes("commercial:contact") || COMMERCIAL_LIGHT.test(text)) return "yes";
  return "unknown";
}

function getKoreaAccessStrength(candidate: DiscoveryCandidate, text: string): RecommendationStrength {
  if (candidate.flags.includes("commercial:korea-access") || KOREA_ACCESS_STRONG.test(text)) return "strong";
  if (KOREA_ACCESS_LIGHT.test(text)) return "yes";
  return "unknown";
}

function getProfileEvidenceStrength(candidate: DiscoveryCandidate): RecommendationStrength {
  if (candidate.evidenceKind !== "profile") return "weak";
  if (candidate.targetSignals.length > 0 && candidate.koreaSignals.length > 0) return "strong";
  return "yes";
}

function strengthScore(value: RecommendationStrength, strong: number, yes: number, weak: number) {
  if (value === "strong") return strong;
  if (value === "yes") return yes;
  if (value === "weak") return weak;
  return 0;
}

function followerScore(band: FollowerBand) {
  if (band === "3k_5k") return 5;
  if (band === "5k_30k") return 14;
  if (band === "30k_50k") return 13;
  if (band === "50k_100k") return 10;
  return 0;
}

function buildReasons(input: {
  followerBand: FollowerBand;
  koreaStrength: DiscoveryCandidate["koreaAffinity"];
  beautyStrength: RecommendationStrength;
  creatorStrength: RecommendationStrength;
  recentActivitySignal: RecommendationStrength;
  commercialIntentSignal: RecommendationStrength;
  koreaAccessSignal: RecommendationStrength;
  profileEvidenceStrength: RecommendationStrength;
}) {
  const reasons: string[] = [];
  if (input.creatorStrength === "strong") reasons.push("개인 creator 근거 강함");
  if (input.koreaStrength === "strong") reasons.push("Korea affinity strong");
  else if (input.koreaStrength === "yes") reasons.push("Korea affinity 확인");
  if (input.beautyStrength === "strong") reasons.push("K-Beauty 직접 근거 강함");
  else if (input.beautyStrength === "yes") reasons.push("Beauty 직접 근거 있음");
  if (input.recentActivitySignal !== "unknown") reasons.push("최근 활동 근거");
  if (input.commercialIntentSignal !== "unknown") reasons.push("PR/협업 신호");
  if (input.koreaAccessSignal !== "unknown") reasons.push("한국 접근 가능성 신호");
  if (input.followerBand !== "unknown" && input.followerBand !== "under_3k" && input.followerBand !== "100k_plus") {
    reasons.push(`follower ${input.followerBand}`);
  }
  if (input.profileEvidenceStrength === "strong") reasons.push("프로필 근거 강함");
  return reasons;
}

function buildWeaknesses(input: {
  followerBand: FollowerBand;
  koreaStrength: DiscoveryCandidate["koreaAffinity"];
  beautyStrength: RecommendationStrength;
  creatorStrength: RecommendationStrength;
  recentActivitySignal: RecommendationStrength;
  commercialIntentSignal: RecommendationStrength;
  profileEvidenceStrength: RecommendationStrength;
}) {
  const weaknesses: string[] = [];
  if (input.followerBand === "unknown") weaknesses.push("follower 미확인");
  if (input.koreaStrength !== "strong") weaknesses.push("Korea strength 보통/미확인");
  if (input.beautyStrength !== "strong") weaknesses.push("K-Beauty 직접성 추가확인");
  if (input.creatorStrength !== "strong") weaknesses.push("creator strength 추가확인");
  if (input.recentActivitySignal === "unknown") weaknesses.push("최근 활동 미확인");
  if (input.commercialIntentSignal === "unknown") weaknesses.push("PR/협업 신호 미확인");
  if (input.profileEvidenceStrength === "weak") weaknesses.push("프로필 근거 약함");
  return weaknesses;
}
