import type { GoogleSearchProviderName, SearchCategory } from "./types";

const EXA_BEAUTY_QUERIES = [
  "日本人の個人美容クリエイターが韓国コスメを自分で使用し、日本の視聴者向けに日本語で使用感を継続レビューするInstagram",
  "韓国在住の日本人個人クリエイターが、韓国スキンケアと韓国美容を自分で体験し、日本語で日常として発信するInstagram",
  "渡韓を繰り返す日本人の個人クリエイターが、韓国の肌管理や美容施術を自分で体験し、日本語で日本の視聴者向けに紹介するInstagram",
  "日本の視聴者にソウルの美容と韓国生活を伝える個人のInstagram",
  "日本人の個人美容クリエイターがオリーブヤングの韓国コスメ購入品を自分で使い、日本語で使用感をレビューするInstagram",
  "最近の韓国旅行で体験した肌管理を日本語で紹介する個人のInstagram",
  "日本人の個人美容クリエイターが、韓国スキンケアを自分で使用し、使い切りやリピート品を日本語でレビューするInstagram",
  "ソウル在住で日本語の美容コンテンツを発信する個人クリエイター Instagram",
  "日本人の個人美容クリエイターが韓国の肌管理を自分で定期的に体験し、経過と感想を日本語で発信するInstagram",
  "日本人の個人美容レビュアーが韓国K-Beautyコスメを自分で使って比較し、使用感を日本語で紹介するInstagram",
  "韓国留学中の日本人個人クリエイターが、現地の韓国美容や韓国コスメを自分で体験・使用し、日本語でレビューするInstagram",
  "日本人の個人クリエイターが韓国旅行で自分が体験した美容や肌管理を、日本語で継続的に体験談として投稿するInstagram",
  "日本人の個人美容クリエイターが敏感肌向けの韓国コスメ・韓国スキンケアを自分で試し、使用感を日本語でレビューするInstagram",
  "韓国で暮らしながら日本の視聴者へ肌管理を紹介するInstagramクリエイター",
  "毎月渡韓する日本人の個人美容クリエイターが、韓国の美容スポットを自分で体験し韓国コスメも使用して、日本語で紹介するInstagram",
  "ソウルで体験した美容施術を日本語でレビューする個人のInstagram",
  "日本人の個人美容クリエイターが韓国の薬局コスメを自分で購入・使用し、使用感を日本語でレビューするInstagram",
  "韓国ワーホリ中にスキンケアと美容を発信する日本人クリエイター Instagram",
  "日本人の会社員個人クリエイターが韓国コスメを自分で購入・使用し、使い切りや愛用品を日本語でレビューするInstagram",
  "日韓夫婦の韓国生活と美容を日本語で発信する個人のInstagram",
  "韓国ひとり旅で肌管理とコスメ購入を楽しむ日本人クリエイター Instagram",
  "日本人の個人クリエイターがソウルの韓国美容や肌管理を自分で体験し、その体験談を日本語で紹介するInstagram",
  "韓国化粧品のスキンケアルーティンを紹介する日本人クリエイター Instagram",
  "在韓日本人の個人クリエイターが韓国の美容や肌管理を自分で体験し、日本語で個人レビューとして発信するInstagram",
  "日本人の個人美容クリエイターが大人肌向けの韓国スキンケアを自分で使用し、日本語で継続レビューするInstagram",
  "韓国在住の日本人個人クリエイターが韓国K-Beautyコスメを自分で使い、日本の視聴者向けに日本語でレビューするInstagram",
  "何度も渡韓する日本人の個人クリエイターが、韓国の肌管理を自分で体験し、日本語で日本の視聴者向けに体験談を投稿するInstagram",
  "日本人の個人美容クリエイターが韓国の江南や明洞で自分が受けた美容施術・肌管理を、日本語で体験談として紹介するInstagram",
  "日本人の個人美容クリエイターが韓国コスメの新作や愛用品を自分で使い、日本語で日本の視聴者向けに紹介するInstagram",
  "韓国生活の美容VLOGを日本の視聴者に発信する個人クリエイター Instagram",
];

const EXA_FOOD_QUERIES = [
  "日本語でソウルの食べ歩きと韓国グルメを紹介する個人のInstagram",
  "韓国在住の日本人が現地の飲食店を訪問して紹介するInstagram",
  "繰り返し渡韓してソウルのカフェやグルメを発信する日本人クリエイター Instagram",
  "日本の視聴者に韓国生活とソウルの飲食店を紹介する個人のInstagram",
  "韓国旅行で訪れたレストランを自分の体験でレビューする日本人のInstagram",
  "ソウル在住で日本語のカフェ巡りを発信する個人クリエイター Instagram",
  "韓国のローカル食堂を繰り返し訪問して紹介する日本人のInstagram",
  "日本語で韓国グルメとカフェの訪問記を継続投稿するInstagramクリエイター",
  "渡韓のたびにソウルの新しい飲食店を紹介する日本人のInstagram",
  "韓国留学中に現地の食べ歩きを紹介する日本人クリエイター Instagram",
  "聖水のカフェを自分で巡って日本語で紹介する個人のInstagram",
  "韓国で暮らしながら日本向けにソウルグルメを発信するInstagramクリエイター",
  "韓国ひとり旅で一人ごはんのお店を紹介する日本人のInstagram",
  "日韓夫婦の韓国生活と外食を日本語で発信する個人のInstagram",
  "ソウルの焼肉や韓国料理店を食べ歩く日本人クリエイター Instagram",
  "韓国旅行のグルメVLOGを日本語で発信する個人のInstagram",
  "明洞や弘大で実際に食べた料理をレビューする日本人のInstagram",
  "韓国ワーホリ中にカフェと飲食店を日本語で紹介するInstagram",
  "毎月渡韓してお気に入りのソウルグルメを紹介する日本人のInstagram",
  "在韓日本人が普段通う韓国のローカル食堂を紹介するInstagram",
  "韓国市場の食べ歩きや屋台を日本語で紹介する個人クリエイター Instagram",
  "ソウルに暮らすクリエイターが日本語でカフェの訪問記を発信するInstagram",
  "何度も韓国を訪れてグルメと旅行情報を投稿する日本人のInstagram",
  "日本語で韓国の居酒屋や夜ごはんを紹介する個人のInstagram",
  "カンジャンケジャンを韓国で食べ比べて紹介する日本人のInstagram",
  "韓国在住で日本の視聴者に飲食店を紹介する個人クリエイター Instagram",
  "韓国のカフェとスイーツを継続レビューする日本語のInstagram",
  "釜山とソウルを訪れて現地のグルメを紹介する日本人クリエイター Instagram",
  "韓国の食べ歩き旅行を自分の写真と動画で発信する日本人のInstagram",
  "日本語で韓国生活の外食とカフェ巡りを発信する個人のInstagram",
];

const TAVILY_BEAUTY_QUERIES = [
  "日本人 韓国美容 個人クリエイター Instagram",
  "韓国コスメ 日本語 個人レビュー Instagram",
  "渡韓 美容 体験談 日本人 Instagram",
  "韓国在住 日本人 美容 日常 Instagram",
  "ソウル 美容 日本人 体験記 Instagram",
  "韓国スキンケア 愛用品 日本語 Instagram",
  "オリーブヤング 購入品 日本人 個人 Instagram",
  "韓国旅行 美容 VLOG 日本人 Instagram",
  "江南 肌管理 日本人 体験 Instagram",
  "聖水 韓国美容 日本語 クリエイター Instagram",
  "韓国留学 美容 日本人 日常 Instagram",
  "韓国ワーホリ 美容 日本人 Instagram",
  "在韓日本人 コスメ 日常 Instagram",
  "韓国ひとり旅 美容 日本人 Instagram",
  "最近 渡韓 美容 日本人 Instagram",
  "韓国生活 美容 日本語 個人 Instagram",
  "韓国美容 何度も 渡韓 日本人 Instagram",
  "ソウル暮らし 美容 日本人 Instagram",
];

const TAVILY_FOOD_QUERIES = [
  "日本人 韓国グルメ 個人クリエイター Instagram",
  "ソウル グルメ 日本語 個人 Instagram",
  "韓国在住 日本人 グルメ 日常 Instagram",
  "渡韓 グルメ 体験談 日本人 Instagram",
  "韓国 カフェ 日本人 個人 Instagram",
  "ソウル カフェ 日本語 クリエイター Instagram",
  "韓国 食べ歩き 日本人 旅行 Instagram",
  "韓国旅行 グルメ VLOG 日本人 Instagram",
  "在韓日本人 カフェ 日常 Instagram",
  "韓国生活 グルメ 日本語 個人 Instagram",
  "弘大 グルメ 日本人 体験 Instagram",
  "聖水 カフェ 日本人 訪問記 Instagram",
  "明洞 グルメ 日本人 旅行 Instagram",
  "韓国 ローカルグルメ 日本語 Instagram",
  "韓国 市場 食べ歩き 日本人 Instagram",
  "韓国ひとり旅 グルメ 日本人 Instagram",
  "最近 渡韓 グルメ 日本人 Instagram",
  "ソウル暮らし 外食 日本人 Instagram",
];

const SERPER_BEAUTY_QUERIES = [
  "site:instagram.com 韓国美容 肌管理 レビュー",
  "site:instagram.com 韓国在住 美容",
  "site:instagram.com \"韓国コスメ\" \"日本人\" \"Instagram photos and videos\" -inurl:/p/ -inurl:/reel/ -inurl:/reels/",
  "site:instagram.com 渡韓 美容 体験",
  "site:instagram.com ソウル 美容 日本語",
  "site:instagram.com 韓国スキンケア 使い切り",
  "site:instagram.com 韓国生活 コスメ",
  "site:instagram.com オリーブヤング 購入品",
  "site:instagram.com 韓国美容 施術 経過",
  "site:instagram.com ソウル在住 スキンケア",
  "site:instagram.com 韓国コスメ リピート",
  "site:instagram.com 渡韓歴 美容",
  "site:instagram.com 韓国留学 美容",
  "site:instagram.com 韓国薬局 コスメ レビュー",
  "site:instagram.com 在韓日本人 肌管理",
  "site:instagram.com Kbeauty コスメ好き",
];

const SERPER_FOOD_QUERIES = [
  "site:instagram.com 韓国グルメ 食べ歩き",
  "site:instagram.com 韓国在住 グルメ",
  "site:instagram.com ソウル グルメ おすすめ",
  "site:instagram.com 渡韓 カフェ",
  "site:instagram.com 韓国旅行 グルメ",
  "site:instagram.com 韓国生活 カフェ巡り",
  "site:instagram.com ソウル ひとりごはん",
  "site:instagram.com 韓国 グルメ リピート",
  "site:instagram.com 韓国 カフェ 訪問記",
  "site:instagram.com ソウル在住 グルメ",
  "site:instagram.com 韓国旅行 食べ歩き VLOG",
  "site:instagram.com 渡韓歴 グルメ",
  "site:instagram.com 在韓日本人 カフェ",
  "site:instagram.com 韓国 市場 食べ歩き",
  "site:instagram.com 韓国暮らし 外食",
  "site:instagram.com 韓国 ローカルグルメ 日本語",
];

const SERPAPI_BEAUTY_QUERIES = [
  "site:instagram.com 江南 肌管理 体験記",
  "site:instagram.com 在韓 日本人 美容",
  "site:instagram.com 韓国化粧品 正直レビュー",
  "site:instagram.com 毎月渡韓 美容",
  "site:instagram.com ソウル暮らし コスメ",
  "site:instagram.com 韓国コスメ スキンケアルーティン",
  "site:instagram.com 日韓夫婦 美容",
  "site:instagram.com 明洞 美容 施術レポ",
  "site:instagram.com 韓国美容 大人肌",
  "site:instagram.com 韓国在住 日本語 スキンケア",
  "site:instagram.com 韓国コスメ 比較レビュー",
  "site:instagram.com 韓国ひとり旅 肌管理",
  "site:instagram.com 韓国ワーホリ コスメ",
  "site:instagram.com オリーブヤング リピ買い",
  "site:instagram.com 韓国生活 美容 VLOG",
  "site:instagram.com 渡韓美容 クリニック 体験",
];

const SERPAPI_FOOD_QUERIES = [
  "site:instagram.com 弘大 グルメ 食レポ",
  "site:instagram.com 在韓 日本人 食べ歩き",
  "site:instagram.com 聖水 カフェ巡り",
  "site:instagram.com 毎月渡韓 グルメ",
  "site:instagram.com ソウル暮らし 食堂",
  "site:instagram.com カンジャンケジャン 食べ比べ 韓国",
  "site:instagram.com 日韓夫婦 韓国 外食",
  "site:instagram.com 明洞 グルメ 旅行記",
  "site:instagram.com 麻浦 グルメ レビュー",
  "site:instagram.com 韓国在住 日本語 カフェ",
  "site:instagram.com 韓国 焼肉 実食",
  "site:instagram.com 韓国ひとり旅 ごはん",
  "site:instagram.com 韓国ワーホリ カフェ巡り",
  "site:instagram.com 韓国 ポジャンマチャ 食べ歩き",
  "site:instagram.com 韓国生活 グルメ VLOG",
  "site:instagram.com 釜山 カフェ 訪問記",
];

const STANDARD_QUERY_COUNT = 12;
const GOOGLE_QUERY_COUNT = 8;

export function getExaQueryPlan(category: SearchCategory, runNo = 1) {
  const queries = category === "beauty" ? EXA_BEAUTY_QUERIES : EXA_FOOD_QUERIES;
  return rotateWindow(queries, runNo, STANDARD_QUERY_COUNT);
}

export function getTavilyQueryPlan(category: SearchCategory, runNo = 1) {
  const queries = category === "beauty" ? TAVILY_BEAUTY_QUERIES : TAVILY_FOOD_QUERIES;
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

export type StandardQueryFamily = {
  name: string;
  exa: string[];
  tavily: string[];
};

const STANDARD_EXA_RELAXED_FAMILIES: Record<SearchCategory, Record<string, string[]>> = {
  beauty: {
    beauty: [
      "韓国コスメ 日本人 Instagram クリエイター",
      "K-Beauty 日本人 レビュー Instagram",
      "韓国スキンケア 日本語 Instagram",
    ],
    travel: [
      "渡韓 韓国美容 日本人 Instagram",
      "韓国旅行 肌管理 日本人 Instagram",
      "韓国美容 体験談 日本語 Instagram",
    ],
    locale: [
      "ソウル 美容 日本人 Instagram",
      "江南 肌管理 日本人 Instagram",
      "聖水 韓国美容 日本語 Instagram",
    ],
    resident: [
      "韓国在住 日本人 美容 Instagram",
      "在韓日本人 K-Beauty Instagram",
      "韓国ワーホリ 日本人 美容 Instagram",
    ],
    recent: [
      "最近 渡韓 美容 日本人 Instagram",
      "韓国美容 新作 日本人 Instagram",
      "韓国コスメ 最近 レビュー 日本人 Instagram",
    ],
  },
  food: {
    food: [
      "韓国グルメ 日本人 Instagram クリエイター",
      "ソウルグルメ 日本語 Instagram",
      "韓国カフェ 日本人 Instagram",
    ],
    travel: [
      "渡韓 グルメ 日本人 Instagram",
      "韓国旅行 グルメ 日本人 Instagram",
      "韓国旅行 カフェ 日本語 Instagram",
    ],
    locale: [
      "ソウル カフェ 日本人 Instagram",
      "聖水 カフェ 日本人 Instagram",
      "弘大 グルメ 日本人 Instagram",
    ],
    resident: [
      "韓国在住 日本人 グルメ Instagram",
      "在韓日本人 カフェ Instagram",
      "韓国生活 外食 日本語 Instagram",
    ],
    recent: [
      "最近 渡韓 グルメ 日本人 Instagram",
      "ソウル 新店 日本語 Instagram",
      "韓国カフェ 最近 日本人 Instagram",
    ],
  },
};

const STANDARD_COMMERCIAL_FAMILIES: Record<SearchCategory, StandardQueryFamily> = {
  beauty: {
    name: "commercial-intent",
    exa: [
      "韓国美容 有償PR 日本人 Instagram",
      "韓国コスメ タイアップ 日本人 Instagram",
      "韓国美容 お仕事依頼 日本人 Instagram",
    ],
    tavily: [
      "韓国美容 有償PR 日本人 Instagram",
      "韓国コスメ タイアップ 日本人 Instagram",
      "韓国美容 提供 お仕事依頼 日本人 Instagram",
    ],
  },
  food: {
    name: "commercial-intent",
    exa: [
      "韓国グルメ PR 日本人 Instagram",
      "ソウルグルメ タイアップ 日本人 Instagram",
      "韓国カフェ お仕事依頼 日本人 Instagram",
    ],
    tavily: [
      "韓国グルメ PR 日本人 Instagram",
      "ソウルグルメ タイアップ 日本人 Instagram",
      "韓国カフェ 提供 お仕事依頼 日本人 Instagram",
    ],
  },
};

export type GoogleQueryFamily = {
  name: string;
  queries: string[];
};

type StandardFamilyIndexSpec = {
  name: string;
  exa: number[];
  tavily: number[];
};

type GoogleFamilyIndexSpec = {
  name: string;
  indexes: number[];
};

const STANDARD_FAMILY_INDEXES: Record<SearchCategory, StandardFamilyIndexSpec[]> = {
  beauty: [
    { name: "beauty", exa: [0, 4, 6, 9, 16, 18, 24, 25, 28], tavily: [0, 1, 5, 6] },
    { name: "travel", exa: [2, 5, 11, 14, 20, 26, 29], tavily: [2, 7, 13] },
    { name: "locale", exa: [3, 15, 21, 27], tavily: [4, 8, 9, 17] },
    { name: "resident", exa: [1, 7, 10, 12, 13, 17, 19, 23], tavily: [3, 10, 11, 12, 15] },
    { name: "recent", exa: [8, 22, 24, 26, 28], tavily: [2, 7, 14, 16] },
  ],
  food: [
    { name: "food", exa: [0, 3, 6, 10, 14, 24, 26], tavily: [0, 1, 4, 5, 6] },
    { name: "travel", exa: [8, 12, 15, 18, 22, 28], tavily: [3, 7, 15, 16] },
    { name: "locale", exa: [10, 16, 20, 21, 27], tavily: [10, 11, 12, 13, 14, 17] },
    { name: "resident", exa: [1, 5, 9, 13, 17, 19, 25, 29], tavily: [2, 8, 9] },
    { name: "recent", exa: [8, 15, 18, 22, 28], tavily: [3, 7, 15, 16] },
  ],
};

const GOOGLE_FAMILY_INDEXES: Record<SearchCategory, GoogleFamilyIndexSpec[]> = {
  beauty: [
    { name: "beauty", indexes: [0, 2, 5, 7, 10, 13] },
    { name: "travel", indexes: [3, 11, 12, 15] },
    { name: "locale", indexes: [4, 8, 9, 13] },
    { name: "resident", indexes: [1, 6, 12, 14] },
    { name: "recent", indexes: [3, 8, 11, 15] },
  ],
  food: [
    { name: "food", indexes: [0, 2, 4, 6, 10] },
    { name: "travel", indexes: [3, 10, 11, 15] },
    { name: "locale", indexes: [1, 7, 8, 13, 15] },
    { name: "resident", indexes: [1, 6, 12, 14] },
    { name: "recent", indexes: [3, 5, 9, 14] },
  ],
};

export function getStandardQueryFamilyPlan(category: SearchCategory, runNo = 1): StandardQueryFamily[] {
  const tavilyPool = category === "beauty" ? TAVILY_BEAUTY_QUERIES : TAVILY_FOOD_QUERIES;
  const relaxedExaFamilies = STANDARD_EXA_RELAXED_FAMILIES[category];
  const baseFamilies = STANDARD_FAMILY_INDEXES[category].map((family, familyIndex) => ({
    name: family.name,
    exa: rotateWindow(relaxedExaFamilies[family.name] ?? [], runNo + familyIndex, 3),
    tavily: selectIndexedQueries(tavilyPool, family.tavily, runNo + familyIndex, 3),
  }));
  if (category === "beauty") return baseFamilies;
  const commercial = STANDARD_COMMERCIAL_FAMILIES[category];
  return [
    ...baseFamilies,
    {
      ...commercial,
      exa: rotateWindow(commercial.exa, runNo, commercial.exa.length),
      tavily: rotateWindow(commercial.tavily, runNo, commercial.tavily.length),
    },
  ];
}

const GOOGLE_EXPANSION_FAMILIES: Record<SearchCategory, GoogleQueryFamily[]> = {
  beauty: [
    {
      name: "commercial-intent",
      queries: [
        "site:instagram.com -inurl:/p/ -inurl:/reel/ 韓国美容 有償PR 日本人 Instagram",
        "site:instagram.com 韓国コスメ タイアップ 日本人",
        "site:instagram.com 韓国美容 お仕事依頼 日本人",
        "site:instagram.com 韓国美容 提供 日本人",
      ],
    },
    {
      name: "resident-workstudy",
      queries: [
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "韓国在住" "日本人"',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "在韓日本人"',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "韓国" "ワーホリ" "日常"',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "韓国留学" "暮らし"',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "ソウル在住" "日本人"',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "韓国ワーホリ" "日本人"',
      ],
    },
    {
      name: "repeat-travel",
      queries: [
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "毎月渡韓" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "月1渡韓" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "渡韓歴" "日常" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "渡韓回数" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "韓国" "年に" "回" "旅行" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "日本" "韓国" "行き来" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
      ],
    },
    {
      name: "age-skin",
      queries: [
        "site:instagram.com 韓国美容 30代 日本人",
        "site:instagram.com 韓国美容 40代 日本人",
        "site:instagram.com \"韓国美容\" \"日本人\" \"50代\" \"posts\" -inurl:/p/ -inurl:/reel/ -inurl:/reels/",
        "site:instagram.com 韓国コスメ 乾燥肌 日本人",
        "site:instagram.com 韓国コスメ 敏感肌 日本人",
        "site:instagram.com 韓国美容 エイジング 日本人",
        "site:instagram.com 韓国スキンケア 大人肌 日本人",
      ],
    },
    {
      name: "local-clinic",
      queries: [
        "site:instagram.com 江南 肌管理 日本人 体験",
        "site:instagram.com 明洞 肌管理 日本人 レビュー",
        "site:instagram.com 聖水 韓国美容 日本人",
        "site:instagram.com 韓国 クリニック 体験記 日本人",
        "site:instagram.com ソウル 肌管理 日本語 レビュー",
        "site:instagram.com 韓国美容 クリニック 個人 体験談",
      ],
    },
    {
      name: "review-intent",
      queries: [
        "site:instagram.com -inurl:/p/ -inurl:/reel/ オリーブヤング 購入品 日本人 Instagram",
        "site:instagram.com \"Kbeauty\" \"日本人\" \"Instagram photos and videos\" -inurl:/p/ -inurl:/reel/ -inurl:/reels/",
        "site:instagram.com 韓国スキンケア 日本語 個人レビュー",
        "site:instagram.com \"韓国コスメ\" \"日本人\" \"Instagram photos and videos\" -inurl:/p/ -inurl:/reel/ -inurl:/reels/",
        "site:instagram.com 韓国コスメ 使い切り 日本人",
        "site:instagram.com 韓国美容 正直レビュー 日本人",
        "site:instagram.com 韓国コスメ 日本語 口コミ 個人",
      ],
    },
    {
      name: "resident-lifestyle",
      queries: [
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "日韓夫婦" "韓国生活" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "韓国在住" "ママ" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "ソウル暮らし" "日本人" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "韓国生活" "ファッション" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "韓国在住" "日常" "コスメ" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
        'site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ ("followers" OR "フォロワー") "在韓日本人" "ライフスタイル" ("美容" OR "コスメ" OR "スキンケア" OR "韓国コスメ" OR "K-Beauty" OR "美容医療" OR "韓国美容")',
      ],
    },
    {
      name: "kbeauty-creator",
      queries: [
        "site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ 韓国コスメ 日本人 クリエイター 個人 Instagram",
        "site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ K-beauty 日本人 ライフスタイル creator",
        "site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ オリーブヤング 日本人 ママ 購入品",
        "site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ 韓国スキンケア 日本人 会社員 レビュー",
        "site:instagram.com -site:instagram.com/p/ -site:instagram.com/reel/ -site:instagram.com/reels/ -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:/explore/ 韓国美容 日本人 日常 VLOG",
      ],
    },
  ],
  food: [
    {
      name: "commercial-intent",
      queries: [
        "site:instagram.com 韓国グルメ PR 日本人",
        "site:instagram.com ソウルグルメ タイアップ 日本人",
        "site:instagram.com 韓国カフェ お仕事依頼 日本人",
        "site:instagram.com 韓国グルメ 提供 日本人",
      ],
    },
    {
      name: "resident-workstudy",
      queries: [
        "site:instagram.com 韓国在住 日本人 ソウルグルメ",
        "site:instagram.com 在韓日本人 韓国グルメ 日常",
        "site:instagram.com 韓国 ワーホリ 日本人 グルメ",
        "site:instagram.com 韓国 留学 日本人 カフェ グルメ",
        "site:instagram.com ソウル生活 日本人 外食",
      ],
    },
    {
      name: "repeat-travel",
      queries: [
        "site:instagram.com 毎月渡韓 日本人 グルメ",
        "site:instagram.com 頻繁に渡韓 日本人 ソウルグルメ",
        "site:instagram.com 韓国旅行 グルメ 日本人 個人",
        "site:instagram.com 韓国旅行 カフェ 日本人 レビュー",
        "site:instagram.com 渡韓 グルメ 日本語 体験談",
      ],
    },
    {
      name: "seoul-local",
      queries: [
        "site:instagram.com 聖水 カフェ 日本人 個人",
        "site:instagram.com 弘大 グルメ 日本人 レビュー",
        "site:instagram.com 明洞 グルメ 日本人 体験",
        "site:instagram.com 麻浦 グルメ 日本人",
        "site:instagram.com ソウル カフェ巡り 日本人",
      ],
    },
    {
      name: "local-eating",
      queries: [
        "site:instagram.com 韓国 ひとりごはん 日本人",
        "site:instagram.com 韓国 ローカル食堂 日本人",
        "site:instagram.com 韓国 市場 食べ歩き 日本人",
        "site:instagram.com 韓国 屋台 ポジャンマチャ 日本人",
        "site:instagram.com 韓国 日常 外食 日本人",
      ],
    },
    {
      name: "review-intent",
      queries: [
        "site:instagram.com 韓国 カフェ巡り 日本人 個人レビュー",
        "site:instagram.com 韓国グルメ リピート 日本人",
        "site:instagram.com ソウルグルメ 再訪 日本人",
        "site:instagram.com 韓国グルメ 日本語 口コミ 個人",
        "site:instagram.com 韓国旅行 グルメ 正直レビュー 日本人",
      ],
    },
  ],
};

export function getGoogleQueryFamilyPlan(
  category: SearchCategory,
  runNo: number,
  provider: GoogleSearchProviderName,
): GoogleQueryFamily[] {
  const pool = provider === "serper"
    ? category === "beauty" ? SERPER_BEAUTY_QUERIES : SERPER_FOOD_QUERIES
    : category === "beauty" ? SERPAPI_BEAUTY_QUERIES : SERPAPI_FOOD_QUERIES;
  const providerShift = provider === "serper" ? 0 : 1;
  const baseFamilies = GOOGLE_FAMILY_INDEXES[category].map((family, familyIndex) => ({
    name: family.name,
    queries: selectIndexedQueries(pool, family.indexes, runNo + familyIndex + providerShift, 2),
  }));
  const expansionSource = category === "beauty"
    ? GOOGLE_EXPANSION_FAMILIES[category].filter((family) => family.name !== "commercial-intent")
    : GOOGLE_EXPANSION_FAMILIES[category];
  const expansionFamilies = expansionSource.map((family, familyIndex) => ({
    name: family.name,
    queries: rotateWindow(family.queries, runNo + familyIndex + providerShift, 2),
  }));
  const combinedFamilies: GoogleQueryFamily[] = [];
  const familyCount = Math.max(baseFamilies.length, expansionFamilies.length);
  for (let index = 0; index < familyCount; index += 1) {
    if (baseFamilies[index]) combinedFamilies.push(baseFamilies[index]);
    if (expansionFamilies[index]) combinedFamilies.push(expansionFamilies[index]);
  }
  const normalizedRun = Math.max(1, Number.isFinite(runNo) ? Math.floor(runNo) : 1);
  const familyStart = (normalizedRun - 1) % combinedFamilies.length;
  const rotated = [...combinedFamilies.slice(familyStart), ...combinedFamilies.slice(0, familyStart)];
  if (category !== "beauty") return rotated;
  const accessFamilies = new Set(["repeat-travel", "resident-workstudy", "resident-lifestyle"]);
  return [...rotated.filter((family) => accessFamilies.has(family.name)), ...rotated.filter((family) => !accessFamilies.has(family.name))];
}


export type GoogleSeedQuery = {
  name: string;
  query: string;
};

const GOOGLE_BEAUTY_SEEDS: GoogleSeedQuery[] = [
  {
    name: "brand:xenia.clinic",
    query: 'site:instagram.com "XENIA" 日本人 "Instagram photos and videos" -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:xenia.clinic',
  },
  {
    name: "brand:tirtir_jp",
    query: 'site:instagram.com "TIRTIR" 日本人 "Instagram photos and videos" -inurl:/p/ -inurl:/reel/ -inurl:/reels/ -inurl:tirtir_jp',
  },
];

export function getCreatorNeighborSeedQueries(
  category: SearchCategory,
  handles: string[],
): GoogleSeedQuery[] {
  const categoryTerms = category === "beauty" ? "韓国美容 K-Beauty" : "韓国グルメ 韓国カフェ";
  return handles.slice(0, 2).map((handle) => ({
    name: `creator:${handle}`,
    query: `site:instagram.com "${handle}" -inurl:${handle} -inurl:/p/ -inurl:/reel/ -inurl:/reels/ (${categoryTerms})`,
  }));
}

export function getGoogleSeedQueryPlan(category: SearchCategory, runNo = 1): GoogleSeedQuery[] {
  if (category !== "beauty") return [];
  const normalizedRun = Math.max(1, Number.isFinite(runNo) ? Math.floor(runNo) : 1);
  const start = (normalizedRun - 1) % GOOGLE_BEAUTY_SEEDS.length;
  return [...GOOGLE_BEAUTY_SEEDS.slice(start), ...GOOGLE_BEAUTY_SEEDS.slice(0, start)];
}

function selectIndexedQueries(pool: string[], indexes: number[], runNo: number, count: number) {
  const validIndexes = indexes.filter((index) => index >= 0 && index < pool.length);
  if (!validIndexes.length) return [];
  const take = Math.min(count, validIndexes.length);
  const normalizedRun = Math.max(1, Number.isFinite(runNo) ? Math.floor(runNo) : 1);
  const start = (normalizedRun - 1) % validIndexes.length;
  return Array.from({ length: take }, (_, offset) => pool[validIndexes[(start + offset) % validIndexes.length]]);
}

export const FOOD_REVIEW_SIGNALS = ["レシピ", "おうちごはん", "自炊", "料理教室", "recipe", "cooking"];
