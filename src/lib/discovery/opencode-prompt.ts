import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildOpenCodeVerificationPrompt(candidates: DiscoveryCandidate[], category: SearchCategory, jobId: string) {
  const categoryLabel = category === "beauty" ? "미용" : "맛집";
  const candidateRows = candidates.map((candidate) => JSON.stringify({
    handle: candidate.handle,
    duplicateStatus: candidate.duplicateCheckStatus,
    duplicateMessage: candidate.duplicateCheckMessage,
  })).join("\n");

  return `playwright_b의 현재 로그인된 Chrome 세션만 사용한다.

목적: 아래 FixUp ${categoryLabel} 후보의 Instagram 원본만 직접 검증하고 결과를 FixUp Scout에 자동 반영한다.

중요:
- 이 단계에서는 FixUp 중복 페이지 / script.google.com / Apps Script를 절대 열지 않는다.
- 중복 확인은 이전 단계에서 끝난 값이다. 아래 duplicateStatus / duplicateMessage를 그대로 보존한다.
- duplicateStatus가 available인 후보만 Instagram 원본을 검증한다. 그 외 후보는 Instagram을 열지 않고 검증 필드를 null, reels는 []로 둔다.
- 새 로그인, DM/팔로우/좋아요/댓글, 후보 외 탐색, 숫자 추정, Reels 평균 계산 금지.

Instagram 검증:
1. 각 available 후보의 https://www.instagram.com/{handle}/ 를 직접 연다.
2. 계정 존재 여부, 공개/비공개, 개인 크리에이터 여부, BIO, 팔로워, 최근 90일 활동, 일본 타깃, 한국 접점, ${categoryLabel} 반복 콘텐츠를 현재 Instagram 원본에서 확인한다.
3. 실제 게시일 기준 최신 Reel 최대 10개의 url / postedAt / views를 원본에서만 수집한다. pinned 순서를 최신순으로 가정하지 않는다. 확인 불가는 null.
4. 제3자 검색 결과나 과거 캐시만으로 현재 계정 존재/수치를 확정하지 않는다.

후보와 기존 중복 결과(JSON Lines):
${candidateRows}

모든 후보를 정확히 한 번씩 포함해 아래 형식의 JSON 하나만 만든다. duplicateStatus / duplicateMessage는 위 기존 값을 그대로 복사한다.
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"id","duplicateStatus":"available","duplicateMessage":null,"exists":true,"isPrivate":false,"isPersonalCreator":true,"bio":"BIO 또는 null","followers":12345,"recentActivity":true,"lastActivityAt":"2026-08-31 또는 null","japaneseTarget":true,"koreaConnection":true,"categoryRelevant":true,"reels":[{"url":"https://www.instagram.com/reel/.../","postedAt":"2026-08-30","views":12345}],"note":"한국어 핵심 사유 1줄"}]}

제출 전 확인:
- results 개수 = 위 후보 개수
- handle은 @ 없이 정확히 일치
- duplicateStatus / duplicateMessage는 위 값과 동일
- 숫자를 확인하지 못했으면 null

완료 후 JSON을 UTF-8 임시파일로 저장하고 curl.exe -H "Content-Type: application/json" --data-binary "@파일경로" http://localhost:3000/api/verification/results 로 POST한다. 응답의 \"ok\":true를 실제 확인해야 완료다.`;
}
