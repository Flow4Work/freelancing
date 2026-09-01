import { FIXUP_DUPLICATE_CHECK_URL } from "@/lib/automation/config";
import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildDuplicateCheckPrompt(candidates: DiscoveryCandidate[], category: SearchCategory, jobId: string) {
  const ids = candidates.map((candidate) => `@${candidate.handle}`).join("\n");
  const loginId = process.env.FIXUP_DUPLICATE_LOGIN_ID?.trim();
  const loginPassword = process.env.FIXUP_DUPLICATE_LOGIN_PASSWORD?.trim();

  if (!loginId || !loginPassword) {
    throw new Error("FixUp 중복 페이지 로그인 ID/PW가 .env.local에 설정되지 않았습니다.");
  }

  return `playwright_b의 현재 Chrome 세션만 사용한다.

목적: 아래 후보의 Instagram ID가 FixUp에 이미 등록되어 있는지만 Apps Script에서 확인하고, 그 결과만 FixUp Scout에 저장한다.
중복 페이지: ${FIXUP_DUPLICATE_CHECK_URL}

로그인 정보:
- 사용자 이름: ${loginId}
- 비밀번호: ${loginPassword}
- 위 값은 이 작업의 로그인 입력에만 사용한다. 콘솔 출력, 별도 파일 저장, 결과 JSON 포함 금지.

작업 순서:
1. 위 중복 페이지를 연다.
2. 현재 페이지가 실제 중복 확인 입력폼인지 먼저 확인한다.
   - browser_snapshot이 Unknown이면 존재하지 않는 ref를 추정하거나 임의 생성해서 클릭하지 않는다.
   - 이전 snapshot의 ref를 재사용하지 않는다.
   - snapshot이 Unknown이면 URL, title, body의 보이는 텍스트로 현재 로그인 화면인지 입력폼인지 확인한다.
3. 로그인 화면이면 위 로그인 정보를 직접 사용한다.
   - 현재 화면에서 실제 확인되는 사용자 이름/ID 입력칸에 사용자 이름을 입력한다.
   - 실제 확인되는 비밀번호 입력칸에 비밀번호를 입력한다.
   - 실제 확인되는 로그인 버튼만 클릭한다.
   - snapshot ref가 없거나 Unknown이면 임의 ref를 만들지 말고 DOM의 실제 label/name/placeholder/text를 확인해 해당 입력 요소를 찾는다.
   - 로그인 실패 문구가 나오면 LOGIN_FAILED라고 남기고 즉시 실패 종료한다.
4. 로그인 후 실제 "중복 확인 / 重複確認" 입력폼이 보이는지 다시 확인한다. 보이지 않으면 INPUT_FORM_NOT_FOUND로 실패 종료한다.
5. 후보를 한 명씩 처리한다.
   - 입력칸을 완전히 비운다.
   - @를 뺀 Instagram ID만 정확히 입력한다.
   - 현재 화면에서 실제 확인된 입력칸과 "중복 확인 / 重複確認" 버튼만 사용한다.
   - 화면에 실제로 표시된 결과 문구를 확인한다.
   - 등록 가능 → available
   - 이미 등록 → duplicate
   - 관리자 보호 목록 → protected
6. 모든 후보 확인이 끝난 뒤 결과를 FixUp Scout에 한 번만 제출한다.

절대 금지:
- 현재 snapshot에 없는 ref를 추정해서 클릭
- 로그인 ID/PW를 콘솔/응답/결과 JSON/별도 파일에 출력 또는 저장
- "등록하기 / 登録する" 클릭
- Apps Script에서 후보 등록/수정
- Instagram 열기/검색/검증
- 후보 외 계정 탐색
- 결과 추정
- 로그인 실패 상태나 입력폼 미접근 상태에서 결과 저장
- 특정 후보의 실제 결과를 확인하지 못했는데 unknown 등으로 임의 저장

후보:
${ids}

로그인 성공 + 입력폼 접근 성공 + 모든 후보의 실제 결과 확인이 완료된 경우에만 아래 JSON을 만든다.
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"id","duplicateStatus":"available","duplicateMessage":"화면에 표시된 실제 핵심 문구"}]}

제출 전 반드시 확인:
- results 개수 = 위 후보 개수
- handle은 @ 없이 정확히 일치
- duplicateStatus는 available / duplicate / protected 중 하나만 사용
- 각 결과는 실제 화면 문구를 직접 확인한 값이어야 한다

완료 후 JSON을 UTF-8 임시파일로 저장하고 curl.exe -H "Content-Type: application/json" --data-binary "@파일경로" http://localhost:3000/api/duplicate/results 로 POST한다. 응답의 \"ok\":true를 실제 확인해야 완료다.

LOGIN_FAILED, INPUT_FORM_NOT_FOUND, 후보 하나라도 결과 판별 실패가 있으면 POST하지 말고 작업을 실패로 종료한다.`;
}
