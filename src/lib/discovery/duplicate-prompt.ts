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

목적: 후보 ID를 FixUp 중복 페이지에서 먼저 전부 판정한 뒤, 필요한 available 후보만 Instagram 프로필 존재 여부와 정확한 followers를 확인하고 결과를 FixUp Scout에 batch로 제출한다.
중복 페이지: ${FIXUP_DUPLICATE_CHECK_URL}

로그인:
- 사용자 이름: ${loginId}
- 비밀번호: ${loginPassword}
- 위 값은 로그인 입력에만 사용한다. 출력/저장/결과 JSON 포함 금지.

후보와 현재 followers(JSON Lines), 위에서 아래 순서 그대로:
${candidateRows}

전체 처리 순서 — 반드시 이 순서를 지킨다:
1. FixUp 중복 페이지 로그인/폼 진입.
2. 후보 전원을 FixUp 폼에서 연속으로 중복 판정한다. 이 단계에서는 Instagram을 절대 열지 않는다.
3. 각 후보의 FixUp 판정 결과를 메모리에 유지한다: available / duplicate / protected / unknown, 실제 화면 문구 duplicateMessage.
4. 후보 전원의 FixUp 판정이 끝난 뒤 duplicate/protected/unknown 후보를 한 batch로 먼저 POST한다. 해당 그룹이 비어 있으면 POST하지 않는다.
5. 그 다음 available 후보만 처리한다. followersSource=instagram이고 followers가 숫자면 Instagram을 다시 열지 않는다. followersSource=search이거나 followers=null인 후보만 Instagram 프로필을 열어 계정/페이지 존재 여부와 정확한 followers를 확인한다.
6. Instagram 확인 대상은 Instagram A → Instagram B → Instagram C 순서로 연속 처리한다. 다시 FixUp 페이지로 돌아가지 않는다.
7. available 후보 전부의 Instagram 확인이 끝나면 available 후보 결과 전체를 두 번째 batch로 POST한다. 해당 그룹이 비어 있으면 POST하지 않는다.
8. 마지막 POST 응답의 completed:true를 확인한 뒤 종료한다.

절대 금지되는 왕복:
- FixUp A → Instagram A → FixUp B → Instagram B
- 후보 한 명마다 POST 반복
- Instagram 확인 뒤 FixUp 폼으로 복귀

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

1단계 — FixUp 중복 판정 전원 처리:
- 로그인 후 확보한 최신 "Instagram ID" 입력칸과 "중복 확인 / 重複確認" 폼을 계속 재사용한다.
- 후보는 위 목록 순서대로 정확히 1회씩 처리한다.
  - 입력칸 비우기
  - @ 없이 ID 입력
  - 중복 확인 클릭
  - 결과가 갱신되면 최신 snapshot/화면 결과 문구 확인
- 화면 갱신 뒤 ref가 무효가 됐다면 새 snapshot에서 같은 폼의 최신 ref를 다시 얻는다. 과거 ref를 재사용하지 않는다.
- 판정 매핑:
  - 등록 가능 / 登録可能 → available
  - 이미 등록 / 登録済み → duplicate
  - 보호 목록 / 保護リスト → protected
  - 위 셋 중 하나로 신뢰 있게 판정할 수 없음 → unknown
- 각 후보의 duplicateStatus와 실제 duplicateMessage를 메모리에 보관한다.
- 이 단계가 끝날 때까지 Instagram을 절대 열지 않는다.

1차 batch 저장 — Instagram 불필요 후보:
- duplicate / protected / unknown 후보만 모아 http://localhost:3000/api/duplicate/results 로 한 번에 POST한다.
- 그룹이 비어 있으면 1차 POST를 생략한다.
- followers는 이 단계에서 새로 확인하지 않는다. null 또는 필드 생략 가능하다.
- instagramAvailable은 null 또는 필드 생략 가능하다.
- 응답 ok:true를 확인한다.
- available 후보가 남아 있으면 completed:false여도 정상이다. processedCount가 이번 1차 batch 수만큼 반영됐는지 확인한다.
- available 후보가 하나도 없어서 이 POST로 모든 후보가 처리됐다면 completed:true를 확인하고 종료한다.

2단계 — available 후보만 Instagram 프로필 확인:
- followersSource가 "instagram"이고 followers가 숫자면 이미 Instagram에서 확인된 정확값이다. Instagram을 다시 열지 않고 그 숫자를 그대로 사용한다. 이 경우 instagramAvailable은 null로 제출해도 된다.
- followersSource가 "search"인 숫자는 Exa/Tavily 검색 참고값일 뿐 정확값이 아니다. 자동 제외 판단에 사용하지 않는다.
- followersSource가 "search"이거나 followers가 null인 available 후보만 https://www.instagram.com/{handle}/ 프로필을 연다.
- Instagram 확인 대상끼리 연속으로 처리한다. FixUp 페이지로 돌아가지 않는다.
- 목적은 현재 프로필 존재 여부와 정확한 followers 확인뿐이다.

Instagram 존재 여부 판정 — 반드시 구분:
- 프로필이 정상적으로 열리고 해당 계정의 프로필 헤더/게시물 영역을 확인할 수 있으면 instagramAvailable:true다.
- Instagram이 해당 계정에 대해 "페이지를 사용할 수 없습니다", "Sorry, this page isn't available", 존재하지 않는 계정에 해당하는 명확한 오류 화면을 보여주면 instagramAvailable:false다. 이 경우 followers:null로 두고 즉시 해당 후보 확인을 끝낸다.
- 로그인 요구, 일시적 로딩 실패, 도구 timeout, Instagram 자체 오류 등으로 계정 존재 여부를 신뢰 있게 판정할 수 없으면 instagramAvailable:null이다. 이런 경우를 계정 없음으로 추정하지 않는다.
- instagramAvailable:false 후보는 BIO/Reels/게시물/DM 등 추가 조사를 하지 않는다.

followers 규칙:
- instagramAvailable:true인 경우 실제 Instagram 화면에서 숫자를 확인한 경우에만 정수 followers로 기록한다.
- 프로필은 정상적으로 열렸지만 followers 숫자를 확인하지 못하면 instagramAvailable:true, followers:null로 둔다.
- 계정 존재 여부도 판정하지 못했으면 instagramAvailable:null, followers:null로 둔다.
- 정확한 followers가 100000 이상이면 그 숫자만 기록하고 즉시 해당 후보 확인을 끝낸다.
- followers 100000 이상/미만 모두 BIO, Reels, 게시물, DM, 카테고리 분석 등 추가 조사를 하지 않는다.

2차 batch 저장 — available 후보:
- available 후보 전체 결과를 http://localhost:3000/api/duplicate/results 로 한 번에 POST한다.
- followersSource=instagram으로 기존 정확값이 있던 후보도 이 batch에 포함한다.
- Instagram을 실제로 연 후보는 instagramAvailable을 반드시 true / false / null 중 실제 판정값으로 포함한다.
- Instagram에서 새로 확인하지 못한 followers는 null로 제출한다. 서버는 기존 값/검색 참고값을 기존 로직대로 보존한다.
- instagramAvailable:false이면 서버가 계정/페이지 접근 불가 후보로 제외한다.
- instagramAvailable:true이고 정확한 followers가 100000 미만이면 중복 통과 단계로 이동할 수 있다.
- instagramAvailable:true인데 followers:null이거나 instagramAvailable:null이면 중복 통과로 보내지 않고 기존 추천 후보/검증 필요 단계에 남긴다.
- 응답 ok:true와 completed:true를 반드시 확인한다.
- processedCount와 totalCount가 같아야 전체 작업 실행은 완료다. 단, 각 후보의 실제 목적지는 응답 저장 결과에 따라 중복 통과/기존 후보 단계/제외로 달라질 수 있다.

POST 안정성:
- Windows PowerShell의 single-quoted here-string + Invoke-RestMethod 방식만 사용한다.
- 후보 1명당 POST하지 않는다. 기본 최대 POST 횟수는 2회다: 1차 확정 batch + 2차 available batch.
- 한 그룹이 비어 있으면 해당 POST는 생략한다.
- Python/py/python3, Temp 파일, 파일 저장, --data-binary @파일경로를 사용하지 않는다.
- 긴 JSON을 powershell -Command 문자열 안에 직접 삽입하지 않는다.
- bash heredoc, <<, curl heredoc, Linux shell 문법을 사용하지 않는다.
- POST 실패 후 다른 전송 방식을 여러 번 실험하지 않는다. 실패하면 오류를 남기고 종료한다.

PowerShell batch POST 형식 예시:
$json = @'
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"id1","duplicateStatus":"available","duplicateMessage":"실제 문구","followers":12345,"instagramAvailable":true},{"handle":"id2","duplicateStatus":"available","duplicateMessage":"실제 문구","followers":null,"instagramAvailable":false}]}
'@
$response = Invoke-RestMethod -Uri 'http://localhost:3000/api/duplicate/results' -Method POST -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
if ($response.ok -ne $true) { throw 'POST_FAILED' }
$response | ConvertTo-Json -Depth 5

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
- 팔로워/프로필 존재 여부 외 Instagram BIO/Reels/게시물/DM 추가 조사
- 검색 참고 followers만으로 100000 이상 제외 판정
- 페이지 로딩 실패를 계정 없음으로 추정
- 결과/숫자 추정

안정성 원칙:
- 1차 batch POST가 성공한 뒤 Instagram 단계에서 문제가 생겨도 duplicate/protected/unknown 결과는 Scout에 보존된다.
- available 후보는 Instagram 확인 단계가 끝나기 전에는 processed 처리하지 않는다.
- Instagram 단계 또는 2차 POST가 실패하면 이미 성공한 1차 결과를 다시 제출하거나 재검사하지 않는다.
- 마지막 응답 completed:true를 확인하지 못하면 전체 실행 완료라고 말하지 않는다.`;
}
