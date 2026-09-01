import type { SearchCategory } from "./types";

const BEAUTY_QUERIES = [
  "site:instagram.com 韓国在住 日本人 韓国美容 美容医療",
  "site:instagram.com 韓国在住 日本人 韓国コスメ スキンケア",
  "site:instagram.com 渡韓 美容 日本人 クリエイター Instagram",
  "site:instagram.com 韓国美容 肌管理 日本人 Instagram",
  "site:instagram.com 韓国 美容医療 日本人 リール Instagram",
  "site:instagram.com 韓国コスメ 日本人 クリエイター Instagram",
  "site:instagram.com ソウル 美容 日本人 インフルエンサー",
  "site:instagram.com 釜山 美容 日本人 インフルエンサー",
  "site:instagram.com 韓国在住 日本人 美容 リール",
  "site:instagram.com 渡韓美容 韓国クリニック 日本人",
  "site:instagram.com 韓国スキンケア 日本人 リール",
  "site:instagram.com 韓国美容 1万人 Instagram 日本人",
  "site:instagram.com 美容医療 1万人 韓国 Instagram",
  "site:instagram.com 韓国コスメ 1万 フォロワー 日本人",
  "site:instagram.com 韓国旅行 美容 コスメ 日本人 Instagram",
  "site:instagram.com 日韓夫婦 美容 韓国 Instagram",
  "site:instagram.com 韓国留学 美容 コスメ 日本人",
  "site:instagram.com 韓国 ワーホリ 美容 日本人 Instagram",
  "site:instagram.com 韓国生活 美容 日本人 creator Instagram",
  "site:instagram.com Kbeauty 日本人 韓国 Instagram",
  "site:instagram.com 韓国 美肌 日本人 インスタ",
  "site:instagram.com 江南 美容 日本人 Instagram",
  "site:instagram.com 明洞 美容 日本人 Instagram",
  "site:instagram.com 韓国美容 旅行 日本語 Instagram",
];

const FOOD_QUERIES = [
  "site:instagram.com 韓国在住 日本人 韓国グルメ Instagram",
  "site:instagram.com ソウルグルメ 日本人 リール Instagram",
  "site:instagram.com 韓国グルメ 日本人 クリエイター Instagram",
  "site:instagram.com 渡韓 グルメ 日本人 Instagram",
  "site:instagram.com 韓国旅行 グルメ 日本人 リール",
  "site:instagram.com 韓国在住 日本人 カフェ グルメ",
  "site:instagram.com ソウル 日本人 グルメ インフルエンサー",
  "site:instagram.com 釜山 日本人 グルメ インフルエンサー",
  "site:instagram.com 韓国グルメ 1万人 Instagram 日本人",
  "site:instagram.com ソウルグルメ 1万 フォロワー 日本人",
  "site:instagram.com 韓国旅行 1万人 グルメ Instagram",
  "site:instagram.com 韓国生活 グルメ 日本人 Instagram",
  "site:instagram.com 日韓夫婦 韓国グルメ Instagram",
  "site:instagram.com 韓国留学 グルメ 日本人 Instagram",
  "site:instagram.com 韓国 ワーホリ グルメ 日本人",
  "site:instagram.com 麻浦 グルメ 日本人 Instagram",
  "site:instagram.com 弘大 グルメ 日本人 Instagram",
  "site:instagram.com 明洞 グルメ 日本人 Instagram",
  "site:instagram.com 江南 グルメ 日本人 Instagram",
  "site:instagram.com カンジャンケジャン 日本人 Instagram 韓国",
  "site:instagram.com 韓国料理 店 日本人 旅行 Instagram",
  "site:instagram.com 韓国 カフェ巡り 日本人 リール",
  "site:instagram.com 韓国 食べ歩き 日本人 Instagram",
  "site:instagram.com 韓国 グルメ 日本語 creator Instagram",
];

const BEAUTY_EXPANSIONS = [
  "",
  "2026 最新",
  "リール VLOG",
  "体験 レビュー",
  "月1 渡韓",
  "韓国在住",
  "ソウル 釜山",
  "コスメ 美容医療",
];

const FOOD_EXPANSIONS = [
  "",
  "2026 最新",
  "リール VLOG",
  "食べ歩き レビュー",
  "月1 渡韓",
  "韓国在住",
  "ソウル 釜山",
  "ローカル グルメ",
];

export function getQueryPlan(category: SearchCategory, runNo = 1) {
  const base = category === "beauty" ? BEAUTY_QUERIES : FOOD_QUERIES;
  const expansions = category === "beauty" ? BEAUTY_EXPANSIONS : FOOD_EXPANSIONS;
  const suffix = expansions[Math.max(0, runNo - 1) % expansions.length];
  if (!suffix) return base;
  return base.map((query) => `${query} ${suffix}`);
}

export const FOOD_REVIEW_SIGNALS = ["レシピ", "おうちごはん", "自炊", "料理教室", "recipe", "cooking"];
