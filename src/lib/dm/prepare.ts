import type { DiscoveryCandidate, DmProvider } from "@/lib/discovery/types";

const INTERNAL_EVIDENCE_PATTERN = /(?:reels?|reel|조회|재생|followers?|following|평균|median|verified|qualified|검증|중복|후보|순위|sample|login|sign up)/i;
const KOREA_RESIDENT_PATTERN = /(?:한국|韓国|서울|ソウル|seoul)[^\n·|]{0,32}(?:거주|생활|재한|在住|居住|暮ら|living)/i;
const KOREA_VISIT_PATTERN = /(?:방한|渡韓|訪韓|韓国旅行|한국 여행|한국 방문|韓国へ|韓国に行)/i;
const KOREA_REPEAT_PATTERN = /(?:매월|매달|毎月|자주|頻繁|정기|定期|반복|行き来|往復)[^\n·|]{0,40}(?:한국|韓国|서울|ソウル)/i;

export type PreparedDm = {
  handle: string;
  personalizationSource: string;
  personalizationBasis: string;
  personalizationLine: string;
  dmText: string;
  provider: DmProvider;
  model: string;
  generatedAt: string;
};

type EvidenceItem = { source: string; text: string };

export async function prepareCandidateDm(candidate: DiscoveryCandidate): Promise<PreparedDm> {
  return prepareCandidateDmSync(candidate);
}

export function prepareCandidateDmSync(candidate: DiscoveryCandidate): PreparedDm {
  const evidence = collectUsefulEvidence(candidate);
  const koreaContact = describeKoreaContact(candidate);
  const feature = pickFeature(candidate, evidence);
  const facts = evidence.slice(0, 2);
  const personalizationBasis = facts.map((item) => item.text).join(" · ");
  const lines = [
    `@${candidate.handle}`,
    ...facts.map((item, index) => `- 개인화 근거${facts.length > 1 ? ` ${index + 1}` : ""}: ${item.text}`),
    `- 한국 접점: ${koreaContact}`,
    `- 분야: ${candidate.category === "beauty" ? "Beauty" : "Food"}`,
    ...(feature ? [`- 특징: ${feature}`] : []),
  ];

  return {
    handle: candidate.handle,
    personalizationSource: facts.map((item) => item.source).join("+") || "none",
    personalizationBasis,
    personalizationLine: facts[0]?.text ?? "",
    dmText: lines.join("\n"),
    provider: "deterministic",
    model: "deterministic-dm-context-v1",
    generatedAt: new Date().toISOString(),
  };
}

function collectUsefulEvidence(candidate: DiscoveryCandidate): EvidenceItem[] {
  const raw: EvidenceItem[] = [
    ...(candidate.bio ? [{ source: "BIO", text: candidate.bio }] : []),
    ...(candidate.verificationNote ? [{ source: "verification", text: candidate.verificationNote }] : []),
    ...(candidate.evidenceText ? [{ source: "evidence", text: candidate.evidenceText }] : []),
  ];
  const seen = new Set<string>();
  const output: EvidenceItem[] = [];
  for (const item of raw) {
    for (const chunk of splitEvidence(item.text)) {
      const text = sanitizeEvidenceChunk(chunk);
      if (!text || text.length < 4 || INTERNAL_EVIDENCE_PATTERN.test(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ source: item.source, text });
      if (output.length >= 4) return output;
    }
  }
  return output;
}

function splitEvidence(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split(/\n+|\s+[·|｜]\s+|\s{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeEvidenceChunk(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/@[A-Za-z0-9._]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function describeKoreaContact(candidate: DiscoveryCandidate) {
  const text = [candidate.bio, candidate.verificationNote, candidate.evidenceText, ...candidate.koreaSignals]
    .filter(Boolean)
    .join(" · ");
  if (KOREA_REPEAT_PATTERN.test(text)) return "반복 방한/한국 왕래 확인";
  if (KOREA_RESIDENT_PATTERN.test(text) || candidate.koreaSignals.some((signal) => /한국 거주|在住|거주/.test(signal))) {
    return "한국 거주 확인";
  }
  if (KOREA_VISIT_PATTERN.test(text) || candidate.koreaSignals.some((signal) => /방한|한국 여행|한국 방문/.test(signal))) {
    return "방한/한국 방문 확인";
  }
  if (candidate.koreaAffinity === "strong") return "한국 관련 발신/접점 확인";
  if (candidate.koreaAffinity === "yes") return "한국 관련 발신/접점 확인";
  return "확인된 한국 접점 없음";
}

function pickFeature(candidate: DiscoveryCandidate, evidence: EvidenceItem[]) {
  const signal = [...candidate.targetSignals, ...candidate.koreaSignals]
    .map((item) => sanitizeEvidenceChunk(item))
    .find((item) => item && !INTERNAL_EVIDENCE_PATTERN.test(item));
  if (signal) return signal.slice(0, 120);
  const extra = evidence[2]?.text;
  return extra ? extra.slice(0, 120) : "";
}
