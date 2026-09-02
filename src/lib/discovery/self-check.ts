import { extractInstagramCandidate } from "./instagram";
import { assessCandidate } from "./quality";
import { decideVerification } from "@/lib/verification/decision";
import { computeReelMetrics } from "@/lib/verification/metrics";

export function runQualitySelfCheck() {
  const failures: string[] = [];

  check("popular route blocked", extractInstagramCandidate("https://www.instagram.com/popular/", "", "") === null);
  check("tag mention not promoted", extractInstagramCandidate(
    "https://www.instagram.com/p/C-hkMJWhcd6/",
    "Photo shared by 韓国コスメ｜美容トレンド tagging @roundlab.jp",
    "@dr.g_official_jp @roundlab.jp",
  ) === null);
  check("direct profile accepted", extractInstagramCandidate("https://www.instagram.com/ayamitakagi325/", "", "")?.handle === "ayamitakagi325");
  check("invalid trailing dot blocked", extractInstagramCandidate("https://www.instagram.com/roundlab.jp./", "", "") === null);
  check("nonstandard nested profile path blocked", extractInstagramCandidate(
    "https://www.instagram.com/someone/reel/ABC/",
    "",
    "Never miss a post from michan.koreaholic. Sign up for Instagram to stay in the loop.",
  ) === null);
  check("content owner extracted only on content route", extractInstagramCandidate(
    "https://www.instagram.com/reel/ABC/",
    "",
    "Never miss a post from michan.koreaholic. Sign up for Instagram to stay in the loop.",
  )?.handle === "michan.koreaholic");

  const doctor = assessCandidate({
    handle: "hanafusahifuka",
    evidenceKind: "profile",
    title: "Dr.Hizuki Hanafusa",
    text: "ニキビ跡・毛穴治療 美容皮膚科経営 首都圏、関西に17院展開 東大医学部卒",
    category: "beauty",
    accountAvailability: "active",
  });
  check("doctor hard rejected", doctor.candidateStatus === "hard_reject" && doctor.accountType === "business");

  const hospital = assessCandidate({
    handle: "idhospitalkorea",
    evidenceKind: "content",
    title: "Korean beauty",
    text: "日本向け韓国美容コンテンツ",
    category: "beauty",
    accountAvailability: "active",
  });
  check("hospital handle hard rejected", hospital.candidateStatus === "hard_reject");

  const business = assessCandidate({
    handle: "korea_hadakanri_nsaas",
    evidenceKind: "profile",
    title: "韓国肌管理",
    text: "日本に肌管理を持って来た私たち 韓国人施術者 創業10年 ビジネスサービス",
    category: "beauty",
    accountAvailability: "active",
  });
  check("business hard rejected", business.candidateStatus === "hard_reject" && business.accountType === "business");

  const oliveYoung = assessCandidate({
    handle: "oliveyoung_japan",
    evidenceKind: "profile",
    title: "OLIVE YOUNG JAPAN",
    text: "韓国コスメ 美容 スキンケア",
    category: "beauty",
    accountAvailability: "active",
  });
  check("known Olive Young official handle rejected", oliveYoung.candidateStatus === "hard_reject");

  const creator = assessCandidate({
    handle: "ayamitakagi325",
    evidenceKind: "profile",
    title: "Ayami 韓国在住 韓国美容 韓国旅行",
    text: "Japan→Seoul 在韓8年目 リアルな韓国を発信 美容・グルメ 韓国美容 皮膚科 コスメ",
    category: "beauty",
    accountAvailability: "active",
  });
  check("known creator becomes recommended without Reel metrics", creator.candidateStatus === "search_qualified" && creator.eligibility === "possible");

  const availabilityUnknown = assessCandidate({
    handle: "sample_creator",
    evidenceKind: "profile",
    title: "韓国在住日本人",
    text: "韓国在住の日本人 美容好き ブロガー 韓国コスメを発信",
    category: "beauty",
    accountAvailability: "unknown",
  });
  check("unknown account availability stays review", availabilityUnknown.candidateStatus === "needs_review");

  const unavailable = assessCandidate({
    handle: "gone_creator",
    evidenceKind: "profile",
    title: "韓国在住日本人",
    text: "韓国在住の日本人 美容好き ブロガー 韓国コスメを発信",
    category: "beauty",
    accountAvailability: "unavailable",
  });
  check("unavailable account is rejected", unavailable.candidateStatus === "hard_reject");

  const mergedCreator = assessCandidate({
    handle: "sample_creator",
    evidenceKind: "profile",
    title: "",
    profileText: "韓国在住の日本人 美容好き ブロガー 韓国コスメを発信",
    text: "韓国在住の日本人 美容好き ブロガー 韓国コスメを発信 クリニック公式アカウントの施術を体験",
    category: "beauty",
    accountAvailability: "active",
  });
  check("content business mention does not poison clean profile", mergedCreator.candidateStatus === "search_qualified");

  const contentOnly = assessCandidate({
    handle: "somecreator",
    evidenceKind: "content",
    title: "韓国在住日本人の韓国美容リール",
    text: "韓国美容とコスメが好きな日本人クリエイターの投稿です",
    category: "beauty",
    accountAvailability: "active",
  });
  check("content-only result stays review", contentOnly.candidateStatus === "needs_review" && contentOnly.accountType === "unknown");

  const metrics = computeReelMetrics([
    { url: "r1", postedAt: "2026-08-30", views: 1000 },
    { url: "r2", postedAt: "2026-08-29", views: 2000 },
    { url: "r3", postedAt: "2026-08-28", views: 3000 },
    { url: "r4", postedAt: "2026-08-27", views: 4000 },
    { url: "r5", postedAt: "2026-08-26", views: 5000 },
    { url: "r6", postedAt: "2026-08-25", views: null },
  ]);
  check("Reel arithmetic mean computed by app", metrics.average === 3000 && metrics.sampleSize === 5 && metrics.totalConsidered === 6);
  check("missing Reel view stays insufficient", metrics.status === "insufficient");

  const lowAccountMetrics = computeReelMetrics([
    { url: "a1", postedAt: null, views: 370 },
    { url: "a2", postedAt: null, views: 455 },
    { url: "a3", postedAt: null, views: 1695 },
    { url: "a4", postedAt: null, views: 497 },
    { url: "a5", postedAt: null, views: 1680 },
    { url: "a6", postedAt: null, views: 509 },
    { url: "a7", postedAt: null, views: 760 },
    { url: "a8", postedAt: null, views: 610 },
    { url: "a9", postedAt: null, views: 252 },
  ]);
  check("latest six Reel arithmetic mean is 868 rounded", lowAccountMetrics.average === 868 && lowAccountMetrics.sampleSize === 6 && lowAccountMetrics.totalConsidered === 6 && lowAccountMetrics.status === "ready");

  const lowAccountDecision = decideVerification({
    category: "beauty",
    duplicateStatus: "available",
    exists: true,
    isPrivate: false,
    isPersonalCreator: true,
    followers: 35,
    recentActivity: true,
    japaneseTarget: true,
    koreaConnection: true,
    categoryRelevant: true,
    reelMetrics: lowAccountMetrics,
  });
  check("35 follower account can never be qualified", lowAccountDecision.discoveryStatus === "hard_reject");

  const duplicateDecision = decideVerification({
    category: "beauty",
    duplicateStatus: "duplicate",
    exists: null,
    isPrivate: null,
    isPersonalCreator: null,
    followers: null,
    recentActivity: null,
    japaneseTarget: null,
    koreaConnection: null,
    categoryRelevant: null,
    reelMetrics: computeReelMetrics([]),
  });
  check("FixUp duplicate never reaches Instagram qualification", duplicateDecision.discoveryStatus === "hard_reject");

  return { ok: failures.length === 0, failures };

  function check(name: string, condition: boolean) {
    if (!condition) failures.push(name);
  }
}
