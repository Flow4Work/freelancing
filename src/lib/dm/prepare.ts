import type { DiscoveryCandidate, DmProvider, SearchCategory } from "@/lib/discovery/types";

export const GROQ_DM_MODEL = "qwen/qwen3.8-27b";
export const SCALEWAY_DM_MODEL = "qwen3.6-35b-a3b";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const SCALEWAY_URL = "https://api.scaleway.ai/v1/chat/completions";
const SAFE_FALLBACK_LINE = "プロフィールを拝見し、ご連絡しました。";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 65_000;

const INTERNAL_EVIDENCE_PATTERN = /(?:reels?|リール|再生(?:回数|数)?|조회수|팔로워|followers?|following|平均|평균|\b8\s*\/\s*8\b|\b\d+건\b|순위|順位|verified|qualified|검증|検証|모집조건|条件\s*(?:충족|通過)?|중복|重複|후보|候補|판정|判定|공개.?개인|개인\s*계정|최근\s*게시일|null|log\s*in|sign\s*up|photo\s*by|video\s*by|show\s*more|highlight\s*story|read\s*more)/i;
const INTERNAL_OUTPUT_PATTERN = /(?:reels?|リール|再生(?:回数|数)?|조회수|팔로워|フォロワ|followers?|平均|평균|8\s*\/\s*8|8件|順位|verified|qualified|検証|검증|条件|모집조건|重複|중복|候補|후보|判定|판정|点に惹かれ)/i;
const CASUAL_TONE_PATTERN = /(?:日常|ライフスタイル|旅行|旅|カフェ|コーデ|ファッション|ママ|夫婦|好き|愛用|暮らし|vlog|daily|lifestyle|travel|fashion|카페|여행|일상|패션|부부|애정)/i;

type PersonalizationBasis = {
  source: string;
  text: string;
};

type OfferStyle = "paid" | "reward" | "fee" | "job";

export type PreparedDm = {
  handle: string;
  personalizationSource: string;
  personalizationBasis: string;
  personalizationLine: string;
  dmText: string;
  koreanText: string;
  provider: DmProvider;
  model: string;
  generatedAt: string;
};

export async function prepareCandidateDm(candidate: DiscoveryCandidate): Promise<PreparedDm> {
  const basis = selectPersonalizationBasis(candidate);
  const generated = await generatePersonalizationLine(candidate.handle, basis);
  const offerStyle = selectOfferStyle(candidate.handle, basis);
  const dmText = composeDm(candidate.category, generated.line, offerStyle);
  const koreanText = await translateDmToKorean(dmText);

  return {
    handle: candidate.handle,
    personalizationSource: basis.source,
    personalizationBasis: basis.text,
    personalizationLine: generated.line,
    dmText,
    koreanText,
    provider: generated.provider,
    model: generated.model,
    generatedAt: new Date().toISOString(),
  };
}

export function selectPersonalizationBasis(candidate: DiscoveryCandidate): PersonalizationBasis {
  const rawOptions = [
    candidate.bio ? { source: "BIO", text: candidate.bio, base: 90 } : null,
    candidate.evidenceText ? { source: "기존 확인 근거", text: candidate.evidenceText, base: 74 } : null,
    candidate.verificationNote ? { source: "최종 검증 메모", text: candidate.verificationNote, base: 70 } : null,
    candidate.targetSignals.length || candidate.koreaSignals.length
      ? { source: "구조화 신호", text: [...candidate.targetSignals, ...candidate.koreaSignals].join(" · "), base: 48 }
      : null,
  ].filter((item): item is { source: string; text: string; base: number } => Boolean(item));

  const options = rawOptions
    .map((item) => ({ ...item, text: sanitizePersonalizationEvidence(item.text) }))
    .filter((item) => Boolean(item.text));

  if (!options.length) {
    return { source: "일반", text: "확인된 개인화 근거 없음" };
  }

  const categoryTerms = candidate.category === "beauty"
    ? ["美容", "コスメ", "スキン", "beauty", "cosmetic", "skincare", "미용", "뷰티", "화장", "피부"]
    : ["グルメ", "カフェ", "食", "food", "restaurant", "맛집", "카페", "음식"];
  const koreaTerms = ["韓国", "ソウル", "釜山", "korea", "seoul", "busan", "한국", "서울", "부산", "渡韓"];

  const scored = options.map((item) => {
    const normalized = item.text.toLowerCase();
    const categoryHits = Math.min(2, categoryTerms.filter((term) => normalized.includes(term.toLowerCase())).length);
    const koreaHits = Math.min(2, koreaTerms.filter((term) => normalized.includes(term.toLowerCase())).length);
    const detailBonus = Math.min(5, Math.floor(item.text.length / 100));
    return { ...item, score: item.base + categoryHits * 5 + koreaHits * 4 + detailBonus };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return { source: best.source, text: compact(best.text, 600) };
}

export async function translateDmToKorean(japaneseText: string) {
  const cleanText = japaneseText.trim();
  if (!cleanText) throw new Error("번역할 일본어 DM이 비어 있습니다.");
  if (cleanText.length > 3000) throw new Error("일본어 DM이 너무 깁니다.");

  const prompt = [
    "다음 일본어 Instagram DM 전체 문장을 자연스러운 한국어 의미로 번역한다.",
    "원문의 의미, 말투, 질문 여부를 그대로 유지하고 내용을 추가하거나 삭제하지 않는다.",
    "설명, 주석, 따옴표, 일본어 원문 재출력 없이 한국어 번역문만 반환한다.",
    "원문의 문단 구분은 가능한 한 유지한다.",
    "일본어 원문:",
    cleanText,
  ].join("\n");

  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    try {
      return await requestTranslation(GROQ_URL, groqKey, GROQ_DM_MODEL, prompt);
    } catch (error) {
      console.warn("dm_translation_groq_failed", safeError(error));
    }
  }

  const scalewayKey = process.env.SCW_SECRET_KEY?.trim();
  if (scalewayKey) {
    try {
      return await requestTranslation(SCALEWAY_URL, scalewayKey, SCALEWAY_DM_MODEL, prompt);
    } catch (error) {
      console.warn("dm_translation_scaleway_failed", safeError(error));
    }
  }

  throw new Error("DM 한국어 번역에 실패했습니다. Groq/Scaleway 설정을 확인하세요.");
}

async function generatePersonalizationLine(
  handle: string,
  basis: PersonalizationBasis,
): Promise<{ line: string; provider: DmProvider; model: string }> {
  if (basis.source === "일반") {
    return { line: SAFE_FALLBACK_LINE, provider: "fallback", model: "fixed-fallback-v1" };
  }

  const styleHint = personalizationStyleHint(handle);
  const prompt = [
    "다음 확인된 공개 프로필/콘텐츠 근거만 사용해 Instagram 첫 DM의 개인화 부분을 자연스러운 일본어 1문장으로 작성한다.",
    "상대에게 직접 말해도 자연스러운 사실만 사용한다. 내부 운영 정보나 평가 정보는 절대 사용하지 않는다.",
    "Reels/리일/재생수/조회수/팔로워/평균/표본 수/순위/검증 상태/조건 충족/중복 확인/후보 상태/내부 판정은 입력에 있더라도 절대 언급하지 않는다.",
    "확인되지 않은 게시물, 직업, 경력, 거주지, 방문 횟수, 취미, 관심사, 성과를 추가하거나 추측하지 않는다.",
    "근거의 의미를 과장하거나 구체화하지 않는다.",
    "가장 자연스러운 사실 1개, 많아도 서로 직접 연결되는 사실 2개만 사용하고 정보를 나열하지 않는다.",
    "8명 모두 같은 『〜に関する発信を拝見し、ご連絡しました。』 문형으로 획일화하지 않는다.",
    "과한 칭찬이나 『〜点に惹かれ』 같은 영업 문체는 쓰지 않는다.",
    `이번 후보의 문형 힌트: ${styleHint}`,
    "문형 힌트는 자연스러울 때만 사용하고, 근거가 뒷받침하지 않는 표현은 절대 만들지 않는다.",
    "문장은 상대가 무엇을 보고 연락했는지 알 수 있게 쓰고, 반드시 『ご連絡しました。』로 끝낸다.",
    "구체적인 근거가 있으므로 generic 문장 『プロフィールを拝見し、ご連絡しました。』로 회피하지 않는다.",
    "설명, 따옴표, 번호, 번역, 줄바꿈 없이 일본어 문장 1개만 반환한다.",
    `근거 종류: ${basis.source}`,
    `확인된 근거: ${basis.text}`,
  ].join("\n");

  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    try {
      const line = await requestLine(GROQ_URL, groqKey, GROQ_DM_MODEL, prompt);
      if (line === SAFE_FALLBACK_LINE) throw new Error("generic_fallback_with_evidence");
      return { line, provider: "groq", model: GROQ_DM_MODEL };
    } catch (error) {
      console.warn("dm_groq_failed", safeError(error));
    }
  }

  const scalewayKey = process.env.SCW_SECRET_KEY?.trim();
  if (scalewayKey) {
    try {
      const line = await requestLine(SCALEWAY_URL, scalewayKey, SCALEWAY_DM_MODEL, prompt);
      if (line === SAFE_FALLBACK_LINE) throw new Error("generic_fallback_with_evidence");
      return { line, provider: "scaleway", model: SCALEWAY_DM_MODEL };
    } catch (error) {
      console.warn("dm_scaleway_failed", safeError(error));
    }
  }

  throw new Error("DM 개인화 생성에 실패했습니다. Groq/Scaleway 설정을 확인하세요.");
}

async function requestLine(url: string, apiKey: string, model: string, prompt: string) {
  const response = await fetchWith429Retry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.25,
      max_tokens: 120,
      messages: [
        { role: "system", content: "You write one concise factual Japanese personalization sentence using only user-facing evidence, with natural sentence-pattern variety." },
        { role: "user", content: prompt },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = compact(await response.text(), 240);
    throw new Error(`${response.status}${detail ? ` ${detail}` : ""}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  return normalizeModelLine(payload.choices?.[0]?.message?.content);
}

async function requestTranslation(url: string, apiKey: string, model: string, prompt: string) {
  const response = await fetchWith429Retry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 700,
      messages: [
        { role: "system", content: "Translate the supplied Japanese DM into faithful, natural Korean. Return only the Korean translation." },
        { role: "user", content: prompt },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = compact(await response.text(), 240);
    throw new Error(`${response.status}${detail ? ` ${detail}` : ""}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  return normalizeKoreanTranslation(payload.choices?.[0]?.message?.content);
}

async function fetchWith429Retry(url: string, init: RequestInit) {
  for (let retry = 0; retry <= MAX_RATE_LIMIT_RETRIES; retry += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status !== 429 || retry === MAX_RATE_LIMIT_RETRIES) {
      return response;
    }

    const delayMs = getRetryDelayMs(response.headers.get("retry-after"), retry);
    await response.text().catch(() => "");
    console.warn("dm_llm_429_retry", `retry=${retry + 1} wait_ms=${delayMs}`);
    await sleep(delayMs);
  }

  throw new Error("rate_limit_retry_exhausted");
}

function getRetryDelayMs(retryAfter: string | null, retry: number) {
  let retryAfterMs: number | null = null;

  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      retryAfterMs = Math.ceil(seconds * 1000);
    } else {
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) {
        retryAfterMs = Math.max(0, retryAt - Date.now());
      }
    }
  }

  const fallbackMs = Math.min(10_000, 2_000 * (2 ** retry));
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(500, retryAfterMs ?? fallbackMs));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalizeModelLine(value: string | null | undefined) {
  if (!value) throw new Error("empty_response");
  const line = value
    .replace(/^```(?:json|text)?/i, "")
    .replace(/```$/i, "")
    .replace(/^[\"'「『]|[\"'」』]$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!line || line.length > 220) throw new Error("invalid_length");
  if (!/[ぁ-んァ-ヶ一-龯]/u.test(line)) throw new Error("not_japanese");
  if (!line.endsWith("ご連絡しました。")) throw new Error("unexpected_ending");
  if (INTERNAL_OUTPUT_PATTERN.test(line)) throw new Error("unsafe_internal_reference");
  return line;
}

function normalizeKoreanTranslation(value: string | null | undefined) {
  if (!value) throw new Error("empty_translation");
  const text = value
    .replace(/^```(?:text)?/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!text || text.length > 3000) throw new Error("invalid_translation_length");
  if (!/[가-힣]/u.test(text)) throw new Error("not_korean");
  return text;
}

function composeDm(category: SearchCategory, personalizationLine: string, offerStyle: OfferStyle) {
  const fixed = category === "beauty"
    ? beautyOfferCopy(offerStyle)
    : foodOfferCopy(offerStyle);

  return ["突然のDM失礼いたします。", personalizationLine, fixed].join("\n");
}

function beautyOfferCopy(style: OfferStyle) {
  if (style === "reward") {
    return "韓国のFixUpでは、韓国でご参加いただける報酬ありの美容PR案件をご案内しています。近いうちに韓国へ来られるご予定はありますか？ご興味があれば詳細をお送りします。";
  }
  if (style === "fee") {
    return "韓国のFixUpでは、韓国に来られるタイミングでご参加いただける、ギャラありの美容PR案件をご案内しています。近いうちに韓国へ来られるご予定はありますか？ご興味があれば詳細をお送りします。";
  }
  if (style === "job") {
    return "韓国のFixUpでは、韓国で実際にご参加いただく美容PRのお仕事をご案内しています。報酬のある案件です。近いうちに韓国へ来られるご予定はありますか？ご興味があれば詳細をお送りします。";
  }
  return "韓国のFixUpでは、韓国にお越しの際にご参加いただける有償の美容PR案件をご案内しています。近いうちに韓国へ来られるご予定はありますか？ご興味があれば詳細をお送りします。";
}

function foodOfferCopy(style: OfferStyle) {
  if (style === "reward") {
    return "韓国のFixUpでは、韓国でご参加いただける報酬ありのグルメPR案件をご案内しています。近いうちに韓国へ来られるご予定はありますか？ご興味があれば詳細をお送りします。";
  }
  if (style === "fee") {
    return "韓国のFixUpでは、韓国に来られるタイミングでご参加いただける、ギャラありのグルメPR案件をご案内しています。近いうちに韓国へ来られるご予定はありますか？ご興味があれば詳細をお送りします。";
  }
  if (style === "job") {
    return "韓国のFixUpでは、韓国で実際にご参加いただくグルメPRのお仕事をご案内しています。報酬のある案件です。近いうちに韓国へ来られるご予定はありますか？ご興味があれば詳細をお送りします。";
  }
  return "韓国のFixUpでは、韓国にお越しの際にご参加いただける有償のグルメPR案件をご案内しています。近いうちに韓国へ来られるご予定はありますか？ご興味があれば詳細をお送りします。";
}

function selectOfferStyle(handle: string, basis: PersonalizationBasis): OfferStyle {
  const casual = CASUAL_TONE_PATTERN.test(basis.text);
  const bucket = stableBucket(handle, casual ? 4 : 3);

  if (casual && bucket === 2) return "fee";
  if (bucket === 1) return "reward";
  if (bucket === 2) return "job";
  return "paid";
}

function personalizationStyleHint(handle: string) {
  const variants = [
    "『〜を発信されているのを拝見し、ご連絡しました。』系。自然ならこの流れを使う。",
    "『〜についての投稿を拝見し、ご連絡しました。』系。投稿と断定できる根拠がある場合だけ使う。",
    "『〜されていると拝見し、ぜひご案内したいと思いご連絡しました。』系。活動事実が明確な場合だけ使う。",
    "『〜を拝見し、今回ご案内したいと思いご連絡しました。』系。短く自然にまとめる。",
  ];
  return variants[stableBucket(handle, variants.length)];
}

function stableBucket(value: string, size: number) {
  let hash = 0;
  for (const char of value) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash % size;
}

function sanitizePersonalizationEvidence(value: string) {
  const chunks = compact(value, 1200)
    .split(/\s+·\s+|\s*[|｜]\s*|,\s*/)
    .map((chunk) => chunk
      .replace(/^\d+순위\s*/i, "")
      .replace(/^최종\s*검증\s*완료\s*/i, "")
      .replace(/^일본\s*타깃\s*/i, "")
      .trim())
    .filter(Boolean)
    .filter((chunk) => !INTERNAL_EVIDENCE_PATTERN.test(chunk))
    .filter((chunk) => !/^\d[\d.,Kk만천\s]*$/.test(chunk));

  return compact([...new Set(chunks)].join(" · "), 600);
}

function compact(value: string, maxLength: number) {
  return value.replace(/[\t\r\n ]+/g, " ").trim().slice(0, maxLength);
}

function getTimeoutMs() {
  const parsed = Number(process.env.DM_LLM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 2_000 && parsed <= 30_000 ? parsed : DEFAULT_TIMEOUT_MS;
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.name === "AbortError" ? "timeout" : compact(error.message, 240);
  return "unknown_error";
}
