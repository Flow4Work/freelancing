import { FIXUP_DUPLICATE_CHECK_URL } from "@/lib/automation/config";
import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildDuplicateCheckPrompt(candidates: DiscoveryCandidate[], category: SearchCategory, jobId: string) {
  const ids = candidates.map((candidate) => candidate.handle).join("\n");
  const loginId = process.env.FIXUP_DUPLICATE_LOGIN_ID?.trim();
  const loginPassword = process.env.FIXUP_DUPLICATE_LOGIN_PASSWORD?.trim();

  if (!loginId || !loginPassword) {
    throw new Error("FixUp 중복 페이지 로그인 ID/PW가 .env.local에 설정되지 않았습니다.");
  }

  return `playwright_b의 현재 Chrome 세션만 사용한다.

목적: 후보 ID를 FixUp 중복 페이지에서 순서대로 1회씩 확인하고, 결과를 FixUp Scout에 제출한다.
중복 페이지: ${FIXUP_DUPLICATE_CHECK_URL}

로그인:
- 사용자 이름: ${loginId}
- 비밀번호: ${loginPassword}
- 위 값은 로그인 입력에만 사용한다. 출력/저장/결과 JSON 포함 금지.

후보, 위에서 아래 순서 그대로:
${ids}

실행 규칙:
1. 중복 페이지를 연다.
2. 로그인 화면이면 사용자 이름과 비밀번호를 직접 입력해 로그인한다.
3. "Instagram ID" 입력칸과 "중복 확인 / 重複確認" 버튼을 한 번만 찾고, 이후 같은 폼을 계속 사용한다.
4. 후보는 순서대로 정확히 1회만 처리한다.
   - 입력칸 비우기
   - @ 없이 ID 입력
   - 중복 확인 클릭
   - 화면 결과 문구 확인
5. 판정은 3개만 사용한다.
   - 등록 가능 / 登録可能 → available
   - 이미 등록 / 登録済み → duplicate
   - 보호 목록 / 保護リスト → protected
6. 마지막 후보 판정 직후 전체 결과를 즉시 FixUp Scout에 제출한다.

금지:
- 후보 재검사
- 목록에 없는 테스트 계정 입력
- 결과 형식 연구, iframe/DOM 연구, 추가 실험
- playwright_b_browser_run_code_unsafe 사용
- Temp 파일 생성, cat, 파일 저장 후 --data-binary @파일경로 사용
- "등록하기 / 登録する" 클릭
- Instagram 열기
- 결과 추정

제출 형식:
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"id","duplicateStatus":"available","duplicateMessage":"화면의 실제 결과 문구"}]}

제출은 파일을 만들지 말고 PowerShell 직접 POST만 사용한다.
예시:
$json = @'
{"jobId":"${jobId}","category":"${category}","results":[...]}
'@
$response = Invoke-RestMethod -Uri 'http://localhost:3000/api/duplicate/results' -Method POST -ContentType 'application/json; charset=utf-8' -Body $json
if ($response.ok -ne $true) { throw 'POST_FAILED' }

응답의 ok:true를 확인하면 추가 확인 없이 종료한다.
로그인 실패, 입력폼 없음, 후보 하나라도 판정 실패, POST 실패 시 저장하지 말고 실패 종료한다.`;
}
