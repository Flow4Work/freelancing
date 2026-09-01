import type { InstagramEvidenceKind } from "./instagram";
import type { CandidateStatus, SearchCategory } from "./types";

const HANDLE_BUSINESS_PATTERNS = [
  /(?:^|[._-])official(?:$|[._-])/i,
  /(?:clinic|hospital|derm|hifuka|pharmacy|massage|esthe|aesthetics?|recruit|academy)(?:$|[._-])/i,
  /(?:^|[._-])(?:salon|shop|store|corp|company)(?:$|[._-])/i,
  /beauty_product/i,
];

const DOCTOR_PATTERNS = [
  /美容皮膚科経営/i,
  /(?:皮膚科医|形成外科医|美容外科医|医師|医者|院長)/i,
  /\bdoctor\b/i,
  /\bdr\.?\s*[a-z]/i,
];

const PROFILE_BUSINESS_PATTERNS = [
  /公式(?:Instagram|インスタグラム|アカウント)?/i,
  /(?:クリニック|医院|病院|皮膚科|歯科).*公式/i,
  /正規(?:日本)?代理店/i,
  /創業\s*\d+\s*年/i,
  /(?:インフルエンサー|クリエイター).{0,8}募集/i,
  /(?:採用情報|求人|リクルート)/i,
  /ビジネスサービス/i,
  /(?:ご予約|予約受付).{0,12}(?:こちら|DM|LINE|リンク)/i,
  /(?:OPEN|営業時間)\s*[:：]?\s*\d{1,2}/i,
  /お店です/i,
  /店舗(?:情報|一覧)/i,
];

const JAPAN_IDENTITY_PATTERNS: Array<[RegExp, string]> = [
  [/韓国在住.{0,10}日本人|日本人.{0,10}韓国在住/i, "한국거주 일본인"],
  [/在韓\s*\d*\s*年|在韓日本人/i, "재한 일본인"],
  [/日韓(?:夫婦|カップル|ハーフ)/i, "일한 배경"],
  [/日本人/i, "일본인"],
  [/🇯🇵/u, "일본 표시"],
  [/\bJapanese\b/i, "Japanese 표기"],
];

const KOREA_PATTERNS: Array<[RegExp, string]> = [
  [/韓国在住|在韓/i, "한국 거주"],
  [/渡韓|訪韓/i, "방한"],
  [/韓国美容|美容渡韓|韓国皮膚科|韓国クリニック/i, "한국 미용"],
  [/韓国コスメ|K-?Beauty/i, "K뷰티"],
  [/韓国グルメ|ソウルグルメ|釜山グルメ/i, "한국 맛집"],
  [/韓国旅行|韓国ひとり旅/i, "한국 여행"],
  [/ソウル|Seoul/i, "서울"],
  [/釜山|Busan/i, "부산"],
  [/🇰🇷/u, "한국 표시"],
];

const BEAUTY_PATTERNS = [
  /美容|コスメ|スキンケア|肌管理|皮膚科|クリニック|リジュラン|ポテンツァ|ピコ|リフト|フィラー/i,
  /K-?Beauty/i,
];

const FOOD_PATTERNS = [
  /グルメ|食べ歩き|カフェ|レストラン|韓国料理|ごはん|食堂|居酒屋|焼肉|ケジャン/i,
];

export type QualityAssessment = {
  candidateStatus: CandidateStatus;
  targetSignals: string[];
  koreaSignals: string[];
  rejectReasons: string[];
  flags: string[];
};

type AssessInput = {
  handle: string;
  evidenceKind: InstagramEvidenceKind;
  title: string;
  text: string;
  category: SearchCategory;
};

export function assessCandidate(input: AssessInput): QualityAssessment {
  const combined = clean(`${input.title}\n${input.text}`);
  const targetSignals = collectSignals(combined, JAPAN_IDENTITY_PATTERNS);
  if (hasEnoughJapaneseScript(combined) && !targetSignals.includes("일본어 콘텐츠")) targetSignals.push("일본어 콘텐츠");
  const koreaSignals = collectSignals(combined, KOREA_PATTERNS);
  const rejectReasons: string[] = [];
  const flags: string[] = [];

  if (HANDLE_BUSINESS_PATTERNS.some((pattern) => pattern.test(input.handle))) {
    rejectReasons.push("사업체형 ID");
  }

  if (DOCTOR_PATTERNS.some((pattern) => pattern.test(combined))) {
    rejectReasons.push("의사/병원장 계정");
  }

  if (input.evidenceKind === "profile" && PROFILE_BUSINESS_PATTERNS.some((pattern) => pattern.test(combined))) {
    rejectReasons.push("공식/사업체 계정");
  }

  if (rejectReasons.length) {
    return { candidateStatus: "hard_reject", targetSignals, koreaSignals, rejectReasons, flags };
  }

  const categoryRelevant = input.category === "beauty"
    ? BEAUTY_PATTERNS.some((pattern) => pattern.test(combined))
    : FOOD_PATTERNS.some((pattern) => pattern.test(combined));

  if (!targetSignals.length) flags.push("일본 타깃 근거 약함");
  if (!koreaSignals.length) flags.push("한국 접점 근거 약함");
  if (!categoryRelevant) flags.push("장르 근거 추가확인");
  if (input.evidenceKind === "content") flags.push("게시물 근거·프로필 재확인");

  const candidateStatus: CandidateStatus = targetSignals.length && koreaSignals.length && categoryRelevant
    ? "search_qualified"
    : "needs_review";

  return { candidateStatus, targetSignals, koreaSignals, rejectReasons, flags };
}

function collectSignals(text: string, patterns: Array<[RegExp, string]>) {
  const found: string[] = [];
  for (const [pattern, label] of patterns) {
    if (pattern.test(text) && !found.includes(label)) found.push(label);
  }
  return found;
}

function hasEnoughJapaneseScript(text: string) {
  const matches = text.match(/[ぁ-んァ-ヶー]/gu);
  return (matches?.length ?? 0) >= 12;
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
