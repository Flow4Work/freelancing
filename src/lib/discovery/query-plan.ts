import type { GoogleSearchProviderName, SearchCategory } from "./types";

const BEAUTY_QUERIES = [
  "site:instagram.com 韓国美容 肌管理 日本人 Instagram",
  "site:instagram.com 韓国クリニック 美容医療 体験 日本人 Instagram",
  "site:instagram.com 韓国コスメ スキンケア 日本人 Instagram",
  "site:instagram.com オリーブヤング 購入品 日本人 Instagram",
  "site:instagram.com 韓国薬局 コスメ 美容 日本人 Instagram",
  "site:instagram.com 韓国ショッピング 美容 購入品 日本人 Instagram",
  "site:instagram.com 渡韓 美容 日本人 旅行 Instagram",
  "site:instagram.com 韓国旅行 美容 コスメ 日本人 Instagram",
  "site:instagram.com 韓国ひとり旅 美容 日本人 Instagram",
  "site:instagram.com 韓国在住 日本人 美容 ライフスタイル Instagram",
  "site:instagram.com 韓国留学 日本人 美容 コスメ Instagram",
  "site:instagram.com 韓国 ワーホリ 日本人 美容 Instagram",
  "site:instagram.com 日韓夫婦 日本人 美容 韓国 Instagram",
  "site:instagram.com 韓国美容 会社員 日本人 Instagram",
  "site:instagram.com 韓国コスメ ママ 日本人 Instagram",
  "site:instagram.com 韓国美容 40代 日本人 Instagram",
  "site:instagram.com 韓国美容 50代 日本人 Instagram",
  "site:instagram.com ソウル 美容 日本人 Instagram",
  "site:instagram.com 釜山 美容 日本人 Instagram",
  "site:instagram.com 江南 美容 日本人 Instagram",
  "site:instagram.com 明洞 美容 日本人 Instagram",
  "site:instagram.com 弘大 美容 コスメ 日本人 Instagram",
  "site:instagram.com 韓国美容 VLOG 日本人 Instagram",
  "site:instagram.com 渡韓美容 レビュー 日本人 Instagram",
  "site:instagram.com 韓国スキンケア レビュー 日本人 Instagram",
  "site:instagram.com Kbeauty 日本人 韓国 Instagram",
  "site:instagram.com 韓国 美肌 日本人 Instagram",
  "site:instagram.com 韓国美容 ブロガー 日本人 Instagram",
  "site:instagram.com 韓国コスメ 旅行好き 日本人 Instagram",
  "site:instagram.com 韓国 美容 何度も 渡韓 日本人 Instagram",
];

const FOOD_QUERIES = [
  "site:instagram.com 韓国グルメ 日本人 Instagram",
  "site:instagram.com ソウルグルメ 日本人 Instagram",
  "site:instagram.com 釜山グルメ 日本人 Instagram",
  "site:instagram.com 韓国旅行 グルメ 日本人 Instagram",
  "site:instagram.com 韓国在住 日本人 グルメ Instagram",
  "site:instagram.com 韓国留学 日本人 グルメ Instagram",
  "site:instagram.com 韓国 ワーホリ 日本人 グルメ Instagram",
  "site:instagram.com 韓国 カフェ巡り 日本人 Instagram",
  "site:instagram.com 韓国 食べ歩き 日本人 Instagram",
  "site:instagram.com 韓国料理 日本人 Instagram",
  "site:instagram.com カンジャンケジャン 日本人 韓国 Instagram",
  "site:instagram.com 韓国 焼肉 日本人 グルメ Instagram",
  "site:instagram.com 韓国 市場 ローカルグルメ 日本人 Instagram",
  "site:instagram.com 韓国 屋台 ポジャンマチャ 日本人 Instagram",
  "site:instagram.com 韓国 居酒屋 日本人 グルメ Instagram",
  "site:instagram.com 韓国 モッパン VLOG 日本人 Instagram",
  "site:instagram.com 弘大 グルメ 日本人 Instagram",
  "site:instagram.com 麻浦 グルメ 日本人 Instagram",
  "site:instagram.com 明洞 グルメ 日本人 Instagram",
  "site:instagram.com 江南 グルメ 日本人 Instagram",
  "site:instagram.com 聖水 カフェ 日本人 Instagram",
  "site:instagram.com 韓国ひとり旅 グルメ 日本人 Instagram",
  "site:instagram.com 韓国旅行 カフェ 日本人 Instagram",
  "site:instagram.com 日韓夫婦 韓国グルメ Instagram",
  "site:instagram.com 韓国生活 グルメ 日本人 Instagram",
  "site:instagram.com 韓国 ローカル 食堂 日本人 Instagram",
  "site:instagram.com 韓国 ビビンバ サムギョプサル 日本人 Instagram",
  "site:instagram.com 韓国 グルメ 会社員 日本人 Instagram",
  "site:instagram.com 韓国 グルメ ママ 日本人 Instagram",
  "site:instagram.com 韓国旅行 食べ歩き VLOG 日本人 Instagram",
];

const SERPER_BEAUTY_QUERIES = [
  "site:instagram.com 日本人 韓国美容",
  "site:instagram.com 日本人 韓国コスメ",
  "site:instagram.com 日本人 渡韓 美容",
  "site:instagram.com 日本人 韓国在住 美容",
  "site:instagram.com 日本人 韓国旅行 コスメ",
  "site:instagram.com 日本人 オリーブヤング 購入品",
  "site:instagram.com 日本人 韓国スキンケア",
  "site:instagram.com 日本人 韓国クリニック レビュー",
  "site:instagram.com 日本人 韓国薬局 美容",
  "site:instagram.com 日本人 Kbeauty Instagram",
  "site:instagram.com 日本人 ソウル 美容 Instagram",
  "site:instagram.com 日本人 釜山 美容 Instagram",
  "site:instagram.com 日本人 韓国留学 美容 Instagram",
  "site:instagram.com 日本人 韓国 ワーホリ 美容 Instagram",
  "site:instagram.com 日本人 韓国美容 VLOG Instagram",
  "site:instagram.com 日本人 韓国ショッピング コスメ Instagram",
];

const SERPER_FOOD_QUERIES = [
  "site:instagram.com 日本人 韓国グルメ",
  "site:instagram.com 日本人 ソウルグルメ",
  "site:instagram.com 日本人 釜山グルメ",
  "site:instagram.com 日本人 韓国旅行 グルメ",
  "site:instagram.com 日本人 韓国在住 グルメ",
  "site:instagram.com 日本人 韓国 カフェ巡り",
  "site:instagram.com 日本人 韓国 食べ歩き",
  "site:instagram.com 日本人 韓国料理 Instagram",
  "site:instagram.com 日本人 韓国 市場 グルメ",
  "site:instagram.com 日本人 韓国 屋台 Instagram",
  "site:instagram.com 日本人 韓国 モッパン VLOG",
  "site:instagram.com 日本人 韓国 ローカルグルメ",
  "site:instagram.com 日本人 韓国留学 グルメ Instagram",
  "site:instagram.com 日本人 韓国 ワーホリ グルメ Instagram",
  "site:instagram.com 日本人 韓国 カフェ VLOG Instagram",
  "site:instagram.com 日本人 韓国 焼肉 Instagram",
];

const SERPAPI_BEAUTY_QUERIES = [
  "site:instagram.com 江南 美容医療 日本人 体験",
  "site:instagram.com 明洞 韓国コスメ 日本人 購入品",
  "site:instagram.com 釜山 美容 日本人 旅行",
  "site:instagram.com 韓国美容 会社員 日本人",
  "site:instagram.com 韓国コスメ ママ 日本人",
  "site:instagram.com 韓国美容 40代 日本人",
  "site:instagram.com 韓国美容 50代 日本人",
  "site:instagram.com 韓国留学 スキンケア 日本人",
  "site:instagram.com 韓国 ワーホリ コスメ 日本人",
  "site:instagram.com 韓国ひとり旅 美容 日本人",
  "site:instagram.com オリーブヤング スキンケア 日本人 Instagram",
  "site:instagram.com 韓国薬局 購入品 日本人 Instagram",
  "site:instagram.com 渡韓美容 クリニック レビュー 日本人",
  "site:instagram.com 日韓夫婦 韓国美容 日本人",
  "site:instagram.com 韓国在住 ライフスタイル 美容 日本人",
  "site:instagram.com 韓国旅行 美容 VLOG 日本人",
];

const SERPAPI_FOOD_QUERIES = [
  "site:instagram.com 弘大 グルメ 日本人 旅行",
  "site:instagram.com 麻浦 ローカルグルメ 日本人",
  "site:instagram.com 明洞 韓国料理 日本人",
  "site:instagram.com 江南 グルメ 日本人 Instagram",
  "site:instagram.com 聖水 カフェ巡り 日本人",
  "site:instagram.com カンジャンケジャン 日本人 ソウル",
  "site:instagram.com 韓国 焼肉 サムギョプサル 日本人",
  "site:instagram.com 韓国 市場 食べ歩き 日本人",
  "site:instagram.com 韓国 ポジャンマチャ 日本人",
  "site:instagram.com 韓国 居酒屋 会社員 日本人",
  "site:instagram.com 韓国グルメ ママ 日本人",
  "site:instagram.com 韓国留学 カフェ 日本人",
  "site:instagram.com 韓国 ワーホリ 食べ歩き 日本人",
  "site:instagram.com 韓国ひとり旅 グルメ 日本人",
  "site:instagram.com 釜山 市場 グルメ 日本人",
  "site:instagram.com 韓国 モッパン VLOG 日本人 Instagram",
];

const STANDARD_QUERY_COUNT = 12;
const GOOGLE_QUERY_COUNT = 8;

export function getQueryPlan(category: SearchCategory, runNo = 1) {
  const queries = category === "beauty" ? BEAUTY_QUERIES : FOOD_QUERIES;
  return rotateWindow(queries, runNo, STANDARD_QUERY_COUNT);
}

export function getGoogleQueryPlan(category: SearchCategory, runNo: number, provider: GoogleSearchProviderName) {
  const queries = provider === "serper"
    ? category === "beauty" ? SERPER_BEAUTY_QUERIES : SERPER_FOOD_QUERIES
    : category === "beauty" ? SERPAPI_BEAUTY_QUERIES : SERPAPI_FOOD_QUERIES;
  return rotateWindow(queries, runNo, GOOGLE_QUERY_COUNT);
}

function rotateWindow(queries: string[], runNo: number, count: number) {
  if (!queries.length) return [];
  const take = Math.min(count, queries.length);
  const normalizedRun = Math.max(1, Number.isFinite(runNo) ? Math.floor(runNo) : 1);
  const start = ((normalizedRun - 1) * take) % queries.length;
  return Array.from({ length: take }, (_, index) => queries[(start + index) % queries.length]);
}

export const FOOD_REVIEW_SIGNALS = ["レシピ", "おうちごはん", "自炊", "料理教室", "recipe", "cooking"];
