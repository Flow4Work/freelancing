import { extractInstagramCandidate } from "./instagram";
import { assessCandidate } from "./quality";
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
  });
  check("doctor hard rejected", doctor.candidateStatus === "hard_reject");

  const hospital = assessCandidate({
    handle: "idhospitalkorea",
    evidenceKind: "content",
    title: "Korean beauty",
    text: "日本向け韓国美容コンテンツ",
    category: "beauty",
  });
  check("hospital handle hard rejected", hospital.candidateStatus === "hard_reject");

  const business = assessCandidate({
    handle: "korea_hadakanri_nsaas",
    evidenceKind: "profile",
    title: "韓国肌管理",
    text: "日本に肌管理を持って来た私たち 韓国人施術者 創業10年 ビジネスサービス",
    category: "beauty",
  });
  check("business hard rejected", business.candidateStatus === "hard_reject");

  const creator = assessCandidate({
    handle: "ayamitakagi325",
    evidenceKind: "profile",
    title: "Ayami 韓国在住 韓国美容 韓国旅行",
    text: "Japan→Seoul 在韓8年目 リアルな韓国を発信 美容・グルメ 韓国美容 皮膚科 コスメ",
    category: "beauty",
  });
  check("known creator survives", creator.candidateStatus === "search_qualified");

  const mergedCreator = assessCandidate({
    handle: "sample_creator",
    evidenceKind: "profile",
    title: "",
    profileText: "韓国在住の日本人 美容好き ブロガー 韓国コスメを発信",
    text: "韓国在住の日本人 美容好き ブロガー 韓国コスメを発信 クリニック公式アカウントの施術を体験",
    category: "beauty",
  });
  check("content business mention does not poison clean profile", mergedCreator.candidateStatus === "search_qualified");

  const contentOnly = assessCandidate({
    handle: "somecreator",
    evidenceKind: "content",
    title: "韓国在住日本人の韓国美容リール",
    text: "韓国美容とコスメが好きな日本人クリエイターの投稿です",
    category: "beauty",
  });
  check("content-only result never top-qualified", contentOnly.candidateStatus === "needs_review");

  const metrics = computeReelMetrics([
    { url: "r1", postedAt: "2026-08-30", views: 1000 },
    { url: "r2", postedAt: "2026-08-29", views: 2000 },
    { url: "r3", postedAt: "2026-08-28", views: 3000 },
    { url: "r4", postedAt: "2026-08-27", views: 4000 },
    { url: "r5", postedAt: "2026-08-26", views: 5000 },
    { url: "r6", postedAt: "2026-08-25", views: null },
  ]);
  check("Reel arithmetic mean computed by app", metrics.average === 3000 && metrics.sampleSize === 5 && metrics.totalConsidered === 6);
  check("five Reel views is sufficient sample", metrics.status === "ready");

  return { ok: failures.length === 0, failures };

  function check(name: string, condition: boolean) {
    if (!condition) failures.push(name);
  }
}
