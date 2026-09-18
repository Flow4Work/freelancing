import { CORE_BEAUTY_FOLLOWERS, MAX_TARGET_FOLLOWERS_EXCLUSIVE, MIN_TARGET_FOLLOWERS } from "@/lib/verification/policy";
import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildOpenCodeVerificationPrompt(candidates: DiscoveryCandidate[], category: SearchCategory, jobId: string) {
  const categoryLabel = category === "beauty" ? "미용" : "맛집";
  const followerHardRejectLines = category === "beauty"
    ? `- followers < ${MIN_TARGET_FOLLOWERS}이면서 아래 소규모 creator 예외 근거가 충족되지 않음\n- followers >= ${MAX_TARGET_FOLLOWERS_EXCLUSIVE}`
    : `- followers >= ${MAX_TARGET_FOLLOWERS_EXCLUSIVE}`;
  const followerHardRejectInline = category === "beauty"
    ? `소규모 creator 예외가 없는 followers < ${MIN_TARGET_FOLLOWERS}, followers >= ${MAX_TARGET_FOLLOWERS_EXCLUSIVE}`
    : `followers >= ${MAX_TARGET_FOLLOWERS_EXCLUSIVE}`;
  const candidateRows = candidates.map((candidate) => JSON.stringify({
    handle: candidate.handle,
    duplicateStatus: candidate.duplicateCheckStatus,
    duplicateMessage: candidate.duplicateCheckMessage,
  })).join("\n");

  return `playwright_b의 현재 로그인된 Chrome 세션만 사용한다.

EXECUTION OWNERSHIP - mandatory:
- This main OpenCode agent must execute every browser action and every candidate itself.
- Never call task, subagent, delegate, agent-handoff, or any equivalent delegation tool. Never hand candidates or browser work to another agent.
- Never use playwright_b_browser_run_code_unsafe.
- Never read .playwright-mcp snapshot files from disk. Use playwright_b browser snapshot output directly.
- PERFORMANCE / CONTEXT: keep this one OpenCode session and the existing fallback/resume flow; never split into one session per candidate.
- browser_snapshot is NOT the default for a candidate profile. After navigation, use browser_find or another narrow read first and collect only exact handle, followers, bio, public/private, personal-creator evidence, Japan-target evidence, Korea evidence, category evidence, and recent-activity evidence.
- Use a full profile snapshot only when a required hard-gate fact cannot be determined by narrow reads, and at most once for that candidate profile. Never snapshot just to be safe.
- Ignore Meta/footer, Threads, inbox/menu, highlights, tagged content, external shopping links, navigation chrome, and long image alt text unless directly required for a hard gate.
- For /reels/, only profile-pass candidates may enter. Read only pinned status, normal Reel URL, and displayed views; use at most the latest 8 non-pinned Reels.
- Do not use a fixed 5-second wait. If the target is genuinely not ready, use one short conditional wait, then one narrow re-read; only then use the existing single reload/re-navigation recovery.
- After each candidate POST returns ok:true, retain only a compact working note: handle, followers, core decision/evidence, Reel summary, POST ok. Do not restate, revisit, or carry forward that candidate's raw DOM/snapshot/find/navigation output.
- Do not re-decide the same facts across multiple LLM turns: profile hard reject -> immediate POST; otherwise profile pass -> Reels core values -> final POST.

목적: 아래 FixUp ${categoryLabel} 후보의 Instagram 원본을 직접 최종 검증하고 결과를 FixUp Scout에 자동 반영한다.
- Always call browser_snapshot with an empty argument object, never with a target/ref from another snapshot. For verification, never call browser_evaluate; use fresh browser_snapshot/browser_find output and exact refs from the latest current-page snapshot only.
- Browser calls must be sequential, never parallel. Click only an exact ref from the latest snapshot of the current page; never guess a label or reuse a ref after navigation.
- RECOVERY: if the first browser tool error in this attempt says a snapshot ref is stale/not found, or browser_click hits the 5-second actionability timeout for a current aria-ref, immediately call browser_snapshot({}) once with no target, then retry the intended read/click exactly once using only a ref from that fresh snapshot. Never repeat this recovery loop. If the fresh-snapshot retry fails, stop the attempt so the supervisor can resume the remaining handles with the next model.
- For browser_click, pass the snapshot ref through the tool target field as the raw token exactly as returned. Example: snapshot [ref=f4e266] must be sent with target exactly "f4e266". Never prepend "ref=" and never remove or alter the frame prefix or the e separator.
- Never call browser_evaluate in this verification path. Do not construct CSS selectors or inspect document/body text with evaluate; required evidence must come from current browser_snapshot/browser_find output and observed current-page refs.
- If the latest snapshot already exposes the needed BIO/follower/category text, use that observed text directly. Do not run an extra evaluate only to expand BIO, inspect profile links, or find a more button.
- Once profile/BIO text has been read from the DOM, do not repeatedly re-extract it or click a guessed more button. Use the observed text and move to the next required check.
검증 항목은 유지하되, 후보마다 가장 싼 프로필 정보부터 확인하고 명백한 탈락이 확정되면 Reels를 열기 전에 즉시 종료한다.

가장 중요한 저장 규칙:
- 후보 1명 검증이 끝날 때마다 그 후보 결과 1건을 즉시 http://localhost:3000/api/verification/results 로 POST한다.
- 전체 후보를 조사한 뒤 한 번에 제출하지 않는다. 한 명 확인 → 즉시 POST → ok:true 확인 → 다음 후보 순서다.
- 이미 POST 성공한 후보는 Scout에 저장된 것이므로 다시 조사하거나 다시 제출하지 않는다.
- 각 POST 응답의 ok:true와 processedCount/totalCount를 확인한다. POST가 실패하면 다음 후보로 넘어가지 말고 오류를 남기고 종료한다.
- 마지막 후보 POST 응답은 completed:true여야 전체 작업 종료다. completed:true를 확인하지 못하면 전체 완료라고 말하지 않는다.

결과 POST 방식 — 이것 하나만 사용:
- Do not use bash, shell, PowerShell, pwsh, cmd, curl, Python, temp files, or command-line HTTP for result POST.
- Submit the exact collected result payload JSON object using fixup_result_verification({payload: {jobId: "${jobId}", category: "${category}", results: [RESULT_OBJECT]}}). This tool alone POSTs to your fixed endpoint. Do not navigate to localhost or use browser fetch for submission.
- payload is a structured tool argument object, not JSON text. Never JSON.stringify it, never wrap the object in quotes, and never send {payload: "{...}"}. The payload value itself must be {jobId, category, results}.
- RESULT_OBJECT must be the exact verified candidate result already collected from Instagram. Do not simplify, regenerate, or guess evidence while posting.
- Require response.ok === true and verify processedCount/totalCount. If the POST fails, stop immediately; do not inspect the candidate again.
- After a successful non-final POST, navigate directly to the next remaining Instagram profile. Do not query job/status endpoints yourself.
- For the final candidate, require response.completed === true before declaring the batch complete.

중요:
- 이 단계에서는 FixUp 중복 페이지 / script.google.com / Apps Script를 절대 열지 않는다.
- 중복 확인은 이전 단계에서 끝났다. 아래 duplicateStatus / duplicateMessage는 절대 변경하지 않고 그대로 보존한다.
- duplicateStatus가 available인 후보만 Instagram 원본을 검증한다. 그 외 후보는 Instagram을 열지 않고 검증 필드를 null, reels는 []로 둔 뒤 즉시 1건 POST한다.
- 새 로그인, DM/팔로우/좋아요/댓글, 후보 외 탐색, 숫자 추정을 금지한다.
- playwright_b_browser_run_code_unsafe 사용을 금지한다.
- Reels 평균은 직접 계산하지 않는다. Scout 서버가 제출된 실제 조회수로 산술평균을 계산한다.

후보별 1차 프로필 검증 — 반드시 이 순서부터:
1. https://www.instagram.com/{handle}/ 프로필을 연다.
2. 계정 존재 여부를 확인한다.
3. 공개/비공개를 확인한다.
4. 개인 크리에이터인지 확인한다. 공식 기업/브랜드/여행사/기관/연예인 공식 운영 계정 등 개인 KOL 대상이 명백히 아닌지 먼저 판단한다.
5. 현재 followers를 실제 화면에서 확인한다.
6. 일본 타깃 여부를 확인한다.
7. 한국 접점을 확인한다.
8. ${categoryLabel} 카테고리 관련성을 확인한다.
9. BIO와 현재 프로필/공개 콘텐츠에서 확인한 최소 근거만 기록한다. 불필요한 게시물 탐색은 하지 않는다.

소규모 creator/자기 사업 예외:
- 3K 미만이어도 개인 creator, 일본 타깃, 한국 거주/반복 방한, 실제 한국 Beauty 체험·사용 콘텐츠가 모두 직접 확인되면 조기 종료하지 않고 기존 Reels 확인을 진행한다. 각 근거를 creatorSignals/targetSignals/koreaSignals/categorySignals에 기록한다. 확정 합격을 선언하지 않는다. 서버는 Reels 성과를 포함해 needs_review로 남긴다.
- 개인 일상/패션/여행/뷰티 콘텐츠가 주체인 사람이 자기 사업을 함께 운영하는 것은 공식 매장 계정과 구분한다. 사업 소유만으로 비개인으로 판단하지 않는다. 공식 기관·병원·브랜드, 예약/채용/매장 영업 중심 계정의 방어는 유지한다.
- 패션/마마/한국생활 계정도 실제 한국 Beauty 콘텐츠를 확인하면 categoryRelevant 근거를 기록한다. BIO의 단어만으로 체험 콘텐츠를 추정하지 않는다.

1차 즉시 종료 조건:
아래 중 하나가 명백히 확정되면 그 후보는 즉시 결과를 POST하고 끝낸다. /reels/ 로 이동하지 않고 개별 Reel도 열지 않는다.
- 계정이 존재하지 않음
- 비공개 계정
- 개인 크리에이터가 아님
- 공식 기업/브랜드/기관 계정
${followerHardRejectLines}
- 일본 타깃이 아님
- 한국 접점이 명백히 없음
- ${categoryLabel} 카테고리와 명백히 관련 없음
- 그 밖의 기존 hard reject 조건이 프로필 단계에서 확정됨
${category === "beauty" ? `- 미용은 ${MIN_TARGET_FOLLOWERS.toLocaleString()}~${(CORE_BEAUTY_FOLLOWERS - 1).toLocaleString()} followers를 버리지 않는다. 유효 후보로 계속 검증하며, ${CORE_BEAUTY_FOLLOWERS.toLocaleString()} 이상을 핵심 추천 후보로 본다.` : ""}

1차 즉시 종료 payload 규칙:
- 실제 확인한 followers는 정확한 정수로 넣는다.
- 실제 확인한 BIO/기본값만 넣고 확인하지 못한 값은 null로 둔다.
- 탈락 이유가 분명하도록 note를 한국어 1줄로 넣는다.
- reels는 반드시 []다.
- Reels 확인 실패가 아니라 '조기 hard reject라 Reels 미확인'이라는 의미가 note에서 드러나야 한다.
- 명백한 탈락을 확인한 뒤 recentActivity나 Reels를 채우기 위해 추가 탐색하지 않는다.

2차 Reels 검증 — 1차 조건을 모두 통과한 후보만:
1. 1차 프로필 조건에서 hard reject가 하나도 확정되지 않은 후보만 다음 단계로 간다.
2. recentActivity는 현재 공개 콘텐츠에서 실제 최근 게시 활동을 확인해서만 판정한다. 최근 90일 안의 실제 게시물이 확인되면 true이고 lastActivityAt에는 실제 확인한 최신 게시일을 넣는다. recentActivity=false는 실제 공개 게시물의 최신 날짜가 90일보다 오래됐다는 것을 직접 확인한 경우에만 허용한다. 게시일/활동을 로딩 실패나 화면 제한 때문에 확인하지 못하면 recentActivity와 lastActivityAt을 모두 null로 두며 false로 추정하지 않는다.
3. 그 다음에만 https://www.instagram.com/{handle}/reels/ 로 직접 이동한다.
4. Reel 개별 페이지는 열지 않는다.
5. Reels 목록 화면에 표시된 카드들의 DOM/화면 텍스트를 한 번에 읽는다.
6. 📌 고정(pinned) Reel은 전부 제외한다.
7. 고정 Reel 제외 후 화면의 실제 최근 업로드 순서대로 일반 Reel 최대 8개를 사용한다.
8. 일반 Reel이 8개 미만이면 확인 가능한 최근 일반 Reel 전부를 사용한다.
9. 필요한 카드가 첫 화면에 다 보이지 않을 때만 최대 8개를 확보하는 데 필요한 만큼만 스크롤한다.
10. 각 카드에서 실제 Reel URL과 목록 화면에 표시된 조회수를 함께 수집한다.
11. postedAt이 목록 화면에서 실제 확인되면 넣고, 보이지 않으면 null로 둔다. postedAt 확인 때문에 개별 Reel을 열지 않는다.

Reels 숫자 규칙:
- 목록 화면의 축약 조회수는 Instagram이 표시한 실제 조회수이므로 정수로 변환해서 저장한다.
- 1.1만 → 11000
- 1.5만 → 15000
- 7.8만 → 78000
- 561.8만 → 5618000
- 쉼표가 있는 숫자는 쉼표를 제거한다.
- 화면에 표시된 값을 그대로 단위 변환할 뿐 다른 수치를 추정하지 않는다.
- Reels 목록 화면에서도 조회수 자체가 표시되지 않거나 실제로 읽을 수 없는 카드는 views:null로 제출한다. 0으로 만들지 않는다.
- reels:[]는 1차 hard reject로 조기 종료했거나, /reels/ 목록에 진입했지만 확인 가능한 일반 Reel이 없거나 Reel URL/조회수를 전혀 읽을 수 없는 경우에만 허용한다. 조기 종료가 아닌 확인 실패라면 note에 실제 이유를 적고 검증 완료로 해석하지 않는다.
- 고정 Reel과 일반 Reel을 구분할 수 없다면 추정하지 않는다. 최근 일반 Reel 집합을 신뢰할 수 없으면 조회수 검증 실패로 처리하고 note에 이유를 적는다.

일본 타깃 / 한국 접점 / ${categoryLabel} 관련성 + 구조화 evidence:
- 프로필만으로 명백한 false가 확인되면 즉시 탈락할 수 있다.
- 프로필만으로 애매하면 현재 공개 콘텐츠를 필요한 최소 범위에서 확인한다.
- 애매하다는 이유로 바로 /reels/ 조회수 수집부터 시작하지 않는다.
- 제3자 검색 결과나 과거 캐시만으로 현재 계정 존재/수치/활동을 확정하지 않는다.
- creatorSignals / targetSignals / koreaSignals / categorySignals는 오직 지금 Instagram 원본에서 실제로 본 짧고 구체적인 근거만 넣는다. 각 배열 최대 8개다. 네 필드는 항상 JSON 배열이어야 하며 근거가 없으면 []를 사용한다. 절대 null을 보내지 않는다.
- creatorSignals: 개인 creator라는 직접 근거. 예: 개인 소개, 개인 일상/리뷰 주체, 본인이 직접 체험·사용하는 콘텐츠. 단순 직업명만으로 creator 근거를 만들지 않는다.
- targetSignals: 일본인/일본어 발신/일본 시청자 대상이라는 직접 근거.
- koreaSignals: 한국 거주·방문·반복 방한·한국 미용·K-beauty·한국 여행 등 실제 한국 접점의 직접 근거.
- categorySignals: 이 계정 본인의 ${categoryLabel} 콘텐츠가 실제 주 콘텐츠라는 직접 근거. 살롱/병원/업체 서비스 소개 자체는 개인 beauty creator 근거로 쓰지 않는다.
- boolean을 true로 제출하려면 대응 배열이 반드시 1개 이상 있어야 한다: isPersonalCreator→creatorSignals, japaneseTarget→targetSignals, koreaConnection→koreaSignals, categoryRelevant→categorySignals.
- 대응 근거를 실제 Instagram에서 찾지 못했으면 true로 추정하지 않는다. 확인 불가면 null, 명백히 아니면 false다.
- 미용사/헤어디자이너라는 직업명 하나만으로 reject하지 않는다. 그러나 대표/오너/다점포 운영/예약 유도/채용/살롱 포트폴리오 중심이면 자기영업 계정으로 본다. 반대로 개인 creator이고 한국/K-beauty/방한 근거가 강하면 직업이 미용사여도 자동 reject하지 않는다.
- host/nightlife/유흥업, 회사·브랜드·병원·기관 공식 계정은 개인 creator로 true 처리하지 않는다.

Reels 기본 방식에서 금지:
- 1차 hard reject 후보의 /reels/ 방문
- Reel 개별 페이지 방문
- Reel마다 snapshot 반복
- HTML 전체 dump 반복
- script 분석
- network / GraphQL 분석
- 조회수가 목록 화면에 보이는데 '정확한 정수가 아니다'라는 이유로 null 처리

반드시 구분할 것:
- 1차 hard reject 후보는 Reels 없이 즉시 제외 저장한다.
- 1차 조건을 통과한 뒤 실제 최근 Reel 조회수를 읽었고 산술평균이 낮은 계정(예: 실제 평균 600회)도 Reels 검증 자체는 완료다. 실제 숫자를 그대로 제출한다. Scout가 낮은 성과 후보로 분류한다.
- 1차 조건을 통과했지만 Instagram Reels 목록 화면에서 조회수를 실제로 확인하지 못한 계정만 낮은 성과로 추정하지 않고 views:null 또는 reels:[]로 제출하여 insufficient → 재검증으로 남긴다.

각 후보 POST 전 QA:
- handle은 @ 없이 정확히 일치한다.
- duplicateStatus / duplicateMessage는 아래 기존 값과 완전히 동일하다.
- 숫자를 확인하지 못했으면 null이다.
- isPersonalCreator:true인데 creatorSignals가 비어 있으면 안 된다.
- japaneseTarget:true인데 targetSignals가 비어 있으면 안 된다.
- koreaConnection:true인데 koreaSignals가 비어 있으면 안 된다.
- categoryRelevant:true인데 categorySignals가 비어 있으면 안 된다.
- targetSignals와 koreaSignals가 모두 비어 있는데 qualified가 될 것이라고 가정하지 않는다. 실제 근거 부족으로 남긴다.
- ${followerHardRejectInline}, 또는 다른 1차 hard reject가 확정된 후보는 /reels/ 방문 0회이고 reels:[]인지 확인한다.
- 1차 조건을 통과한 공개 후보만 https://www.instagram.com/{handle}/reels/ 로 진입했는지 확인한다.
- Reel 개별 페이지를 열지 않았는지 확인한다.
- 수집한 Reel은 고정 Reel 제외 후 최대 8개인지 확인한다.
- 각 수집 Reel에 목록 화면에서 얻은 실제 URL이 있고, 화면 조회수를 정수로 변환한 views가 있는지 확인한다.
- 1차 통과 후보에서 reels가 0개이거나 views:null이 하나라도 있으면 검증 완료로 판단하지 말고 note에 확인 실패 이유를 명시한다.
- Reels 평균은 계산하거나 payload에 임의로 넣지 않는다. Scout 서버가 reels[]로 계산한다.
- Save each candidate only with fixup_result_verification using the structured object payload defined above; require response.ok:true before continuing.

후보와 기존 중복 결과(JSON Lines):
${candidateRows}

후보 1명당 아래 body 형식으로 즉시 제출한다.
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"id","duplicateStatus":"available","duplicateMessage":null,"exists":true,"isPrivate":false,"isPersonalCreator":true,"bio":"BIO 또는 null","followers":12345,"recentActivity":true,"lastActivityAt":"2026-08-31 또는 null","japaneseTarget":true,"koreaConnection":true,"categoryRelevant":true,"creatorSignals":["Instagram 원본의 개인 creator 직접 근거"],"targetSignals":["Instagram 원본의 일본 타깃 직접 근거"],"koreaSignals":["Instagram 원본의 한국 접점 직접 근거"],"categorySignals":["Instagram 원본의 카테고리 직접 근거"],"reels":[{"url":"https://www.instagram.com/reel/.../","postedAt":null,"views":12345}],"note":"한국어 핵심 사유 1줄"}]}

마지막 후보에서 response.completed이 true인지 반드시 확인한 뒤 종료한다.`;
}
