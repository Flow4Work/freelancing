import { extractExaInstagramCandidate, extractInstagramCandidate, getInstagramExtractionFailureReason } from "./instagram";
import { evaluateQueryFamily, extractFollowerCount, getDiscoveryFollowerRejection, getGoogleFollowUpPriority, shouldFollowUpGoogleLane, getStandardFollowUpPriority, googleLaneKey, isCategoryEvidenceEnrichmentEligible, takeGoogleWave } from "./orchestrator";
import type { RawSearchResult, SearchProvider } from "./types";
import { assessCandidate, hasStrongSmallCreatorEvidence } from "./quality";
import { assessDiscoveryCandidate, getTavilyObviousBusinessProfileReason, hasExaJapanTargetEvidence } from "./discovery-quality";
import { classifyFinalPriority, decideVerification } from "@/lib/verification/decision";
import { computeReelMetrics } from "@/lib/verification/metrics";
import { runRecommendationSelfCheck } from "./recommendation-self-check";

export function runQualitySelfCheck() {
  const failures: string[] = [];

  check("popular route blocked", extractInstagramCandidate("https://www.instagram.com/popular/", "", "") === null);
  check("tag mention not promoted", extractInstagramCandidate(
    "https://www.instagram.com/p/C-hkMJWhcd6/",
    "Photo shared by 韓国コスメ｜美容トレンド tagging @roundlab.jp",
    "@dr.g_official_jp @roundlab.jp",
  ) === null);
  check("direct profile accepted", extractInstagramCandidate("https://www.instagram.com/ayamitakagi325/", "", "")?.handle === "ayamitakagi325");
  check("direct post without SEO owner stays owner_unresolved",
    getInstagramExtractionFailureReason("https://www.instagram.com/p/ABC123", "", "") === "owner_unresolved"
      && getInstagramExtractionFailureReason("https://www.instagram.com/reel/ABC123", "", "") === "owner_unresolved");
  check("follower parser prefers followers over following",
    extractFollowerCount("23K followers · 880 following · 205 posts") === 23000
      && extractFollowerCount("5.3K followers · 804 following") === 5300
      && extractFollowerCount("66K followers · 0 following") === 66000
      && extractFollowerCount("2.1K+ followers · 7K+ following") === 2100);
  check("Exa nested post URL recovers provisional owner", extractExaInstagramCandidate(
    "https://www.instagram.com/example/p/ABC123", "", "",
  )?.handle === "example");
  check("Exa nested reel URL recovers provisional owner", extractExaInstagramCandidate(
    "https://www.instagram.com/example/reel/ABC123", "", "",
  )?.handle === "example");
  check("Exa direct post URL does not invent owner", extractExaInstagramCandidate(
    "https://www.instagram.com/p/ABC123", "", "",
  ) === null);
  check("Exa direct reel URL does not invent owner", extractExaInstagramCandidate(
    "https://www.instagram.com/reel/ABC123", "", "",
  ) === null);
  check("Exa nested reserved routes are blocked",
    extractExaInstagramCandidate("https://www.instagram.com/explore/p/ABC123", "", "") === null
      && extractExaInstagramCandidate("https://www.instagram.com/accounts/p/ABC123", "", "") === null
      && extractExaInstagramCandidate("https://www.instagram.com/settings/reel/ABC123", "", "") === null);
  check("Exa arbitrary deeper nested route is blocked", extractExaInstagramCandidate(
    "https://www.instagram.com/example/reel/ABC123/extra", "", "",
  ) === null);
  check("Exa comment mention does not become owner", extractExaInstagramCandidate(
    "https://www.instagram.com/reel/ABC123", "", "댓글 @mentioned_user 韓国美容",
  ) === null);
  check("Exa Follow label does not become owner", extractExaInstagramCandidate(
    "https://www.instagram.com/reel/ABC123", "", "comment_writer • Follow 韓国コスメ",
  ) === null);
  check("invalid trailing dot blocked", extractInstagramCandidate("https://www.instagram.com/roundlab.jp./", "", "") === null);
  check("valid nested owner reel path is accepted", extractInstagramCandidate(
    "https://www.instagram.com/someone/reel/ABC/",
    "",
    "Never miss a post from michan.koreaholic. Sign up for Instagram to stay in the loop.",
  )?.handle === "someone");
  check("generic nested reserved routes are blocked",
    extractInstagramCandidate("https://www.instagram.com/explore/p/ABC123", "", "") === null
      && extractInstagramCandidate("https://www.instagram.com/accounts/p/ABC123", "", "") === null
      && extractInstagramCandidate("https://www.instagram.com/settings/reel/ABC123", "", "") === null);
  check("generic arbitrary deeper nested route is blocked", extractInstagramCandidate(
    "https://www.instagram.com/someone/reel/ABC123/extra", "", "",
  ) === null);
  check("content owner extracted only on content route", extractInstagramCandidate(
    "https://www.instagram.com/reel/ABC/",
    "",
    "Never miss a post from michan.koreaholic. Sign up for Instagram to stay in the loop.",
  )?.handle === "michan.koreaholic");

  check("SEO title owner survives nearby comment handles", extractInstagramCandidate(
    "https://www.instagram.com/reel/XYZ/",
    "Mika (@mika_beauty) • Instagram photos and videos",
    "noise_user • Follow @other_commenter 韓国美容",
  )?.handle === "mika_beauty");
  check("comment Follow handle never becomes content owner", extractInstagramCandidate(
    "https://www.instagram.com/reel/COMMENT/",
    "韓国美容のリール",
    "comment_writer • Follow @mentioned_user 韓国コスメ",
  ) === null);

  const officialAirline = assessDiscoveryCandidate({
    handle: "sample_airline",
    evidenceKind: "profile",
    title: "Sample Air",
    text: "日本路線を運航する航空会社 公式アカウント 航空券・フライト予約",
    profileText: "日本路線を運航する航空会社 公式アカウント 航空券・フライト予約",
    category: "beauty",
    accountAvailability: "active",
  });
  check("obvious official airline filtered during discovery", officialAirline === null);

  const chineseJapanResident = assessDiscoveryCandidate({
    handle: "joytvhk", evidenceKind: "profile", title: "東京生活",
    text: "日本在住 香港人 繁體中文で東京生活と韓國醫美を分享 Hong Kong beauty creator",
    profileText: "日本在住 香港人 繁體中文で東京生活と韓國醫美を分享 Hong Kong beauty creator",
    category: "beauty", accountAvailability: "active",
  });
  check("Japan residence does not rescue Chinese-audience creator", chineseJapanResident === null);

  const mediaHandle = assessDiscoveryCandidate({
    handle: "as1.entertainment", evidenceKind: "profile", title: "AS1 Entertainment",
    text: "日本語 entertainment media agency creator recruitment",
    profileText: "日本語 entertainment media agency creator recruitment",
    category: "beauty", accountAvailability: "active",
  });
  check("media agency handle is never a candidate", mediaHandle === null);

  const seedMedia = assessDiscoveryCandidate({
    handle: "powderroom_jp", evidenceKind: "profile", title: "Powder Room Japan",
    text: "日本向けK-beauty情報メディア", profileText: "日本向けK-beauty情報メディア",
    category: "beauty", accountAvailability: "active",
  });
  check("seed media handle is not a direct candidate", seedMedia === null);

  const officialCity = assessDiscoveryCandidate({
    handle: "sample_city", evidenceKind: "profile", title: "武雄市役所",
    text: "武雄市役所からのお知らせや、行政情報の提供を行います。",
    profileText: "武雄市役所からのお知らせや、行政情報の提供を行います。",
    category: "beauty", accountAvailability: "active",
  });
  check("obvious city hall profile filtered during discovery", officialCity === null);

  const officialSchool = assessDiscoveryCandidate({
    handle: "sample_school", evidenceKind: "profile", title: "りら創造芸術高等学校",
    text: "りら創造芸術高等学校 学校説明会、個別相談会、在校生による発表 公式LINE",
    profileText: "りら創造芸術高等学校 学校説明会、個別相談会、在校生による発表 公式LINE",
    category: "beauty", accountAvailability: "active",
  });
  check("obvious school profile filtered during discovery", officialSchool === null);

  const koreanSchool = assessDiscoveryCandidate({
    handle: "sample_korean_school", evidenceKind: "profile", title: "オンライン韓国語スクールHANARO",
    text: "オンライン韓国語スクールです。初心者から複数のコースをご用意。",
    profileText: "オンライン韓国語スクールです。初心者から複数のコースをご用意。",
    category: "beauty", accountAvailability: "active",
  });
  check("obvious Korean education business filtered during discovery", koreanSchool === null);

  check("Tavily clinic official profile is filtered", getTavilyObviousBusinessProfileReason(
    "セリンクリニック明洞 Cellin Clinic 韓国美容 セリンクリニック明洞【公式】 365日 日本語対応 人気の肌管理",
  ) !== null);
  check("Tavily clinic self-introduction with director is filtered", getTavilyObviousBusinessProfileReason(
    "Doctor Designer Clinic 明洞 韓国美容クリニック 夫婦院長 日本語OK おひとりおひとりに合わせたオーダーメイド施術",
  ) !== null);
  check("Tavily authorized seller profile is filtered", getTavilyObviousBusinessProfileReason(
    "K-Beauty Bestsellers We ship anywhere in the Philippines Authorized Seller of Celimax and Dr. Althea",
  ) !== null);
  check("Tavily beauty shop profile is filtered", getTavilyObviousBusinessProfileReason(
    "Kokoro Skincare | J-Beauty & K-Beauty Shop (@kokoro_skincare) Authentic cult favorites and skincare",
  ) !== null);
  check("Tavily booking service profile is filtered", getTavilyObviousBusinessProfileReason(
    "Your connection to trusted Korean beauty services. Plastic surgery and dermatology. Book for best quality and affordable prices",
  ) !== null);
  check("Tavily salon booking/recruiting profile is filtered", getTavilyObviousBusinessProfileReason(
    "POLA下郡店 大分エステ プライベートサロン ご予約Instagramメッセージ受付 スタッフ募集 求人",
  ) !== null);
  check("Tavily corporate self-post is filtered", getTavilyObviousBusinessProfileReason(
    "",
    "中国電力グループ on Instagram 中国電力(株) 広島北営業所 電気のご契約や料金、お客さま対応、法人営業、安定供給の事業紹介",
    "beauty",
    "content",
  ) !== null);
  check("Tavily media community profile is filtered", getTavilyObviousBusinessProfileReason(
    "Daily Fashion News Japan Fashion Community 情報提供はDMまで Tag us or DM us your fashion story",
  ) !== null);
  check("Tavily clinic self-title is filtered without official wording", getTavilyObviousBusinessProfileReason(
    "Sample美容クリニック | Sample Clinic ... - Instagram 日本人マネージャーの日常",
  ) !== null);
  check("Tavily content-only education service is filtered", getTavilyObviousBusinessProfileReason(
    "",
    "国際語言 線上1對1家教 真人教學 立即預約試聽 LINE優惠 官方網站 官網",
    "beauty",
    "content",
  ) !== null);
  check("personal language-study experience survives Tavily service guard", getTavilyObviousBusinessProfileReason(
    "",
    "韓国留学中の日本人です。語学を勉強中で、オンライン1対1レッスンを受講しました。学習体験を発信しています",
    "beauty",
    "content",
  ) === null);
  check("personal creator clinic visit is not filtered by Tavily business guard", getTavilyObviousBusinessProfileReason(
    "韓国在住の日本人クリエイターです。韓国美容を発信。先週○○クリニックに行ってきました。肌管理の体験をレビューします",
  ) === null);
  check("Korea-resident personal creator stays outside Tavily business guard", getTavilyObviousBusinessProfileReason(
    "みさにん 勤務2年目 韓国生活5年目 YouTubeしてます 韓国美容と日常を発信",
  ) === null);
  check("Tavily PR/tester operator profile is filtered", getTavilyObviousBusinessProfileReason(
    "韓国情報発信体験団です。運営局にて更新中。PRメンバー募集中、登録には審査があります",
  ) !== null);
  check("personal creator PR experience survives Tavily recruiting guard", getTavilyObviousBusinessProfileReason(
    "韓国在住の日本人クリエイター。PR案件に参加した体験と韓国美容レビューを自分の言葉で発信",
  ) === null);
  check("Tavily obvious unrelated entertainment profile is filtered", getTavilyObviousBusinessProfileReason(
    "専業のエンタメライター。映画・音楽・芸能ニュースを執筆するアカウント",
    "専業のエンタメライター。映画・音楽・芸能ニュースを執筆するアカウント",
    "beauty",
    "profile",
  ) !== null);

  const creatorWithAirlineMention = assessDiscoveryCandidate({
    handle: "sample_kbeauty_creator",
    evidenceKind: "profile",
    title: "韓国在住日本人クリエイター",
    text: "韓国在住の日本人クリエイター 韓国美容とコスメを発信 大韓航空で渡韓した旅行記",
    profileText: "韓国在住の日本人クリエイター 韓国美容とコスメを発信",
    category: "beauty",
    accountAvailability: "active",
  });
  check("airline mention alone does not filter a personal creator", creatorWithAirlineMention !== null);

  const exaJapanGateCases = [
    ["Exa Japan gate keeps Japanese personal K-beauty", "日本人の個人クリエイターです。韓国コスメを自分で使って日本語でレビューしています", true],
    ["Exa Japan gate keeps Korea-resident Japanese creator", "韓国在住の日本人個人クリエイター。韓国ワーホリ中に韓国美容を体験し、日本語で発信しています", true],
    ["Exa Japan gate keeps Japanese student in Korea", "韓国留学中の日本人です。ソウルで韓国美容と韓国スキンケアを自分で体験して日本語で紹介しています", true],
    ["Exa Japan gate keeps Japanese-language clinic review", "ソウルの韓国美容クリニックで自分が受けた肌管理の体験を日本語でレビューしています", true],
    ["Exa Japan gate rejects global English K-beauty", "Global K-Beauty creator reviewing Korean skincare in English for worldwide viewers", false],
    ["Exa Japan gate rejects Singapore K-beauty", "Singapore skincare creator reviewing K-Beauty and Korean cosmetics for SG audiences", false],
    ["Exa Japan gate rejects Hong Kong K-beauty", "Hong Kong beauty creator sharing Korean skincare reviews for Hong Kong followers", false],
    ["Exa Japan gate rejects Korea-resident foreign creator without Japan evidence", "International creator living in Korea and reviewing Seoul skincare in English", false],
    ["Exa Japan gate rejects Japanese product mention alone", "English skincare creator reviewing Japanese sunscreen and Korean skincare for global audiences", false],
  ] as const;
  for (const [name, text, expected] of exaJapanGateCases) {
    const assessed = assessCandidate({
      handle: "exa_gate_sample", evidenceKind: "content", title: "", text,
      category: "beauty", accountAvailability: "active",
    });
    check(name, hasExaJapanTargetEvidence(assessed.targetSignals, text) === expected);
  }

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

  const salonOwner = assessCandidate({
    handle: "sample_salon_owner",
    evidenceKind: "profile",
    title: "日本人美容師",
    text: "韓国美容も発信する日本人美容師 / 美容室代表 / サロン運営 / ご予約はDM / 採用情報",
    profileText: "韓国美容も発信する日本人美容師 / 美容室代表 / サロン運営 / ご予約はDM / 採用情報",
    category: "beauty",
    accountAvailability: "active",
  });
  check("salon owner self-business is hard rejected", salonOwner.candidateStatus === "hard_reject" && salonOwner.accountType === "business");

  const personalHairstylist = assessCandidate({
    handle: "sample_personal_hair",
    evidenceKind: "profile",
    title: "日本人美容師 個人クリエイター",
    text: "日本人美容師の個人クリエイター。渡韓して韓国コスメと韓国美容を自分で体験レビューしています。",
    profileText: "日本人美容師の個人クリエイター。渡韓して韓国コスメと韓国美容を自分で体験レビューしています。",
    category: "beauty",
    accountAvailability: "active",
  });
  check("personal hairstylist with Korea beauty evidence is not auto rejected", personalHairstylist.candidateStatus === "search_qualified");

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
  check("unknown account availability can be search qualified with full evidence", availabilityUnknown.candidateStatus === "search_qualified");

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
  check("latest eight Reel arithmetic mean is 822 rounded", lowAccountMetrics.average === 822 && lowAccountMetrics.sampleSize === 8 && lowAccountMetrics.totalConsidered === 8 && lowAccountMetrics.status === "ready");

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
    creatorSignals: ["개인 리뷰 creator"],
    targetSignals: ["일본어 발신"],
    koreaSignals: ["한국 미용 체험"],
    categorySignals: ["개인 beauty 리뷰"],
    reelMetrics: lowAccountMetrics,
  });
  check("35 follower account can never be qualified", lowAccountDecision.discoveryStatus === "hard_reject");
  check("discovery follower boundary 2,999 rejects", getDiscoveryFollowerRejection("beauty", 2999) === "under_min");
  check("discovery follower boundary 3,000 survives", getDiscoveryFollowerRejection("beauty", 3000) === null);
  check("discovery follower boundary 9,999 survives", getDiscoveryFollowerRejection("beauty", 9999) === null);
  check("discovery follower unknown survives", getDiscoveryFollowerRejection("beauty", null) === null);
  check("food 3K-7K original first priority preserved", classifyFinalPriority({
    category: "food", followers: 5000, reelAverage: 3000, bio: null,
  }) === "1\uc21c\uc704");
  check("food 2K original second priority preserved", classifyFinalPriority({
    category: "food", followers: 2000, reelAverage: 2000, bio: null,
  }) === "2\uc21c\uc704");

  check("beauty 2,999 followers stays excluded", classifyFinalPriority({
    category: "beauty", followers: 2999, reelAverage: 5000, bio: null,
  }) === "\uc81c\uc678");
  check("beauty 3K-9,999 remains verification eligible", classifyFinalPriority({
    category: "beauty", followers: 7500, reelAverage: 3000, bio: null,
  }) !== "\uc81c\uc678");
  check("beauty 10K core remains verification eligible", classifyFinalPriority({
    category: "beauty", followers: 10000, reelAverage: 10000, bio: "日本人女性"
  }) !== "\uc81c\uc678");

  const strongMetrics = computeReelMetrics(Array.from({ length: 8 }, (_, index) => ({
    url: `strong-${index}`,
    postedAt: null,
    views: 15000 + index * 100,
  })));
  const koreaContradictionDecision = decideVerification({
    category: "beauty", duplicateStatus: "available", exists: true, isPrivate: false, isPersonalCreator: true,
    bio: "日本人の個人美容クリエイター", followers: 15000, recentActivity: true, japaneseTarget: true,
    koreaConnection: true, categoryRelevant: true, creatorSignals: ["個人美容レビュー"], targetSignals: ["日本語発信"],
    koreaSignals: [], categorySignals: ["美容レビュー"], reelMetrics: strongMetrics,
  });
  check("korea=true without Instagram korea evidence never qualifies", koreaContradictionDecision.discoveryStatus === "needs_review");

  const amaTokyoDecision = decideVerification({
    category: "beauty", duplicateStatus: "available", exists: true, isPrivate: false, isPersonalCreator: true,
    bio: "AMA TOKYO 代表 / Salon Style Award / 美容師", followers: 65000, recentActivity: true, japaneseTarget: true,
    koreaConnection: true, categoryRelevant: true, creatorSignals: ["本人のヘア投稿"], targetSignals: ["日本語発信"],
    koreaSignals: [], categorySignals: ["ヘアスタイル投稿"], reelMetrics: strongMetrics,
  });
  check("AMA TOKYO salon representative regression rejects", amaTokyoDecision.discoveryStatus === "hard_reject");

  const skillOwnerDecision = decideVerification({
    category: "beauty", duplicateStatus: "available", exists: true, isPrivate: false, isPersonalCreator: true,
    bio: "SKILL代表 / 美容室6店舗運営 / 美容師", followers: 93000, recentActivity: true, japaneseTarget: true,
    koreaConnection: true, categoryRelevant: true, creatorSignals: ["本人のヘア投稿"], targetSignals: ["日本語発信"],
    koreaSignals: [], categorySignals: ["ヘアスタイル投稿"], reelMetrics: strongMetrics,
  });
  check("SKILL multi-salon owner regression rejects", skillOwnerDecision.discoveryStatus === "hard_reject");

  const hostDecision = decideVerification({
    category: "beauty", duplicateStatus: "available", exists: true, isPrivate: false, isPersonalCreator: true,
    bio: "ホスト / ゲスト出勤 / 指名DM", followers: 16000, recentActivity: true, japaneseTarget: true,
    koreaConnection: true, categoryRelevant: true, creatorSignals: ["個人投稿"], targetSignals: ["日本語発信"],
    koreaSignals: [], categorySignals: ["美容投稿"], reelMetrics: strongMetrics,
  });
  check("host nightlife regression rejects", hostDecision.discoveryStatus === "hard_reject");

  const koreaConnectedHairstylistDecision = decideVerification({
    category: "beauty", duplicateStatus: "available", exists: true, isPrivate: false, isPersonalCreator: true,
    bio: "日本人美容師 / 韓国コスメと渡韓美容を個人レビュー", followers: 18000, recentActivity: true, japaneseTarget: true,
    koreaConnection: true, categoryRelevant: true, creatorSignals: ["本人が韓国コスメを使用してレビュー"], targetSignals: ["日本語発信"],
    koreaSignals: ["渡韓美容の体験投稿"], categorySignals: ["韓国コスメ使用レビュー"], reelMetrics: strongMetrics,
  });
  check("Korea-connected personal hairstylist is not false rejected", koreaConnectedHairstylistDecision.discoveryStatus === "qualified");

  const queryResult = (handle: string): RawSearchResult => ({
    provider: "tavily",
    url: `https://www.instagram.com/${handle}/`,
    title: `${handle} 日本人個人クリエイター`,
    text: "韓国在住の日本人個人クリエイター。韓国美容と韓国コスメを日本語でレビューしています。",
  });
  const knownFamilyHandles = Array.from({ length: 10 }, (_, index) => `known_${index}`);
  const knownHandles = new Set(knownFamilyHandles);
  const familySeen = new Set<string>();
  const existingHeavy = evaluateQueryFamily(knownFamilyHandles.map(queryResult), "beauty", familySeen, 1, knownHandles);
  const newYield = evaluateQueryFamily([
    queryResult("known_0"), queryResult("fresh_a"), queryResult("fresh_b"), queryResult("fresh_c"),
  ], "beauty", familySeen, 1, knownHandles);
  check("DB-aware family scoring prefers genuine new yield",
    getStandardFollowUpPriority(newYield) > getStandardFollowUpPriority(existingHeavy)
      && existingHeavy.newHandleCount === 0
      && newYield.newHandleCount === 3);

  const repeatSeen = new Set<string>(["repeat_creator"]);
  const repeatQuality = evaluateQueryFamily([
    queryResult("repeat_creator"), queryResult("fresh_repeat_test"),
  ], "beauty", repeatSeen, 1, new Set());
  check("same-run repeat is not counted as genuine new",
    repeatQuality.runRepeatCount === 1 && repeatQuality.newHandleCount === 1);

  const googleProfileExisting = evaluateQueryFamily([
    queryResult("known_0"), queryResult("known_1"), queryResult("known_2"),
  ], "beauty", new Set(), 1, knownHandles);
  const googleOwnerUnresolved = evaluateQueryFamily([
    { provider: "serper", url: "https://www.instagram.com/p/AAA111/", title: "韓国美容", text: "韓国美容の投稿" },
    { provider: "serper", url: "https://www.instagram.com/reel/BBB222/", title: "韓国コスメ", text: "韓国コスメの投稿" },
    { provider: "serper", url: "https://www.instagram.com/p/CCC333/", title: "スキンケア", text: "日本語の投稿" },
  ], "beauty", new Set(), 1, knownHandles);
  const googleGenuineNew = evaluateQueryFamily([
    queryResult("fresh_google_priority"),
  ], "beauty", new Set(), 1, knownHandles);
  check("Google profile URL diagnostics distinguish profile from unresolved content",
    googleProfileExisting.profileUrlCount === 3
      && googleProfileExisting.contentUrlCount === 0
      && googleOwnerUnresolved.profileUrlCount === 0
      && googleOwnerUnresolved.contentUrlCount === 3
      && googleOwnerUnresolved.ownerUnresolvedCount === 3);
  check("Google follow-up scoring keeps genuine new first and profile yield second",
    getGoogleFollowUpPriority(googleGenuineNew) > getGoogleFollowUpPriority(googleProfileExisting)
      && getGoogleFollowUpPriority(googleGenuineNew) > getGoogleFollowUpPriority(googleOwnerUnresolved));

  const travelCreator = assessCandidate({
    handle: "travel_creator",
    evidenceKind: "profile",
    title: "韓国在住日本人クリエイター",
    text: "韓国在住の日本人個人クリエイター。韓国旅行とソウル生活を日本語で発信しています。",
    profileText: "韓国在住の日本人個人クリエイター。韓国旅行とソウル生活を日本語で発信しています。",
    category: "beauty",
    accountAvailability: "unknown",
  });
  check("category enrichment targets only high-potential travel/lifestyle creator",
    isCategoryEvidenceEnrichmentEligible({
      category: "beauty", attempted: 0, budget: 4, accountType: travelCreator.accountType,
      targetSignalCount: travelCreator.targetSignals.length, koreaAffinity: travelCreator.koreaAffinity,
      contentFit: travelCreator.contentFit, accountAvailability: "unknown", followers: 85000,
    }));
  check("category enrichment respects budget and non-target guard",
    !isCategoryEvidenceEnrichmentEligible({
      category: "beauty", attempted: 4, budget: 4, accountType: travelCreator.accountType,
      targetSignalCount: travelCreator.targetSignals.length, koreaAffinity: travelCreator.koreaAffinity,
      contentFit: travelCreator.contentFit, accountAvailability: "unknown", followers: 85000,
    })
      && !isCategoryEvidenceEnrichmentEligible({
        category: "beauty", attempted: 0, budget: 4, accountType: "unknown",
        targetSignalCount: 1, koreaAffinity: "strong", contentFit: "korea_travel",
        accountAvailability: "unknown", followers: null,
      }));
  check("category enrichment without beauty evidence does not promote", travelCreator.contentFit !== "beauty" && travelCreator.candidateStatus === "needs_review");
  const enrichedBeautyCreator = assessCandidate({
    handle: "travel_creator",
    evidenceKind: "profile",
    title: "韓国在住日本人クリエイター",
    text: "韓国在住の日本人個人クリエイター。韓国旅行とソウル生活に加えて韓国美容、韓国コスメ、スキンケアを自分で体験レビューしています。",
    profileText: "韓国在住の日本人個人クリエイター。韓国美容と韓国コスメを日本語でレビューしています。",
    category: "beauty",
    accountAvailability: "unknown",
  });
  check("category enrichment beauty evidence reapplies existing assessment", enrichedBeautyCreator.candidateStatus === "search_qualified");

  const serpApiProvider: SearchProvider = { name: "serpapi", search: async () => [] };
  const serperProvider: SearchProvider = { name: "serper", search: async () => [] };
  const deferredLanes: Parameters<typeof takeGoogleWave>[0] = [
    { provider: serpApiProvider, family: "disabled", query: "a-disabled", queryIndex: 0, depth: 0, seed: false },
    { provider: serperProvider, family: "live", query: "b-first", queryIndex: 0, depth: 0, seed: false },
    { provider: serperProvider, family: "live", query: "b-second", queryIndex: 0, depth: 0, seed: false },
  ];
  const deferredWave = takeGoogleWave(
    deferredLanes, 0, [serpApiProvider, serperProvider], new Map(), new Set(), new Set(["serpapi"]), 0, 12,
  );
  check("Google disabled provider preserves unexecuted live-provider lane",
    deferredWave.lanes.length === 1
      && deferredWave.lanes[0]?.query === "b-first"
      && deferredWave.deferred.some((lane) => lane.query === "b-second"));

  const duplicateLane: Parameters<typeof takeGoogleWave>[0][number] = {
    provider: serperProvider, family: "dup", query: "same-query", queryIndex: 0, depth: 0, seed: false,
  };
  const uniqueLane: Parameters<typeof takeGoogleWave>[0][number] = {
    provider: serperProvider, family: "dup", query: "unique-query", queryIndex: 0, depth: 0, seed: false,
  };
  const duplicateWave = takeGoogleWave(
    [duplicateLane, uniqueLane], 0, [serperProvider], new Map(), new Set([googleLaneKey(duplicateLane)]), new Set(), 0, 12,
  );
  check("Google same query/depth is not selected twice", duplicateWave.lanes.length === 1 && duplicateWave.lanes[0]?.query === "unique-query");

  const providerBudgetWave = takeGoogleWave(
    [uniqueLane], 0, [serperProvider], new Map([["serper", 10]]), new Set(), new Set(), 0, 20,
  );
  const totalBudgetWave = takeGoogleWave(
    [uniqueLane], 0, [serperProvider], new Map(), new Set(), new Set(), 20, 20,
  );
  const oneRemainingWave = takeGoogleWave(
    [uniqueLane], 0, [serperProvider], new Map([["serper", 9]]), new Set(), new Set(), 19, 20,
  );
  check("Google provider and total budgets are respected",
    providerBudgetWave.lanes.length === 0
      && totalBudgetWave.lanes.length === 0
      && oneRemainingWave.lanes.length === 1);

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
    creatorSignals: [],
    targetSignals: [],
    koreaSignals: [],
    categorySignals: [],
    reelMetrics: computeReelMetrics([]),
  });
  check("FixUp duplicate never reaches Instagram qualification", duplicateDecision.discoveryStatus === "hard_reject");

  check("existing-heavy Google lane receives no pagination", !shouldFollowUpGoogleLane(existingHeavy));
  check("productive Google lane keeps followup", shouldFollowUpGoogleLane(newYield));
  check("81-like 12 existing of 13 stops followup", !shouldFollowUpGoogleLane({
    ...googleGenuineNew, handleCount: 13, existingHandleCount: 12, newHandleCount: 1, viableNewHandleCount: 1,
  }));
  const smallText = "韓国在住の日本人ママ。日常とファッション。韓国コスメを体験レビュー。サロンオーナー。";
  const smallAssessment = assessDiscoveryCandidate({
    handle: "small_personal_fixture", evidenceKind: "profile", title: "", text: smallText,
    profileText: smallText, category: "beauty", accountAvailability: "active",
  });
  check("personal creator may own a salon", smallAssessment?.accountType === "creator");
  check("strong small-creator evidence is recognized", Boolean(smallAssessment && hasStrongSmallCreatorEvidence(smallAssessment, smallText)));
  check("Beauty label alone is not small-creator evidence", Boolean(smallAssessment && !hasStrongSmallCreatorEvidence(smallAssessment, "韓国在住の日本人。美容好き。")));
  const smallResult = evaluateQueryFamily([{
    provider: "serper", url: "https://www.instagram.com/small_personal_fixture/", title: "1734 followers", text: smallText,
  }], "beauty", new Set(), 1, new Set());
  check("strong sub-3K review counts as viable new", smallResult.viableNewHandleCount === 1);
  const smallVerification = {
    category: "beauty" as const, duplicateStatus: "available" as const, exists: true, isPrivate: false,
    isPersonalCreator: true, bio: smallText, followers: 1734, recentActivity: true,
    japaneseTarget: true, koreaConnection: true, categoryRelevant: true,
    creatorSignals: ["日常とファッションの個人クリエイター"], targetSignals: ["日本人"],
    koreaSignals: ["韓国在住"], categorySignals: ["韓国コスメを体験レビュー"],
    reelMetrics: computeReelMetrics([]),
  };
  check("strong sub-3K reaches Reels review", decideVerification(smallVerification).discoveryStatus === "needs_review");
  check("strong sub-3K with Reels stays manual review", decideVerification({
    ...smallVerification, reelMetrics: computeReelMetrics([{ url: "https://www.instagram.com/reel/fixture/", views: 12000, postedAt: null }]),
  }).discoveryStatus === "needs_review");
  check("sub-3K cannot bypass Japan target guard", decideVerification({ ...smallVerification, japaneseTarget: false }).discoveryStatus === "hard_reject");
  failures.push(...runRecommendationSelfCheck());

  return { ok: failures.length === 0, failures };

  function check(name: string, condition: boolean) {
    if (!condition) failures.push(name);
  }
}
