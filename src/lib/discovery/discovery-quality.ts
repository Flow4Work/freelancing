import { assessCandidate, type QualityAssessment } from "./quality";
import type { SearchCategory } from "./types";

export const DISCOVERY_REVIEW_ONLY_FLAG = "사업체 단서 불확실·개인 여부 확인";

const TAVILY_BUSINESS_PROFILE_PATTERNS = [
  /(?:クリニック|病院|医院|皮膚科|clinic|hospital).{0,80}(?:【\s*公式\s*】|院長|当院|ご予約|予約受付|診療時間|オーダーメイド施術)/i,
  /(?:【\s*公式\s*】|official).{0,48}(?:クリニック|病院|医院|皮膚科|clinic|hospital)/i,
  /(?:we\s+ship|発送|配送).{0,80}(?:authorized\s+seller|正規販売|購入|注文|shop|store)|(?:authorized\s+seller|正規販売店).{0,80}(?:ship|発送|配送|販売|購入)/i,
  /^.{0,100}(?:J-?Beauty|K-?Beauty|Skincare).{0,40}\b(?:Shop|Store)\b\s*\(@[a-z0-9._]{1,30}\)/i,
  /(?:beauty\s+services?|美容サービス).{0,100}(?:\bBook\b|予約|price|価格|料金)/i,
  /(?:Fashion\s+Community|情報コミュニティ).{0,100}(?:情報提供|Tag\s+us|DM\s+us|投稿募集)/i,
  /情報提供.{0,48}DM.{0,80}(?:Tag\s+us|story|投稿)/i,
  /(?:会社|agency|service|サービス).{0,80}(?:クリエイター|インフルエンサー).{0,24}(?:募集|募集中|recruit)/i,
  /(?:エステ|サロン|美容室).{0,80}(?:ご予約|予約受付|スタッフ募集|求人|営業時間|貸切)|(?:POLA).{0,80}(?:エステ|ご予約|スタッフ募集|求人)/i,
];

const TAVILY_CLINIC_SELF_TITLE = /^.{0,100}(?:クリニック|医院|病院|clinic|hospital).{0,36}(?:-\s*Instagram|•\s*Instagram|\(@[a-z0-9._]{1,30}\))/i;
const TAVILY_CREATOR_TITLE_CUES = /(?:レビュー|体験|レポ|クリエイター|ライター|ブロガー|\bcreator\b|\bblogger\b)/i;

const TAVILY_SERVICE_SELF_PROMOTION_PATTERNS = [
  /(?:オンライン|線上|\bonline\b).{0,50}(?:1\s*(?:対|對)\s*1|一対一|家教|レッスン|lesson|course|コース|課程|真人教學).{0,140}(?:予約|預約|試聴|試聽|申込|報名|受講|相談|諮詢|LINE|公式サイト|官網|website)/i,
  /(?:語学|語言|language).{0,60}(?:スクール|学校|教室|academy|school|家教|lesson|course|課程).{0,140}(?:予約|預約|申込|報名|受講|相談|諮詢|LINE|公式サイト|官網)/i,
];
const TAVILY_PERSONAL_STUDY_EXPERIENCE = /(?:留学中|留学して|語学を勉強|勉強中|習っています|通っています|受講しました|レッスンを受け|my (?:study|learning) experience)/i;
const TAVILY_CORPORATE_SELF_CONTENT = /^.{0,120}(?:株式会社|有限会社|電力(?:グループ)?|法人営業).{0,180}(?:ご契約|料金|営業所|お客様|事業|安定供給|採用|業務改善)/i;

const TAVILY_RECRUITING_PROFILE_PATTERNS = [
  /(?:運営局|運営事務局|運営アカウント).{0,120}(?:体験団|モニター|PR\s*メンバー|インフルエンサー|クリエイター|募集|募集中)/i,
  /(?:体験団|モニター募集|PR\s*(?:案件|メンバー)|インフルエンサー|クリエイター).{0,80}(?:募集|募集中|参加者募集|登録|審査)/i,
  /(?:募集|募集中|recruit(?:ing|ment)?).{0,50}(?:PR\s*member|influencer|creator|モニター|体験団)/i,
];

const TAVILY_UNRELATED_PROFILE_PATTERNS = [
  /(?:全職|專職|専業|full[- ]?time).{0,32}(?:娛樂|エンタメ|entertainment).{0,32}(?:寫|書|writer|journalist|評論|review)/i,
  /(?:娛樂|エンタメ|entertainment).{0,32}(?:記者|ライター|writer|journalist|評論家|media)/i,
];

export function getTavilyObviousBusinessProfileReason(
  profile: string,
  combined = profile,
  category: SearchCategory = "beauty",
  evidenceKind: "profile" | "content" = profile.trim() ? "profile" : "content",
): string | null {
  const normalizedProfile = profile.replace(/\s+/g, " ").trim();
  const normalizedCombined = combined.replace(/\s+/g, " ").trim();

  if (normalizedProfile) {
    const titleHead = normalizedProfile.slice(0, 180);
    if (TAVILY_CLINIC_SELF_TITLE.test(titleHead) && !TAVILY_CREATOR_TITLE_CUES.test(titleHead)) {
      return "Tavily 명백한 클리닉 자기소개";
    }
    if (TAVILY_BUSINESS_PROFILE_PATTERNS.some((pattern) => pattern.test(normalizedProfile))) {
      return "Tavily 명백한 사업체 자기소개";
    }
    if (TAVILY_RECRUITING_PROFILE_PATTERNS.some((pattern) => pattern.test(normalizedProfile))) {
      return "Tavily 모집/체험단 운영 계정";
    }
    if (
      TAVILY_UNRELATED_PROFILE_PATTERNS.some((pattern) => pattern.test(normalizedProfile))
      && !CATEGORY_EVIDENCE[category].test(normalizedCombined)
      && !JAPAN_AUDIENCE.test(normalizedCombined)
    ) {
      return "Tavily 명백한 비대상 전문 발신";
    }
  }
  if (evidenceKind === "content" && TAVILY_CORPORATE_SELF_CONTENT.test(normalizedCombined)) {
    return "Tavily 명백한 법인 자기소개 콘텐츠";
  }

  const serviceEvidence = normalizedProfile || (evidenceKind === "content" ? normalizedCombined : "");
  if (
    serviceEvidence
    && TAVILY_SERVICE_SELF_PROMOTION_PATTERNS.some((pattern) => pattern.test(serviceEvidence))
    && !TAVILY_PERSONAL_STUDY_EXPERIENCE.test(serviceEvidence)
  ) {
    return "Tavily 명백한 교육/서비스 자기홍보";
  }

  return null;
}

const CLEAR_NON_CANDIDATE_HANDLE = /^(?:powderroom_jp|tirtir_jp|xenia\.clinic)$|(?:^|[._-])(?:official|media|entertainment|agency)(?:$|[._-])/i;

export type DiscoveryPreRejectReason = "obvious_business" | "non_japan_target" | "category_mismatch";

export function getDiscoveryPreRejectReason(input: Parameters<typeof assessCandidate>[0]): DiscoveryPreRejectReason | null {
  if (CLEAR_NON_CANDIDATE_HANDLE.test(input.handle)) return "obvious_business";
  const combined = `${input.title}
${input.text}`;
  const profile = input.profileText ?? (input.evidenceKind === "profile" ? combined : "");
  const obviousReason = getObviousNoiseReason(profile, combined, input.category);
  if (obviousReason) {
    const explicitNonJapan = NO_JAPAN_AUDIENCE.test(profile) && !JAPAN_AUDIENCE.test(combined);
    const chineseTarget = CHINESE_AUDIENCE.test(profile) && !JAPAN_AUDIENCE.test(combined) && !EXPLICIT_JAPANESE_IDENTITY.test(profile);
    if (explicitNonJapan || chineseTarget) return "non_japan_target";
    if (UNRELATED_EXCLUSIVE.test(profile) && !CATEGORY_EVIDENCE[input.category].test(combined)) return "category_mismatch";
    return "obvious_business";
  }
  if (input.evidenceKind === "content" && isClearContentOnlyNonCandidate(input.handle, combined)) {
    if (CHINESE_AUDIENCE.test(combined) && !JAPAN_AUDIENCE.test(combined)) return "non_japan_target";
    return "obvious_business";
  }
  return null;
}

// This guard is used only for newly discovered handles, never existing/verified candidates.
export function assessDiscoveryCandidate(input: Parameters<typeof assessCandidate>[0]): QualityAssessment | null {
  if (getDiscoveryPreRejectReason(input)) return null;

  const assessment = assessCandidate(input);
  // A handle keyword, job title or quoted business mention is not proof of an official account.
  // Preserve uncertain candidates for human/Instagram review without promoting them.
  if (assessment.accountType === "business" && input.accountAvailability !== "unavailable") {
    return {
      ...assessment,
      accountType: "unknown",
      eligibility: "unknown",
      candidateStatus: "needs_review",
      rejectReasons: [],
      flags: [...assessment.flags, DISCOVERY_REVIEW_ONLY_FLAG],
    };
  }
  return assessment;
}

const PERSONAL_PROFILE_EVIDENCE = /個人(?:クリエイター|アカウント|ブログ)|私の|自分で|自分の|ブロガー|クリエイター|インフルエンサー|会社員|主婦|留学生|ワーホリ|日韓夫婦|\b(?:creator|blogger|influencer|personal account|personal blog)\b/i;
const BUSINESS_IDENTITY = [
  /(?:クリニック|医院|病院|皮膚科|歯科|サロン|薬局|ブランド|ショップ|ストア|レストラン|食堂|飲食店|カフェ|焼肉店|会社|大学|学校|高校|専門学校|航空会社|エアライン|観光局|観光協会|観光公社|留学センター|留学エージェント|語学学校|教育機関)(?:の)?\s*公式(?:アカウント|Instagram|インスタグラム)?/i,
  /(?:公式アカウント|公式Instagram|公式インスタグラム).{0,24}(?:クリニック|病院|ブランド|レストラン|飲食店|株式会社|大学|学校|高校|航空会社|エアライン|市役所|区役所|自治体|観光局|観光協会|観光公社|留学センター|留学エージェント|語学学校)/i,
  /(?:^|[\n。|｜])\s*(?:株式会社|有限会社|医療法人|学校法人|公益財団法人|一般社団法人)/i,
  /\b(?:official\s+(?:account\s+of\s+(?:the\s+)?)?(?:brand|clinic|hospital|restaurant|store|company|university|school|airline|agency|tourism board)|(?:brand|clinic|hospital|restaurant|store|company|university|school|airline)\s+official(?:\s+account)?)\b/i,
  /(?:当院|当店|弊社|本校|当校).{0,24}(?:診療|施術|予約|営業|販売|提供|運営|入学|受講|申込)/i,
  /(?:^|[\n。|｜])\s*(?:情報メディア|ニュースメディア|企業アカウント|店舗アカウント|公式ショップ)/i,
  /(?:^|[\n。|｜]).{0,28}(?:市役所|区役所|自治体|観光局|観光協会|観光公社).{0,24}(?:公式|観光情報|お知らせ|運営)/i,
  /(?:航空会社|エアライン).{0,28}(?:公式|運航情報|航空券|予約|フライト)/i,
  /(?:留学エージェント|留学センター|留学サポート|韓国語教室|語学学校).{0,28}(?:公式|運営|相談|申込|受講|カウンセリング)/i,
  /^.{0,48}公式\s*\(@[a-z0-9._]{1,30}\)/i,
  /^.{0,36}(?:大学|高等学校|高校|専門学校).{0,100}(?:学校説明会|入試|受験|オープンスクール|個別相談|入学|キャンパス|在校生|公式LINE)/i,
  /^.{0,36}(?:市役所|区役所).{0,120}(?:行政情報|お知らせ|市政|公式|提供)/i,
  /(?:オンライン)?韓国語(?:スクール|学校|教室).{0,80}(?:コース|受講|レッスン|初心者|申込|相談)/i,
  /^.{0,36}国際センター.{0,120}(?:国際交流|参加|相談|外国人|イベント|事業)/i,
  /(?:クリニック|医院|病院|皮膚科).{0,100}(?:日本語(?:通訳|対応)|院長|診療|施術|予約|LINE|住所|駅(?:から)?徒歩|営業時間)/i,
  /(?:調剤薬局|薬局).{0,100}(?:処方せん|処方箋|営業時間|LINE|店舗|販売|お取り扱い)/i,
  /(?:書店|BOOKS|BOOKSTORE).{0,100}(?:営業時間|店舗|フェア|イベント|OPEN|CLOSE)/i,
  /(?:航空|airline|air\s+lines?).{0,100}(?:運航|航空券|路線|仁川|釜山|済州|空港)/i,
  /(?:アカデミー|ACADEMY).{0,100}(?:受講|授業|スクール|講座|サポート|academy)/i,
  /(?:学会|協会).{0,100}(?:学術|研修|大会|参加費|申込|会場)/i,
];
const NO_JAPAN_AUDIENCE = /(?:^|[\n。.!?！？|｜])\s*(?:(?:この|当)アカウントは\s*)?(?:日本(?:人)?向けではありません|日本(?:人)?向けの発信はしていません|日本の視聴者は対象外|not (?:intended )?for (?:a )?japanese (?:audience|viewers))(?=$|[\s。.!?！？|｜])/i;
const JAPAN_AUDIENCE = /日本語(?:で|の|発信)|日本向け(?:に|の)|日本人(?:です|クリエイター)|\bfor japanese (?:viewers|audiences)\b/i;
const EXPLICIT_JAPANESE_IDENTITY = /日本人|\bJapanese\b/i;
const CHINESE_AUDIENCE = /廣東話|粤語|粵語|繁體中文|简体中文|簡體中文|小紅書|xiaohongshu|香港.{0,16}(?:生活|資訊|情報|美妝|美容|creator)|Hong Kong.{0,20}(?:creator|life|beauty)/i;
const EXA_STRONG_JAPAN_TARGET_SIGNALS = new Set(["한국거주 일본인", "재한 일본인", "일한 배경", "일본인", "일본어 콘텐츠"]);

export function hasExaJapanTargetEvidence(targetSignals: string[], evidenceText: string) {
  return targetSignals.some((signal) => EXA_STRONG_JAPAN_TARGET_SIGNALS.has(signal)) || JAPAN_AUDIENCE.test(evidenceText);
}
const CATEGORY_EVIDENCE: Record<SearchCategory, RegExp> = {
  beauty: /美容|コスメ|化粧品|スキンケア|肌管理|美肌|メイク|beauty|cosmetic|skincare|makeup/i,
  food: /グルメ|食べ|カフェ|レストラン|料理|ごはん|食堂|居酒屋|焼肉|ケジャン|food|cafe|restaurant|dining/i,
};
const UNRELATED_EXCLUSIVE = /(?:^|[\n。.!?！？|｜])\s*(?:このアカウントは\s*)?(?:(?:ゲーム実況|ゲーム配信|暗号資産投資|不動産売買|求人情報|サッカー速報|野球速報)(?:専門|のみ)(?:のアカウント|を発信)?|(?:gaming|crypto trading|real estate listings|football news) only)(?=$|[\s。.!?！？|｜])/i;


function isClearContentOnlyNonCandidate(handle: string, combined: string) {
  const explicitPersonal = /(?:私|自分|個人|ブロガー|クリエイター|インフルエンサー|会社員|主婦|ママ|留学生|ワーホリ|日韓夫婦|\bcreator\b|\bblogger\b)/i.test(combined);
  const businessHandle = /(?:clinic|hospital|derma|academy|pharmacy|official|media|agency|entertainment|(?:^|[._-])cn(?:$|[._-])|(?:^|[._-])sgmy(?:$|[._-]))/i.test(handle);
  const businessText = /(?:当院|当店|当社|クリニック|医院|病院|皮膚科|アカデミー|ご予約|予約|LINE ID|代表院長|日本語通訳常駐|住所|営業時間|外国患者接待|醫療機構|皮膚科|诊所|診所)/i.test(combined);
  const chineseTarget = /廣東話|粤語|粵語|繁體中文|简体中文|簡體中文|香港|Hong Kong|台湾|Taiwan|中國|中国|首爾市|江南區|皮膚科|診所|诊所/i.test(combined);
  const japaneseTarget = /日本人|日本語(?:で|の|発信)|日本向け|\bJapanese\b/i.test(combined);
  if (businessHandle && businessText && !explicitPersonal) return true;
  return chineseTarget && !japaneseTarget && businessHandle && !explicitPersonal;
}

export function getObviousNoiseReason(profile: string, combined: string, category: SearchCategory): string | null {
  if (!profile.trim()) return null;
  // Product-development copy plus sales promotion without a personal voice identifies a brand.
  if (!PERSONAL_PROFILE_EVIDENCE.test(profile)
    && /(?:共同開発|自社開発|製造販売|自社ブランド)/i.test(profile)
    && /(?:成分|クリーム|コスメ|化粧品)/i.test(profile)
    && /(?:メガ割|販売|発売|公式|お得|購入はこちら)/i.test(profile)) {
    return "商品開発・販売主体のブランドアカウント";
  }
  // Posts may quote a venue, or a creator's profile may describe a review. Conflicting evidence stays reviewable.
  if (!PERSONAL_PROFILE_EVIDENCE.test(profile) && BUSINESS_IDENTITY.some((pattern) => pattern.test(profile))) {
    return "명백한 공식/사업체/기관 계정";
  }
  // Language, nationality or residence alone never establishes that an account is outside the target.
  if (NO_JAPAN_AUDIENCE.test(profile) && !JAPAN_AUDIENCE.test(combined)) {
    return "일본 대상 아님을 명시";
  }
  if (CHINESE_AUDIENCE.test(profile) && !JAPAN_AUDIENCE.test(combined) && !EXPLICIT_JAPANESE_IDENTITY.test(profile)) {
    return "중화권 타깃 개인/미디어 계정";
  }
  if (UNRELATED_EXCLUSIVE.test(profile) && !CATEGORY_EVIDENCE[category].test(combined)) {
    return "다른 분야 전용 계정";
  }
  return null;
}
