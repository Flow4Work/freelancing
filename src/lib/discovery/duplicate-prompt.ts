import { FIXUP_DUPLICATE_CHECK_URL } from "@/lib/automation/config";
import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildDuplicateCheckPrompt(candidates: DiscoveryCandidate[], category: SearchCategory, jobId: string) {
  const ids = candidates.map((candidate) => `@${candidate.handle}`).join("\n");

  return `playwright_b의 현재 로그인된 Chrome 세션만 사용한다.

목적: 아래 후보만 FixUp 중복 페이지에서 확인하고 결과를 FixUp Scout에 자동 반영한다.
중복 페이지: ${FIXUP_DUPLICATE_CHECK_URL}

규칙:
- 후보별 ID 입력 → "중복 확인 / 重複確認" 클릭 → 화면의 실제 결과 문구만 판정
- 등록 가능 → available
- 이미 등록 → duplicate
- 관리자 보호 목록 → protected
- 그 외/확인 불가 → unknown
- "등록하기 / 登録する" 클릭 금지
- 새 로그인, Instagram 탐색, 후보 외 계정 탐색 금지

후보:
${ids}

모든 후보를 포함해 아래 형식의 JSON만 만든다.
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"id","duplicateStatus":"available","duplicateMessage":"실제 핵심 문구 또는 null"}]}

완료 후 JSON을 UTF-8 임시파일로 저장하고 curl.exe --data-binary로 POST http://localhost:3000/api/duplicate/results 한다. 응답의 \"ok\":true를 확인해야 완료다.`;
}
