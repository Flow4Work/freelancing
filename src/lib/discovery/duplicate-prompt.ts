import { FIXUP_DUPLICATE_CHECK_URL } from "@/lib/automation/config";
import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildDuplicateCheckPrompt(candidates: DiscoveryCandidate[], category: SearchCategory, jobId: string) {
  const candidateRows = candidates.map((candidate) => JSON.stringify({
    handle: candidate.handle,
    followers: candidate.followers,
    followersSource: candidate.followersSource,
  })).join("\n");
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

후보와 현재 followers(JSON Lines), 위에서 아래 순서 그대로:
${candidateRows}

가장 중요한 저장 규칙:
- 후보 1명의 화면 판정과 필요한 followers 확인이 끝나는 즉시 그 후보 1건만 http://localhost:3000/api/duplicate/results 로 POST한다.
- 전체 후보를 다 검사한 뒤 한 번에 제출하지 않는다.
- 한 명 판정 → 필요한 경우 followers 확인 → 즉시 POST → ok:true 확인 → 다음 후보 순서다.
- Python/py/python3, Temp 파일, 파일 저장, --data-binary @파일경로를 사용하지 않는다.
- 각 POST 응답의 processedCount/totalCount를 확인한다. POST가 실패하면 다음 후보로 넘어가지 않고 실패 종료한다.
- 마지막 후보 POST 응답은 completed:true여야 전체 완료다.

로그인 및 폼 진입 규칙:
1. 먼저 ${FIXUP_DUPLICATE_CHECK_URL} 로 navigate한다.
2. navigate 직후 최신 snapshot을 새로 찍는다.
3. 현재 문서 snapshot에 로그인 ID/PW 입력칸이 정상적으로 보이고 입력 가능한 경우에만 그 최신 snapshot의 실제 ref를 사용해 ID/PW를 입력한다.
4. Google Apps Script 바깥 shell 때문에 실제 로그인 폼이 iframe 안에 있고 현재 snapshot ref로 입력할 수 없는 경우에만 다음 한 번의 우회를 허용한다.
   - 안전한 browser_evaluate로 현재 문서의 iframe 실제 src만 읽는다. 클릭/입력/DOM 변경은 evaluate로 하지 않는다.
   - 읽은 iframe src로 직접 browser_navigate 한다.
   - 이동 후 반드시 snapshot을 새로 찍는다.
   - 새 snapshot에 나온 실제 ID/PW 입력칸의 최신 ref만 사용한다.
5. snapshot이 바뀐 뒤 이전 aria/ref를 다시 사용하지 않는다. 오래된 ref로 fill/click을 재시도하지 않는다.
6. 로그인 성공 후 다시 최신 snapshot을 찍고, 그 snapshot에서 "Instagram ID" 입력칸과 "중복 확인 / 重複確認" 버튼을 찾는다.
7. iframe 구조를 장시간 분석하거나 다른 우회법을 연속 실험하지 않는다. 위 직접 폼 URL 진입까지 했는데 로그인/폼을 사용할 수 없으면 실패 종료한다.
8. playwright_b_browser_run_code_unsafe는 로그인 문제 해결을 포함해 어떤 경우에도 절대 사용하지 않는다.

중복 판정 실행 규칙:
1. 로그인 후 확보한 최신 "Instagram ID" 입력칸과 "중복 확인 / 重複確認" 폼을 사용한다.
2. 후보는 순서대로 정확히 1회만 처리한다.
   - 입력칸 비우기
   - @ 없이 ID 입력
   - 중복 확인 클릭
   - 결과가 갱신되면 최신 snapshot/화면 결과 문구 확인
3. 화면 갱신 뒤 ref가 무효가 됐다면 새 snapshot에서 같은 폼의 최신 ref를 다시 얻는다. 과거 ref를 재사용하지 않는다.
4. 판정은 3개만 사용한다.
   - 등록 가능 / 登録可能 → available
   - 이미 등록 / 登録済み → duplicate
   - 보호 목록 / 保護リスト → protected
5. duplicate 또는 protected가 확인되면 그 후보는 즉시 POST하고 종료한다. Instagram을 열지 않고 다음 후보로 넘어간다.

followers 확인 규칙:
- followersSource가 "instagram"이고 followers가 숫자면 이미 Instagram에서 확인된 정확값이다. 다시 Instagram을 열지 않는다.
- followersSource가 "search"인 숫자는 Exa/Tavily 검색 결과의 참고값일 뿐 정확값이 아니다. 자동 제외 판단에 사용하지 않는다.
- 중복 판정이 available이고, followersSource가 "search"이거나 followers가 null인 경우에만 https://www.instagram.com/{handle}/ 프로필을 열어 현재 팔로워 수를 확인한다.
- duplicate/protected/unknown이면 followers가 없거나 검색 참고값뿐이어도 Instagram을 절대 열지 않는다.
- 현재 팔로워 수를 실제 Instagram 화면에서 확인한 경우에만 정수 followers로 제출한다.
- 숫자를 확인하지 못하면 추정하거나 0으로 만들지 말고 followers:null로 제출한다.
- Instagram에서 정확한 followers가 100000 이상으로 확인되면 그 숫자만 즉시 POST한다. BIO, Reels, 게시물, DM 등은 보지 않고 그 후보를 종료한다.
- Instagram에서 정확한 followers가 100000 미만으로 확인되어도 이 단계의 추가 조사는 팔로워 수 확인까지만이다.

금지:
- 후보 재검사
- 목록에 없는 테스트 계정 입력
- 결과 형식 연구, iframe/DOM 장시간 연구, 추가 우회 실험
- 오래된 snapshot ref 재사용
- playwright_b_browser_run_code_unsafe 사용
- Temp 파일 생성, cat, 파일 저장 후 --data-binary @파일경로 사용
- "등록하기 / 登録する" 클릭
- duplicate/protected/unknown 후보의 Instagram 열기
- followersSource="instagram"인 후보의 Instagram 재확인
- 팔로워 외 Instagram BIO/Reels/게시물/DM 추가 조사
- 검색 참고 followers만으로 100000 이상 제외 판정
- 결과/숫자 추정

후보 1명당 제출 형식:
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"id","duplicateStatus":"available","duplicateMessage":"화면의 실제 결과 문구","followers":12345}]}
Instagram에서 새로 정확한 followers를 확인하지 않았으면 followers:null 또는 필드 생략이 가능하다. 서버는 기존 정확값 또는 검색 참고값을 구분해 보존한다.

PowerShell 직접 POST 예시:
$json = @'
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"현재ID","duplicateStatus":"available","duplicateMessage":"실제 문구","followers":12345}]}
'@
$response = Invoke-RestMethod -Uri 'http://localhost:3000/api/duplicate/results' -Method POST -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
if ($response.ok -ne $true) { throw 'POST_FAILED' }
$response | ConvertTo-Json -Depth 5

응답 ok:true 확인 후에만 다음 후보로 간다. 마지막 응답 completed:true 확인 후 추가 작업 없이 종료한다.
로그인 실패, 입력폼 없음, 후보 하나라도 중복 판정 실패, POST 실패 시 즉시 실패 종료한다. 이미 POST 성공한 앞 후보 결과는 Scout에 그대로 보존된다.`;
}
