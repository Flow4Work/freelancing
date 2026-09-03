import type { DiscoveryCandidate, DmProvider, SearchCategory } from "@/lib/discovery/types";

export const GROQ_DM_MODEL = "qwen/qwen3.8-27b";
export const SCALEWAY_DM_MODEL = "qwen3.6-35b-a3b";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const SCALEWAY_URL = "https://api.scaleway.ai/v1/chat/completions";
const SAFE_FALLBACK_LINE = "プロフィールを拝見し、ご連絡しました。";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 3;

const INTERNAL_EVIDENCE_PATTERN = /(?:reels?|リール|再生(?:回数|数)?|조회수|팔로워|followers?|following|平均|평균|\b8\s*\/\s*8\b|\b\d+건\b|순위|順位|verified|qualified|검증|検証|모집조건|条件\s*(?:충족|通過)?|중복|重複|후보|候補|판정|判定|공개.?개인|개인\s*계정|최근\s*게시일|null|log\s*in|sign\s*up|photo\s*by|video\s*by|show\s*more|highlight\s*story|read\s*more)/i;
const INTERNAL_OUTPUT_PATTERN = /(?:reels?|リール|再生(?:回数|数)?|조회수|팔로워|フォロワ|followers?|平均|평균|8\s*\/\s*8|8件|順位|verified|qualified|検証|검증|条件|모집조건|重複|중복|候補|후보|判定|판정)/i;
const FORBIDDEN_PERSONALIZATION_PATTERN = /(?:経歴|姿を拝見|日韓夫婦美容室|惹かれ|関心が近いと感じ|関心が近い|魅力を感じ|興味を持ち|点に注目|資格を活かした発信|薬局での肌管理|発信されているの拝見|年間にわたる韓国好きの発信)/i;

type PersonalizationBasis = {
  source: string;
  text: string;
};

type LineValidationCode =
  | "empty_response"
  | "code_block"
  | "line_break"
  | "invalid_length"
  | "not_japanese"
  | "multiple_sentences"
  | "explanatory_output"
  | "unsafe_internal_reference"
  | "unsafe_personalization_expression"
  | "generic_fallback_with_evidence";

type PersonalizationFailureKind =
  | "key_missing"
  | "auth"
  | "rate_limit_429"
  | "timeout"
  | "provider_http"
  | "provider_error"
  | "validation";

type LlmProvider = "groq" | "scaleway";
type LlmStage = "personalization" | "personalization_repair" | "translation";
type LlmRequestContext = {
  provider: LlmProvider;
  stage: LlmStage;
  handle: string | null;
};
type PersonalizationFailure = {
  provider: LlmProvider;
  kind: PersonalizationFailureKind;
};

class DmLineValidationError extends Error {
  readonly code: LineValidationCode;
  readonly rejectedLine: string;
  readonly blockedExpression: string | null;

  constructor(code: LineValidationCode, rejectedLine: string, blockedExpression: string | null = null) {
    super(code);
    this.name = "DmLineValidationError";
    this.code = code;
    this.rejectedLine = rejectedLine;
    this.blockedExpression = blockedExpression;
  }
}

class DmProviderHttpError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`${status}${detail ? ` ${detail}` : ""}`);
    this.name = "DmProviderHttpError";
    this.status = status;
  }
}

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
  let generated: { line: string; provider: DmProvider; model: string };
  try {
    generated = await generatePersonalizationLine(candidate.handle, basis);
  } catch (error) {
    console.error("dm_candidate_prepare_failed", `handle=@${candidate.handle} stage=personalization error=${safeError(error)}`);
    throw new Error(`@${candidate.handle} · 개인화 · ${safeError(error)}`);
  }

  const dmText = composeDm(candidate.category, generated.line, candidate.handle, hasExplicitKoreaPresence(candidate));
  let koreanText: string;
  try {
    koreanText = await translateDmToKorean(dmText, candidate.handle);
  } catch (error) {
    console.error("dm_candidate_prepare_failed", `handle=@${candidate.handle} stage=translation error=${safeError(error)}`);
    throw new Error(`@${candidate.handle} · 한국어 번역 · ${safeError(error)}`);
  }

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
    candidate.bio ? { source: "BIO", text: candidate.bio, base: 100 } : null,
    candidate.evidenceText ? { source: "기존 확인 근거", text: candidate.evidenceText, base: 76 } : null,
    candidate.verificationNote ? { source: "최종 검증 메모", text: candidate.verificationNote, base: 66 } : null,
    candidate.targetSignals.length || candidate.koreaSignals.length
      ? { source: "구조화 신호", text: [...candidate.targetSignals, ...candidate.koreaSignals].join(" · "), base: 52 }
      : null,
  ].filter((item): item is { source: string; text: string; base: number } => Boolean(item));

  const options = rawOptions
    .map((item) => ({ ...item, text: sanitizePersonalizationEvidence(item.text) }))
    .filter((item) => Boolean(item.text));

  if (!options.length) {
    return { source: "일반", text: "확인된 개인화 근거 없음" };
  }

  const koreaTerms = ["韓国", "渡韓", "在韓", "日韓", "ソウル", "釜山", "korea", "seoul", "busan", "한국", "방한", "재한", "한일", "서울", "부산"];
  const roleTerms = ["CEO", "美容師", "皮膚科", "皮膚管理士", "研究家", "オーナー", "コンシェルジュ", "代表", "勤務", "운영", "근무", "연구가"];

  const scored = options.map((item) => {
    const normalized = item.text.toLowerCase();
    const koreaHits = Math.min(2, koreaTerms.filter((term) => normalized.includes(term.toLowerCase())).length);
    const roleHits = Math.min(2, roleTerms.filter((term) => normalized.includes(term.toLowerCase())).length);
    const detailBonus = Math.min(5, Math.floor(item.text.length / 120));
    const tinyGenericPenalty = item.text.length < 12 ? 18 : 0;
    return { ...item, score: item.base + koreaHits * 3 + roleHits * 3 + detailBonus - tinyGenericPenalty };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return { source: best.source, text: compact(best.text, 700) };
}

export async function translateDmToKorean(japaneseText: string, handle: string | null = null) {
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
      return await requestTranslation(GROQ_URL, groqKey, GROQ_DM_MODEL, prompt, {
        provider: "groq",
        stage: "translation",
        handle,
      });
    } catch (error) {
      console.warn("dm_translation_groq_failed", `${contextLabel({ provider: "groq", stage: "translation", handle })} error=${safeError(error)}`);
    }
  }

  const scalewayKey = process.env.SCW_SECRET_KEY?.trim();
  if (scalewayKey) {
    try {
      return await requestTranslation(SCALEWAY_URL, scalewayKey, SCALEWAY_DM_MODEL, prompt, {
        provider: "scaleway",
        stage: "translation",
        handle,
      });
    } catch (error) {
      console.warn("dm_translation_scaleway_failed", `${contextLabel({ provider: "scaleway", stage: "translation", handle })} error=${safeError(error)}`);
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
    "우선순위는 반드시 사실 정확성 > 자연스러움 > 문형 다양성 순서다. 다양성을 위해 원본 의미를 바꾸지 않는다.",
    "개인화와 뒤에 이어질 PR 제안 장르는 완전히 분리한다. 미용 PR을 제안한다고 해서 개인화 문장을 미용 내용으로 맞추거나 바꾸지 않는다.",
    "BIO에서 ｜ / ・ / 쉼표 / 슬래시 / 공백 등으로 병렬 나열된 사실 A/B/C는 원문 문법상 직접 연결되어 있지 않으면 반드시 서로 독립된 사실로 취급한다.",
    "개인화에는 기본적으로 확인된 사실 1개만 사용한다. 여러 사실을 자연스럽게 이어 붙이는 것보다 나머지 사실을 버리는 쪽을 우선한다.",
    "2개 사실을 함께 써도 되는 경우는 원문 자체가 두 사실의 관계를 문법적으로 명시한 경우뿐이다. 단순 나열을 이유·관점·역할·수단·원인 관계로 바꾸지 않는다.",
    "원문에 그 관계가 직접 없으면 『〜として〜を発信』『〜の視点から』『〜を活かして』『〜だから』『〜を通じて』『〜を中心に』처럼 두 사실을 연결하는 표현을 만들지 않는다.",
    "예: 『薬局』『肌管理』가 따로 나열됐다고 『薬局での肌管理』로 만들지 않는다. 『資格所持』『発信』이 따로 있다고 『資格を活かした発信』으로 만들지 않는다.",
    "예: 『韓国好き15年』『韓国コスメ研究家』가 따로 있으면 『15年の視点から発信』처럼 합치지 말고 둘 중 하나만 사용한다.",
    "예: 『コスメ』『植物』『編み物』가 나열되어 있으면 이를 하나의 라이프스타일 철학이나 선택 기준으로 묶지 말고 가장 적합한 사실 하나만 사용한다.",
    "예: 『コンシェルジュ』『コーデ』『肌管理』가 따로 있으면 『コンシェルジュとしてコーデや肌管理を発信』처럼 역할과 활동을 새로 연결하지 않는다.",
    "기간 표현은 원본에서 실제로 수식하는 대상을 그대로 보존한다. 예: 『韓国好き15年』은 한국을 좋아한 기간이지, 15년간 발신했다는 뜻이 아니다.",
    "원본 근거의 의미나 분야를 다른 분야로 변환하지 않는다. 예: コーデ를肌管理로 바꾸거나, 일반적인韓国発信を美容発信으로 바꾸지 않는다.",
    "근거에 없는 관심, 호감, 공감, 전문성, 평가, 인과관계를 추가하지 않는다. 『関心が近いと感じて』『惹かれ』『魅力を感じて』『資格を活かして』 같은 표현을 만들지 않는다.",
    "Reels/리일/재생수/조회수/팔로워/평균/표본 수/순위/검증 상태/조건 충족/중복 확인/후보 상태/내부 판정은 입력에 있더라도 절대 언급하지 않는다.",
    "사실이 여러 개면 가장 자연스럽고 구체적인 사실 1개만 고른다. 화려한 개인화보다 원본 사실을 덜 쓰는 것이 항상 낫다.",
    "월별 한국 방문, 장기간의 한국 관련 활동, 실제 직업/역할/근무, 구체적인 BIO 사실은 generic한 단어 하나보다 우선한다.",
    "BIO 문구를 그대로 이어 붙이지 말고 사실의 의미와 수식 관계는 그대로 보존한 채 일본인이 실제 첫 DM에서 쓸 자연스러운 표현으로 다시 쓴다.",
    "『経歴』『経歴を拝見し』『姿を拝見し』『〜点に注目して』『日韓夫婦美容室』처럼 분석 보고서/채용 문구 또는 한국어식 명사 결합은 쓰지 않는다.",
    "과한 칭찬은 하지 않는다.",
    "최종 출력 직전에 스스로 한 번 점검한다: 원본에 없는 관계나 인과가 생기지 않았는지, 기간의 수식 대상이 바뀌지 않았는지, 일본어 조사와 문법이 자연스러운지 확인한다.",
    "특히 『発信されているのを拝見し』처럼 필요한 조사를 정확히 쓰고 『発信されているの拝見し』 같은 조사 누락은 절대 출력하지 않는다.",
    `이번 후보의 기존 문형 힌트: ${styleHint}`,
    "문형 힌트는 기존 분산을 유지하기 위한 참고일 뿐이다. 사실 정확성이나 자연스러움과 충돌하면 반드시 사실 정확성을 우선한다.",
    "설명, 따옴표, 번호, 번역, 줄바꿈 없이 일본어 한 문장만 반환한다.",
    `근거 종류: ${basis.source}`,
    `확인된 원본 근거: ${basis.text}`,
  ].join("\n");

  const failures: PersonalizationFailure[] = [];
  const groqKey = process.env.GROQ_API_KEY?.trim();

  if (groqKey) {
    try {
      const line = ensureSpecificPersonalization(await requestLine(GROQ_URL, groqKey, GROQ_DM_MODEL, prompt, {
        provider: "groq",
        stage: "personalization",
        handle,
      }));
      return { line, provider: "groq", model: GROQ_DM_MODEL };
    } catch (error) {
      if (error instanceof DmLineValidationError) {
        logValidationFailure("groq", "initial", error, handle);
        try {
          const repairedLine = ensureSpecificPersonalization(await requestLine(
            GROQ_URL,
            groqKey,
            GROQ_DM_MODEL,
            buildCorrectionPrompt(prompt, error),
            { provider: "groq", stage: "personalization_repair", handle },
          ));
          console.info("dm_groq_validation_repaired", `handle=@${handle} initial_code=${error.code}`);
          return { line: repairedLine, provider: "groq", model: GROQ_DM_MODEL };
        } catch (repairError) {
          if (repairError instanceof DmLineValidationError) {
            logValidationFailure("groq", "repair", repairError, handle);
            failures.push({ provider: "groq", kind: "validation" });
          } else {
            const kind = classifyProviderFailure(repairError);
            console.warn("dm_groq_repair_provider_failed", `handle=@${handle} stage=personalization_repair kind=${kind} error=${safeError(repairError)}`);
            failures.push({ provider: "groq", kind });
          }
        }
      } else {
        const kind = classifyProviderFailure(error);
        console.warn("dm_groq_provider_failed", `handle=@${handle} stage=personalization kind=${kind} error=${safeError(error)}`);
        failures.push({ provider: "groq", kind });
      }
    }
  } else {
    console.warn("dm_groq_key_missing", `handle=@${handle} stage=personalization`);
    failures.push({ provider: "groq", kind: "key_missing" });
  }

  const scalewayKey = process.env.SCW_SECRET_KEY?.trim();
  if (scalewayKey) {
    try {
      const line = ensureSpecificPersonalization(await requestLine(SCALEWAY_URL, scalewayKey, SCALEWAY_DM_MODEL, prompt, {
        provider: "scaleway",
        stage: "personalization",
        handle,
      }));
      return { line, provider: "scaleway", model: SCALEWAY_DM_MODEL };
    } catch (error) {
      if (error instanceof DmLineValidationError) {
        logValidationFailure("scaleway", "initial", error, handle);
        failures.push({ provider: "scaleway", kind: "validation" });
      } else {
        const kind = classifyProviderFailure(error);
        console.warn("dm_scaleway_provider_failed", `handle=@${handle} stage=personalization kind=${kind} error=${safeError(error)}`);
        failures.push({ provider: "scaleway", kind });
      }
    }
  } else {
    console.warn("dm_scaleway_key_missing", `handle=@${handle} stage=personalization`);
    failures.push({ provider: "scaleway", kind: "key_missing" });
  }

  throw new Error(personalizationFailureMessage(failures));
}

async function requestLine(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  context: LlmRequestContext,
) {
  const response = await fetchWith429Retry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 120,
      messages: [
        { role: "system", content: "Write one concise natural Japanese Instagram personalization sentence using only the supplied evidence. Preserve factual scope, modifiers, duration, and relationships exactly. Before answering, silently check Japanese particles and grammar." },
        { role: "user", content: prompt },
      ],
    }),
    cache: "no-store",
  }, context);

  if (!response.ok) {
    const detail = compact(await response.text(), 240);
    throw new DmProviderHttpError(response.status, detail);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  return normalizeModelLine(payload.choices?.[0]?.message?.content);
}

async function requestTranslation(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  context: LlmRequestContext,
) {
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
  }, context);

  if (!response.ok) {
    const detail = compact(await response.text(), 240);
    throw new DmProviderHttpError(response.status, detail);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  return normalizeKoreanTranslation(payload.choices?.[0]?.message?.content);
}

async function fetchWith429Retry(url: string, init: RequestInit, context: LlmRequestContext) {
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

    const retryAfter = response.headers.get("retry-after");
    if (response.status !== 429 || retry === MAX_RATE_LIMIT_RETRIES) {
      if (response.status === 429) {
        console.warn(
          "dm_llm_429_exhausted",
          `${contextLabel(context)} status=429 retry_after=${formatHeaderValue(retryAfter)} retry_count=${retry} total_attempts=${retry + 1}`,
        );
      }
      return response;
    }

    const delayMs = getRetryDelayMs(retryAfter, retry);
    await response.text().catch(() => "");
    console.warn(
      "dm_llm_429_retry",
      `${contextLabel(context)} status=429 retry_after=${formatHeaderValue(retryAfter)} retry=${retry + 1}/${MAX_RATE_LIMIT_RETRIES} wait_ms=${delayMs}`,
    );
    await sleep(delayMs);
  }

  throw new Error("rate_limit_retry_exhausted");
}

function getRetryDelayMs(retryAfter: string | null, retry: number) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.ceil(seconds * 1000);
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(0, retryAt - Date.now());
    }
  }

  return Math.min(10_000, 2_000 * (2 ** retry));
}

function contextLabel(context: LlmRequestContext) {
  return `provider=${context.provider} stage=${context.stage}${context.handle ? ` handle=@${context.handle}` : ""}`;
}

function formatHeaderValue(value: string | null) {
  return value === null ? "none" : JSON.stringify(value);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalizeModelLine(value: string | null | undefined) {
  if (!value) throw new DmLineValidationError("empty_response", "");

  const raw = value.trim();
  if (raw.includes("```")) {
    throw new DmLineValidationError("code_block", compact(raw, 220), "```");
  }
  if (/[\r\n]/.test(raw)) {
    throw new DmLineValidationError("line_break", compact(raw, 220));
  }

  const line = fixKnownJapaneseParticleOmission(
    raw
      .replace(/^[\"'「『]|[\"'」』]$/g, "")
      .replace(/[\t ]+/g, " ")
      .trim(),
  );

  if (!line || line.length > 220) {
    throw new DmLineValidationError("invalid_length", compact(line, 220));
  }
  if (!/[ぁ-んァ-ヶ一-龯]/u.test(line)) {
    throw new DmLineValidationError("not_japanese", line);
  }

  const sentenceGroups = line.match(/[。！？!?]+/g) ?? [];
  if (sentenceGroups.length > 1) {
    throw new DmLineValidationError("multiple_sentences", line);
  }
  if (/^(?:[-*•]|\d+[.)]|説明[:：]|修正版[:：]|個人化[:：]|以下[:：]?)/.test(line)) {
    throw new DmLineValidationError("explanatory_output", line);
  }

  const internal = line.match(INTERNAL_OUTPUT_PATTERN)?.[0] ?? null;
  if (internal) {
    throw new DmLineValidationError("unsafe_internal_reference", line, internal);
  }

  const unsupported = line.match(FORBIDDEN_PERSONALIZATION_PATTERN)?.[0] ?? null;
  if (unsupported) {
    throw new DmLineValidationError("unsafe_personalization_expression", line, unsupported);
  }

  return line;
}

function fixKnownJapaneseParticleOmission(value: string) {
  return value.replace(/発信されているの拝見/g, "発信されているのを拝見");
}

function ensureSpecificPersonalization(line: string) {
  if (line === SAFE_FALLBACK_LINE) {
    throw new DmLineValidationError("generic_fallback_with_evidence", line, SAFE_FALLBACK_LINE);
  }
  return line;
}

function buildCorrectionPrompt(originalPrompt: string, error: DmLineValidationError) {
  const blocked = error.blockedExpression
    ? `사용하지 말아야 할 표현: ${error.blockedExpression}`
    : `피해야 할 검증 사유: ${error.code}`;

  return [
    originalPrompt,
    "",
    "이전 생성문이 품질 검증에 걸려 사용할 수 없다.",
    `이전 생성문: ${error.rejectedLine}`,
    `검증 사유: ${error.code}`,
    blocked,
    "위 표현 또는 문제를 사용하지 말고, 같은 확인 근거 범위 안에서 자연스러운 일본어 한 문장으로 다시 작성한다.",
    "서로 독립된 BIO 항목을 새 관계로 결합하지 않는다. 기본은 확인된 사실 1개만 사용하는 것이다.",
    "단순 나열된 사실을 『〜として〜を発信』『〜の視点から』『〜を活かして』『〜だから』『〜を通じて』 같은 새 역할·관점·인과관계로 연결하지 않는다.",
    "기간 표현이 무엇을 수식하는지 원본 그대로 유지한다. 예: 韓国好き15年을 15年間の発信이나 15年の視点からの発信으로 바꾸지 않는다.",
    "원본 근거의 분야를 바꾸거나 새로운 관심/호감/전문성을 만들지 않는다.",
    "최종 출력 전에 조사와 일본어 문법을 다시 확인한다.",
    "새 사실을 추가하지 말고, 내부 조회수/팔로워/Reels/검증/후보 정보는 절대 넣지 않는다.",
    "설명 없이 교정된 일본어 한 문장만 반환한다.",
  ].join("\n");
}

function logValidationFailure(
  provider: LlmProvider,
  stage: "initial" | "repair",
  error: DmLineValidationError,
  handle: string,
) {
  const blocked = error.blockedExpression ? ` blocked=${compact(error.blockedExpression, 80)}` : "";
  console.warn(
    `dm_${provider}_validation_failed`,
    `handle=@${handle} stage=${stage} code=${error.code}${blocked} output=${compact(error.rejectedLine, 220)}`,
  );
}

function classifyProviderFailure(error: unknown): PersonalizationFailureKind {
  if (error instanceof DmProviderHttpError) {
    if (error.status === 429) return "rate_limit_429";
    if (error.status === 401 || error.status === 403) return "auth";
    return "provider_http";
  }
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "provider_error";
}

function personalizationFailureMessage(failures: PersonalizationFailure[]) {
  const kinds = failures.map((failure) => failure.kind);
  const detail = failures.length
    ? ` · ${failures.map((failure) => `${providerDisplayName(failure.provider)} ${failure.kind}`).join(" / ")}`
    : "";

  if (kinds.length > 0 && kinds.every((failure) => failure === "key_missing")) {
    return `DM 개인화 생성 실패: LLM API 키가 설정되지 않았습니다.${detail}`;
  }
  if (kinds.includes("auth")) {
    return `DM 개인화 생성 실패: LLM provider 인증에 실패했습니다.${detail}`;
  }
  if (kinds.includes("rate_limit_429")) {
    return `DM 개인화 생성 실패: LLM provider rate limit(429)이 재시도 후에도 해소되지 않았습니다.${detail}`;
  }
  if (kinds.includes("validation")) {
    return `DM 개인화 생성 실패: 생성 문장이 품질 검증을 통과하지 못했습니다.${detail}`;
  }
  if (kinds.includes("timeout")) {
    return `DM 개인화 생성 실패: LLM provider 요청이 timeout 됐습니다.${detail}`;
  }
  return `DM 개인화 생성 실패: LLM provider 요청에 실패했습니다.${detail}`;
}

function providerDisplayName(provider: LlmProvider) {
  return provider === "groq" ? "Groq" : "Scaleway";
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

function composeDm(category: SearchCategory, personalizationLine: string, handle: string, hasKoreaPresence: boolean) {
  if (category !== "beauty") {
    return [
      "突然のDM失礼いたします。",
      personalizationLine,
      "韓国のFixUpでは、グルメに関するクリエイター向けPR企画をご案内しています。韓国のお店を紹介するPR企画にもご興味はありますか？",
    ].join("\n");
  }

  const opener = beautyOpeningCopy(handle);
  const offer = beautyOfferCopy(handle, hasKoreaPresence);
  const question = beautyQuestionCopy(handle, hasKoreaPresence);
  return [opener, personalizationLine, `${offer}${question}`].join("\n");
}

function beautyOpeningCopy(handle: string) {
  const variants = [
    "突然のご連絡失礼いたします。",
    "はじめまして。突然のDM失礼いたします。",
    "はじめまして。急なご連絡失礼いたします。",
  ];
  return variants[stableBucket(`opening:${handle}`, variants.length)];
}

function beautyOfferCopy(handle: string, hasKoreaPresence: boolean) {
  if (hasKoreaPresence) {
    const localVariants = [
      "韓国のFixUpでは、韓国でご参加いただける有償の美容PR案件をご案内しています。",
      "韓国のFixUpでは、韓国での美容PRのお仕事で、報酬ありの案件をご案内しています。",
    ];
    return localVariants[stableBucket(`offer-local:${handle}`, localVariants.length)];
  }

  const variants = [
    "韓国のFixUpでは、韓国でご参加いただける有償の美容PR案件をご案内しています。",
    "韓国のFixUpでは、韓国での美容PRのお仕事で、報酬ありの案件をご案内しています。",
    "韓国のFixUpで、韓国にお越しの際にご参加いただける有償PR案件をご案内しています。",
  ];
  return variants[stableBucket(`offer:${handle}`, variants.length)];
}

function beautyQuestionCopy(handle: string, hasKoreaPresence: boolean) {
  if (hasKoreaPresence) {
    const localVariants = [
      "ご興味がありましたら、詳しい内容をご案内します。",
      "もしご興味があれば、詳細をお送りします。",
    ];
    return localVariants[stableBucket(`question-local:${handle}`, localVariants.length)];
  }

  const variants = [
    "今後、韓国に来られるご予定はありますか？ご興味があれば詳細をお送りします。",
    "韓国へお越しになるご予定はありますか？ご興味がありましたら、詳しい内容をお送りします。",
    "近いうちに韓国へ来られるご予定はありますか？もしご興味があれば、詳細をご案内します。",
  ];
  return variants[stableBucket(`question:${handle}`, variants.length)];
}

function hasExplicitKoreaPresence(candidate: DiscoveryCandidate) {
  const evidence = compact([candidate.bio, candidate.evidenceText].filter(Boolean).join(" · "), 2400);
  if (!evidence) return false;

  const explicitPatterns = [
    /在韓\s*\d*\s*年目?/i,
    /韓国[^。·]{0,24}(?:在住|居住|生活中|勤務|勤め|働いて|運営|経営)/i,
    /ソウルで[^。·]{0,40}(?:在住|生活|暮ら|勤務|勤め|働|運営|経営|美容室|美容師)/i,
    /서울에서[^。·]{0,40}(?:거주|생활|근무|운영|경영)/i,
    /한국에서[^。·]{0,40}(?:거주|생활|근무|운영|경영)/i,
  ];
  return explicitPatterns.some((pattern) => pattern.test(evidence));
}

function personalizationStyleHint(handle: string) {
  const variants = [
    "『〜を発信されているのを拝見して、今回お声がけしました。』系。",
    "『〜を長く紹介されているのを拝見し、ぜひご案内できればと思いました。』系。",
    "『〜についての投稿を拝見して、今回メッセージしました。』系。投稿と断定できる根拠がある場合だけ使う。",
    "『プロフィールで〜と拝見し、今回ご連絡しました。』系。プロフィールに明記された事実にだけ使う。",
    "『〜を中心に発信されているのを拝見して、今回ご案内したいと思いました。』系。",
  ];
  return variants[stableBucket(`personal:${handle}`, variants.length)];
}

function stableBucket(value: string, size: number) {
  let hash = 0;
  for (const char of value) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash % size;
}

function sanitizePersonalizationEvidence(value: string) {
  const chunks = compact(value, 1400)
    .split(/\s+·\s+|\s*[|｜]\s*|,\s*|、\s*|\s*・\s*|\s*\/\s*/)
    .map((chunk) => chunk
      .replace(/^\d+순위\s*/i, "")
      .replace(/^최종\s*검증\s*완료\s*/i, "")
      .replace(/^일본\s*타깃\s*/i, "")
      .trim())
    .filter(Boolean)
    .filter((chunk) => !INTERNAL_EVIDENCE_PATTERN.test(chunk))
    .filter((chunk) => !/^\d[\d.,Kk만천\s]*$/.test(chunk));

  return compact([...new Set(chunks)].join(" · "), 700);
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
