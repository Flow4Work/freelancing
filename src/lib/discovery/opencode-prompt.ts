import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildOpenCodeVerificationPrompt(candidates: DiscoveryCandidate[], category: SearchCategory, jobId: string) {
  const categoryLabel = category === "beauty" ? "미용" : "맛집";
  const candidateRows = candidates.map((candidate) => JSON.stringify({
    handle: candidate.handle,
    duplicateStatus: candidate.duplicateCheckStatus,
    duplicateMessage: candidate.duplicateCheckMessage,
  })).join("\n");

  return `playwright_b의 현재 로그인된 Chrome 세션만 사용한다.

목적: 아래 FixUp ${categoryLabel} 후보의 Instagram 원본을 직접 최종 검증하고 결과를 FixUp Scout에 자동 반영한다.

가장 중요한 저장 규칙:
- 후보 1명 검증이 끝날 때마다 그 후보 결과 1건을 즉시 http://localhost:3000/api/verification/results 로 POST한다.
- 30명을 전부 조사한 뒤 한 번에 제출하지 않는다. 한 명 확인 → 즉시 POST → ok:true 확인 → 다음 후보 순서다.
- Python/py/python3, pathlib, Temp 파일, 결과 파일 생성, --data-binary @파일경로를 절대 사용하지 않는다.
- POST는 PowerShell Invoke-RestMethod로 메모리의 JSON 문자열을 직접 보낸다.
- 각 POST 응답의 ok:true와 processedCount/totalCount를 확인한다. POST가 실패하면 다음 후보로 넘어가지 말고 오류를 남기고 종료한다.
- 마지막 후보 POST 응답은 completed:true여야 전체 완료다. completed:true를 확인하지 못하면 완료라고 말하지 않는다.
- 이미 POST 성공한 후보는 Scout에 저장된 것이므로 다시 조사하거나 다시 제출하지 않는다.

중요:
- 이 단계에서는 FixUp 중복 페이지 / script.google.com / Apps Script를 절대 열지 않는다.
- 중복 확인은 이전 단계에서 끝났다. 아래 duplicateStatus / duplicateMessage는 절대 변경하지 않고 그대로 보존한다.
- duplicateStatus가 available인 후보만 Instagram 원본을 검증한다. 그 외 후보는 Instagram을 열지 않고 검증 필드를 null, reels는 []로 둔 뒤 즉시 1건 POST한다.
- 새 로그인, DM/팔로우/좋아요/댓글, 후보 외 탐색, 숫자 추정, Reels 평균 직접 계산을 금지한다.
- 프로필 header/meta만 읽고 검증을 끝내면 안 된다. 최근 활동과 Reels는 실제 게시물/Reel 화면까지 열어 확인한다.

Instagram 검증:
1. 각 available 후보의 https://www.instagram.com/{handle}/ 를 직접 연다.
2. 현재 원본에서 계정 존재 여부, 공개/비공개, 개인 크리에이터 여부, BIO, 팔로워, 일본 타깃, 한국 접점, ${categoryLabel} 관련성을 확인한다.
3. recentActivity는 실제 게시물 또는 Reel의 게시일을 확인해서만 판정한다. 최근 90일 안의 실제 게시물이 확인되면 true이고 lastActivityAt에는 확인한 최신 게시일을 넣는다. 게시일을 확인하지 못하면 recentActivity와 lastActivityAt을 추정하지 말고 null로 둔다.
4. ${category === "beauty" ? "미용 후보는 Reels 탭을 실제로 열고, 실제 게시일 기준 최신 Reel 최대 10개를 확인한다. 계정에 확인 가능한 Reel이 5개 이상이면 최소 5개의 조회수를 반드시 직접 수집하고, 가능하면 최대 10개까지 수집한다." : "맛집 후보도 최근 콘텐츠를 직접 열어 현재 활동과 카테고리 관련성을 검증한다."}
5. Reel은 url / postedAt / views를 원본에서만 수집한다. pinned 순서를 최신순으로 가정하지 않는다. Reel 자체는 확인했지만 조회수가 보이지 않으면 해당 Reel의 views만 null로 둔다.
6. ${category === "beauty" ? "프로필만 확인한 뒤 reels:[]로 제출하는 것은 금지한다. reels:[]는 실제로 Reels 탭/직접 URL 확인을 시도했지만 확인 가능한 Reel이 없거나 접근 자체가 불가능한 경우에만 허용하며, 그 이유를 note에 반드시 적는다." : "확인 불가 값은 null로 두고 추정하지 않는다."}
7. 일본 타깃 / 한국 접점 / ${categoryLabel} 관련성은 BIO 문구만으로 억지 확정하지 않는다. 현재 프로필과 최근 공개 콘텐츠를 함께 보고 판정한다.
8. 제3자 검색 결과나 과거 캐시만으로 현재 계정 존재/수치/활동을 확정하지 않는다.

각 후보 POST 전 QA:
- handle은 @ 없이 정확히 일치한다.
- duplicateStatus / duplicateMessage는 아래 기존 값과 완전히 동일해야 한다.
- 숫자를 확인하지 못했으면 null이다.
- recentActivity=true이면 lastActivityAt에 실제 확인한 날짜가 있어야 한다.
- ${category === "beauty" ? "정성 조건상 계속 검증할 가치가 있는 공개 개인 크리에이터인데 reels가 0개라면, POST 전에 해당 계정의 Reels 탭과 개별 Reel 접근을 한 번 더 시도한다. 그래도 확인 불가일 때만 reels:[]로 제출하고 note에 'Reels 원본 확인 불가'를 명시한다." : "최근 활동 판정은 실제 게시일 근거가 있어야 한다."}
- Reels 평균은 계산하지 않는다. Scout 서버가 수집한 원본 조회수로 계산한다.

후보와 기존 중복 결과(JSON Lines):
${candidateRows}

후보 1명당 아래 body 형식으로 즉시 제출한다.
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"id","duplicateStatus":"available","duplicateMessage":null,"exists":true,"isPrivate":false,"isPersonalCreator":true,"bio":"BIO 또는 null","followers":12345,"recentActivity":true,"lastActivityAt":"2026-08-31 또는 null","japaneseTarget":true,"koreaConnection":true,"categoryRelevant":true,"reels":[{"url":"https://www.instagram.com/reel/.../","postedAt":"2026-08-30","views":12345}],"note":"한국어 핵심 사유 1줄"}]}

PowerShell 제출 방식은 다음처럼 파일 없이 직접 수행한다.
$json = @'
{"jobId":"${jobId}","category":"${category}","results":[...현재 후보 1건만...]}
'@
$response = Invoke-RestMethod -Uri 'http://localhost:3000/api/verification/results' -Method POST -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
if ($response.ok -ne $true) { throw 'POST_FAILED' }
$response | ConvertTo-Json -Depth 5

마지막 후보에서 response.completed이 true인지 반드시 확인한 뒤 종료한다.`;
}
