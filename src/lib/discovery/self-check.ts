import { extractInstagramCandidate } from "./instagram";
import { assessCandidate } from "./quality";

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
  check("seo owner extracted", extractInstagramCandidate(
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

  return { ok: failures.length === 0, failures };

  function check(name: string, condition: boolean) {
    if (!condition) failures.push(name);
  }
}
