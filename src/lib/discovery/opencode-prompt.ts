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
기존 최종 검증 항목은 그대로 유지하고, 특히 최근 Reels 실제 조회수를 빠뜨리지 않는다.

가장 중요한 저장 규칙:
- 후보 1명 검증이 끝날 때마다 그 후보 결과 1건을 즉시 http://localhost:3000/api/verification/results 로 POST한다.
- 전체 후보를 조사한 뒤 한 번에 제출하지 않는다. 한 명 확인 → 즉시 POST → ok:true 확인 → 다음 후보 순서다.
- Python/py/python3, pathlib, Temp 파일, 결과 파일 생성, --data-binary @파일경로를 절대 사용하지 않는다.
- POST는 PowerShell Invoke-RestMethod로 메모리의 JSON 문자열을 직접 보낸다.
- 각 POST 응답의 ok:true와 processedCount/totalCount를 확인한다. POST가 실패하면 다음 후보로 넘어가지 말고 오류를 남기고 종료한다.
- 마지막 후보 POST 응답은 completed:true여야 전체 작업 종료다. completed:true를 확인하지 못하면 전체 완료라고 말하지 않는다.
- 이미 POST 성공한 후보는 Scout에 저장된 것이므로 다시 조사하거나 다시 제출하지 않는다.

중요:
- 이 단계에서는 FixUp 중복 페이지 / script.google.com / Apps Script를 절대 열지 않는다.
- 중복 확인은 이전 단계에서 끝났다. 아래 duplicateStatus / duplicateMessage는 절대 변경하지 않고 그대로 보존한다.
- duplicateStatus가 available인 후보만 Instagram 원본을 검증한다. 그 외 후보는 Instagram을 열지 않고 검증 필드를 null, reels는 []로 둔 뒤 즉시 1건 POST한다.
- 새 로그인, DM/팔로우/좋아요/댓글, 후보 외 탐색, 숫자 추정을 금지한다.
- 프로필 header/meta만 읽고 검증을 끝내면 안 된다. 최근 활동은 현재 공개 콘텐츠에서 확인하고, Reels 조회수는 반드시 /reels/ 목록 화면에서 확인한다.
- Reels 평균은 직접 계산하지 않는다. Scout 서버가 제출된 실제 조회수로 산술평균을 계산한다.

Instagram 검증:
1. 각 available 후보의 https://www.instagram.com/{handle}/ 를 직접 연다.
2. 현재 원본에서 계정 존재 여부, 공개/비공개, 개인 크리에이터 여부, BIO, 팔로워, 일본 타깃, 한국 접점, ${categoryLabel} 관련성을 확인한다. 기존에 하던 검증 항목을 추가하거나 바꾸지 않는다.
3. recentActivity는 현재 공개 콘텐츠에서 실제 최근 게시 활동을 확인해서만 판정한다. 최근 90일 안의 실제 게시물이 확인되면 true이고 lastActivityAt에는 실제 확인한 최신 게시일을 넣는다. 게시일을 확인하지 못하면 recentActivity와 lastActivityAt을 추정하지 말고 null로 둔다.
4. Reels 조회수는 프로필에서 Reel을 하나씩 열지 말고 바로 https://www.instagram.com/{handle}/reels/ 로 이동해서 목록 화면에서 처리한다.
   - Reel 개별 페이지는 열지 않는다.
   - Reels 목록 화면에 표시된 카드들의 DOM/화면 텍스트를 한 번에 읽는다.
   - 📌 고정(pinned) Reel은 전부 제외한다.
   - 고정 Reel 제외 후 화면의 실제 최근 업로드 순서대로 일반 Reel 최대 8개를 사용한다.
   - 일반 Reel이 8개 미만이면 확인 가능한 최근 일반 Reel 전부를 사용한다.
   - 필요한 카드가 첫 화면에 다 보이지 않을 때만 최대 8개를 확보하는 데 필요한 만큼만 스크롤한다.
   - 각 카드에서 실제 Reel URL과 목록 화면에 표시된 조회수를 함께 수집한다.
   - postedAt이 목록 화면에서 실제 확인되면 넣고, 보이지 않으면 null로 둔다. postedAt 확인 때문에 개별 Reel을 열지 않는다.
5. 목록 화면의 축약 조회수는 Instagram이 표시한 실제 조회수이므로 정수로 변환해서 저장한다.
   - 1.1만 → 11000
   - 1.5만 → 15000
   - 7.8만 → 78000
   - 561.8만 → 5618000
   - 쉼표가 있는 숫자는 쉼표를 제거한다.
   - 화면에 표시된 값을 그대로 단위 변환할 뿐 다른 수치를 추정하지 않는다.
6. Reels 목록 화면에서도 조회수 자체가 표시되지 않거나 실제로 읽을 수 없는 카드가 있으면 그 카드의 views를 null로 제출한다. 0으로 만들거나 다른 값으로 추정하지 않는다.
7. reels:[]는 /reels/ 목록 화면에 진입했지만 확인 가능한 일반 Reel이 없거나 목록 화면에서 Reel URL/조회수를 전혀 읽을 수 없는 경우에만 허용한다. 이 경우 note에 실제 이유를 반드시 적고 검증 완료로 해석하지 않는다.
8. 고정 Reel과 일반 Reel을 화면에서 구분할 수 없다면 추정하지 않는다. 최근 일반 Reel 집합을 신뢰할 수 없으면 조회수 검증 실패로 처리하고 note에 이유를 적는다.
9. 일본 타깃 / 한국 접점 / ${categoryLabel} 관련성은 BIO 문구만으로 억지 확정하지 않는다. 현재 프로필과 최근 공개 콘텐츠를 함께 보고 판정한다.
10. 제3자 검색 결과나 과거 캐시만으로 현재 계정 존재/수치/활동을 확정하지 않는다.

Reels 기본 방식에서 금지:
- Reel 개별 페이지 방문
- Reel마다 snapshot 반복
- HTML 전체 dump 반복
- script 분석
- network / GraphQL 분석
- 조회수가 목록 화면에 보이는데 '정확한 정수가 아니다'라는 이유로 null 처리

반드시 구분할 것:
- 실제 최근 Reel 조회수를 읽었고 산술평균이 낮은 계정(예: 실제 평균 600회)도 Reels 검증 자체는 완료다. 실제 숫자를 그대로 제출한다. Scout가 낮은 성과 후보로 분류한다.
- Instagram Reels 목록 화면에서 조회수를 실제로 확인하지 못한 계정만 낮은 성과로 추정하지 않고 views:null 또는 reels:[]로 제출하여 insufficient → 재검증으로 남긴다.

각 후보 POST 전 QA:
- handle은 @ 없이 정확히 일치한다.
- duplicateStatus / duplicateMessage는 아래 기존 값과 완전히 동일해야 한다.
- 숫자를 확인하지 못했으면 null이다.
- recentActivity=true이면 lastActivityAt에 실제 확인한 날짜가 있어야 한다.
- available 공개 후보는 https://www.instagram.com/{handle}/reels/ 로 직접 진입했는지 확인한다.
- Reel 개별 페이지를 열지 않았는지 확인한다.
- 수집한 Reel은 고정 Reel 제외 후 최대 8개인지 확인한다.
- 각 수집 Reel에 목록 화면에서 얻은 실제 URL이 있고, 화면 조회수를 정수로 변환한 views가 있는지 확인한다.
- reels가 0개이거나 views:null이 하나라도 있으면 검증 완료로 판단하지 말고 note에 확인 실패 이유를 명시한다.
- Reels 평균은 계산하거나 payload에 임의로 넣지 않는다. Scout 서버가 기존 reels[]로 계산한다.

후보와 기존 중복 결과(JSON Lines):
${candidateRows}

후보 1명당 아래 body 형식으로 즉시 제출한다.
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"id","duplicateStatus":"available","duplicateMessage":null,"exists":true,"isPrivate":false,"isPersonalCreator":true,"bio":"BIO 또는 null","followers":12345,"recentActivity":true,"lastActivityAt":"2026-08-31 또는 null","japaneseTarget":true,"koreaConnection":true,"categoryRelevant":true,"reels":[{"url":"https://www.instagram.com/reel/.../","postedAt":null,"views":12345}],"note":"한국어 핵심 사유 1줄"}]}

PowerShell 제출 방식은 다음처럼 파일 없이 직접 수행한다.
$json = @'
{"jobId":"${jobId}","category":"${category}","results":[...현재 후보 1건만...]}
'@
$response = Invoke-RestMethod -Uri 'http://localhost:3000/api/verification/results' -Method POST -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
if ($response.ok -ne $true) { throw 'POST_FAILED' }
$response | ConvertTo-Json -Depth 5

마지막 후보에서 response.completed이 true인지 반드시 확인한 뒤 종료한다.`;
}
