import { getRecommendationAssessment } from "./recommendation";
import type { DiscoveryCandidate } from "./types";

function fixture(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    handle: "fixture_creator", profileUrl: "https://www.instagram.com/fixture_creator/",
    category: "beauty", sourceProvider: "serper", evidenceUrl: "https://www.instagram.com/fixture_creator/",
    evidenceText: "日本人の個人クリエイター。韓国美容と韓国コスメを自分で体験レビュー。2026年9月も投稿。",
    discoveryQuery: null, evidenceKind: "profile", accountAvailability: "active", accountType: "creator",
    koreaAffinity: "strong", contentFit: "beauty", eligibility: "possible", activity: "unknown",
    candidateStatus: "search_qualified", targetSignals: ["日本人"], koreaSignals: ["韓国美容", "K-Beauty"],
    rejectReasons: [], flags: [], duplicateCheckStatus: "not_checked", duplicateCheckMessage: null,
    duplicateCheckedAt: null, bio: null, followers: 8_000, followersSource: "search", reelAverage: null,
    reelMedian: null, reelSampleSize: null, reelCheckedCount: null, reelTotalConsidered: null,
    reelMetricsStatus: "not_checked", reelViews: [], lastActivityAt: null, verificationNote: null,
    verificationStatus: "needs_instagram", verifiedAt: null, discoveredAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

export function runRecommendationSelfCheck() {
  const failures: string[] = [];
  const check = (name: string, condition: boolean) => { if (!condition) failures.push(name); };

  check("recommendation follower 2,999 is ineligible",
    getRecommendationAssessment(fixture({ followers: 2_999 })).tier === "ineligible");
  check("recommendation follower 3,000 with strong fit is eligible",
    ["recommended", "priority"].includes(getRecommendationAssessment(fixture({ followers: 3_000 })).tier));

  const smallHighValue = getRecommendationAssessment(fixture({
    followers: 3_500,
    evidenceText: "韓国在住の日本人個人クリエイター。韓国美容と韓国コスメを体験レビュー。2026年9月も活動。PR案件・提供の相談歓迎。",
    flags: ["commercial:strong", "commercial:korea-access"],
    reelMetricsStatus: "ready", reelAverage: 15000, reelMedian: 14000, reelSampleSize: 8,
  }));
  check("3.5K resident recent PR creator can be priority", smallHighValue.tier === "priority");

  const followerOnly = getRecommendationAssessment(fixture({
    followers: 20_000, koreaAffinity: "yes", koreaSignals: ["韓国"],
    evidenceText: "日本人の個人クリエイター。韓国と美容について発信。",
  }));
  check("20K follower count alone cannot make priority", followerOnly.tier !== "priority");

  const travelOnly = getRecommendationAssessment(fixture({
    followers: 50_000, contentFit: "korea_travel", eligibility: "unknown", candidateStatus: "needs_review",
    evidenceText: "日本人の個人クリエイター。韓国旅行とソウル観光を発信。",
  }));
  check("50K travel-only creator is not beauty recommendation", travelOnly.tier === "review");

  const noPr = getRecommendationAssessment(fixture({ followers: 8_000, flags: [] }));
  check("missing PR signal does not reject strong Korea beauty creator",
    noPr.tier === "recommended" || noPr.tier === "priority");

  const recentUnknown = getRecommendationAssessment(fixture({
    followers: 8_000,
    evidenceText: "日本人の個人クリエイター。韓国美容と韓国コスメを自分で体験レビュー。",
  }));
  check("unknown recent activity does not reject", recentUnknown.tier === "recommended");

  check("business account is recommendation-ineligible", getRecommendationAssessment(fixture({
    accountType: "business", eligibility: "fail", candidateStatus: "hard_reject",
  })).tier === "ineligible");
  check("salon self-business remains recommendation-ineligible", getRecommendationAssessment(fixture({
    accountType: "business", eligibility: "fail", candidateStatus: "hard_reject",
    evidenceText: "美容室代表・サロン運営・ご予約はDM。韓国美容も紹介。",
  })).tier === "ineligible");

  const unknownFollowers = getRecommendationAssessment(fixture({ followers: null, followersSource: null }));
  check("unknown followers stay review before strong recommendation", unknownFollowers.tier === "review");

  const lowQuality = getRecommendationAssessment(fixture({
    followers: 20_000, koreaAffinity: "yes", koreaSignals: ["韓国"],
    evidenceText: "日本人の個人クリエイター。韓国と美容について発信。",
  }));
  const highValue = getRecommendationAssessment(fixture({
    followers: 12_000,
    evidenceText: "韓国在住の日本人個人クリエイター。韓国美容と韓国コスメを体験レビュー。2026年9月も活動。PR案件・提供の相談歓迎。",
    flags: ["commercial:strong", "commercial:korea-access"],
    reelMetricsStatus: "ready", reelAverage: 15000, reelMedian: 14000, reelSampleSize: 8,
  }));
  check("quality score outranks novelty-only low quality", highValue.recommendationScore > lowQuality.recommendationScore);
  check("high-value new candidate can rank at top", highValue.tier === "priority");

  const smallEvidence = "韓国在住の日本人ママ。日常とファッション。韓国コスメを体験レビュー。";
  check("strong sub-3K creator remains reviewable", getRecommendationAssessment(fixture({
    followers: 1734, evidenceText: smallEvidence, candidateStatus: "needs_review",
  })).tier === "review");
  check("profile copy alone cannot earn priority", getRecommendationAssessment(fixture({
    evidenceText: smallEvidence, flags: ["commercial:strong"],
  })).tier !== "priority");
  return failures;
}
