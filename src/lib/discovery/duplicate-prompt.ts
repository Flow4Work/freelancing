import { FIXUP_DUPLICATE_CHECK_URL } from "@/lib/automation/config";
import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildDuplicateCheckPrompt(candidates: DiscoveryCandidate[], category: SearchCategory, jobId: string) {
  const ids = candidates.map((candidate) => `@${candidate.handle}`).join("\n");

  return `playwright_b의 현재 로그인된 Chrome 세션만 사용한다.

목적: 아래 후보만 FixUp 중복 페이지에서 확인하고 결과를 FixUp Scout에 자동 반영한다.
중복 페이지: ${FIXUP_DUPLICATE_CHECK_URL}

중요:
- 먼저 실제 "중복 확인 / 重複確認" 입력폼까지 접근 가능한지 확인한다.
- 로그인/인증 화면이 나오면 현재 Chrome 세션에 저장된 인증 상태로 바로 진행 가능한 경우에만 진행한다.
- 로그인 정보가 없거나 입력폼까지 접근할 수 없으면 후보를 unknown 처리하거나 결과 API를 호출하지 않는다. 그 상태에서 작업을 종료하고 로그인 필요 사실만 화면에 남긴다.
- 인증 실패/페이지 접근 실패를 후보의 중복 결과로 저장하는 것은 금지한다.

규칙:
- 입력칸에는 @를 뺀 Instagram ID만 입력 → "중복 확인 / 重複確認" 클릭 → 화면의 실제 결과 문구만 판정
- 등록 가능 → available / 이미 등록 → duplicate / 관리자 보호 목록 → protected
- 입력폼까지 정상 접근한 뒤 특정 후보의 결과 문구만 판별할 수 없는 경우에만 unknown
- "등록하기 / 登録する" 클릭, Instagram 탐색, 후보 외 탐색 금지

후보:
${ids}

입력폼 접근에 성공한 경우에만 모든 후보를 포함해 아래 형식의 JSON 하나를 만든다.
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"id","duplicateStatus":"available","duplicateMessage":"실제 핵심 문구 또는 null"}]}

제출 전 확인:
- results 개수 = 위 후보 개수
- handle은 @ 없이 정확히 일치
- 실제 화면에서 확인하지 않은 값을 추정하지 않는다

완료 후 JSON을 UTF-8 임시파일로 저장하고 curl.exe -H "Content-Type: application/json" --data-binary "@파일경로" http://localhost:3000/api/duplicate/results 로 POST한다. 응답의 \"ok\":true를 실제 확인해야 완료다.`;
}
