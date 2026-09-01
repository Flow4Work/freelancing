import type { InstagramEvidenceKind } from "./instagram";
import type { CandidateStatus, SearchCategory } from "./types";

const HANDLE_BUSINESS_PATTERNS = [
  /official/i,
  /^oliveyoung_japan$/i,
  /clinic|hospital|medical|derm|hifuka|pharmacy|massage|esthe|aesthetics?|recruit|academy/i,
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

const PROFILE_AGGREGATOR_PATTERNS = [
  /情報メディア/i,
  /韓国(?:最新)?ニュース/i,
  /毎日.{0,10}(?:韓国|最新情報).{0,10}(?:発信|投稿)/i,
  /(?:まとめ|キュレーション).{0,8}(?:アカウント|メディア)/i,
];

const PERSONAL_CREATOR_PATTERNS = [
  /(?:会社員|OL|ママ|mama|主婦|学生|留学生|ワーホリ)/i,
  /(?:ひとり旅|一人旅|旅行好き|韓国好き|コスメ好き|美容好き|オタク)/i,
  /(?:クリエイター|インフルエンサー|ブロガー|美容家|ライター|VLOG|UGC)/i,
  /(?:在韓|韓国在住|日本人|日韓夫婦|日韓ハーフ)/i,
  /(?:渡韓\s*\d+|月\s*\d+.{0,4}韓国|韓国旅行\s*\d+)/i,
  /\d{2,3}\s*cm/i,
  /\d{2}\s*代/i,
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
  [/韓国美容|美容渡韓|韓国皮膚科|韓国クリニック|韓国美容医療/i, "한국 미용"],
  [/韓国コスメ|K-?Beauty|オリーブヤング|韓国スキンケア/i, "K뷰티"],
  [/韓国薬局|韓国(?:美容)?薬局/i, "한국 약국"],
  [/韓国グルメ|ソウルグルメ|釜山グルメ/i, "한국 맛집"],
  [/韓国旅行|韓国ひとり旅/i, "한국 여행"],
  [/ソウル|Seoul/i, "서울"],
  [/釜山|Busan/i, "부산"],
  [/🇰🇷/u, "한국 표시"],
];

const BEAUTY_PATTERNS = [
  /美容|美容医療|コスメ|化粧品|スキンケア|美肌|肌管理|皮膚科|クリニック|薬局|オリーブヤング|購入品|アンプル|セラム|トナー|リジュラン|ポテンツァ|ピコ|リフト|フィラー/i,
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
  profileText?: string;
  category: SearchCategory;
};

export function assessCandidate(input: AssessInput): QualityAssessment {
  const combined = clean(`${input.title}\n${input.text}`);
  const profileText = clean(input.profileText ?? (input.evidenceKind === "profile" ? combined : ""));
  const targetSignals = collectSignals(combined, JAPAN_IDENTITY_PATTERNS);
  if (hasEnoughJapaneseScript(combined) && !targetSignals.includes("일본어 콘텐츠")) targetSignals.push("일본어 콘텐츠");
  const koreaSignals = collectSignals(combined, KOREA_PATTERNS);
  const rejectReasons: string[] = [];
  const flags: string[] = [];

  if (HANDLE_BUSINESS_PATTERNS.some((pattern) => pattern.test(input.handle))) rejectReasons.push("사업체형 ID");
  if (profileText && DOCTOR_PATTERNS.some((pattern) => pattern.test(profileText))) rejectReasons.push("의사/병원장 계정");
  if (profileText && PROFILE_BUSINESS_PATTERNS.some((pattern) => pattern.test(profileText))) rejectReasons.push("공식/사업체 계정");

  if (rejectReasons.length) {
    return { candidateStatus: "hard_reject", targetSignals, koreaSignals, rejectReasons, flags };
  }

  const categoryRelevant = input.category === "beauty"
    ? BEAUTY_PATTERNS.some((pattern) => pattern.test(combined))
    : FOOD_PATTERNS.some((pattern) => pattern.test(combined));
  const aggregatorLike = Boolean(profileText) && PROFILE_AGGREGATOR_PATTERNS.some((pattern) => pattern.test(profileText));
  const personalLike = PERSONAL_CREATOR_PATTERNS.some((pattern) => pattern.test(combined));

  if (!targetSignals.length) flags.push("일본 타깃 근거 약함");
  if (!koreaSignals.length) flags.push("한국 접점 근거 약함");
  if (!categoryRelevant) flags.push("장르 근거 추가확인");
  if (!personalLike) flags.push("개인 Creator 근거 추가확인");
  if (aggregatorLike) flags.push("미디어/정보계정 여부 확인");
  if (input.evidenceKind === "content") flags.push("게시물 근거·프로필 재확인");

  const candidateStatus: CandidateStatus = input.evidenceKind === "profile"
    && targetSignals.length > 0
    && koreaSignals.length > 0
    && categoryRelevant
    && personalLike
    && !aggregatorLike
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
