import { FIXUP_DUPLICATE_CHECK_URL } from "@/lib/automation/config";
import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildOpenCodeVerificationPrompt(candidates: DiscoveryCandidate[], category: SearchCategory, jobId: string) {
  const categoryLabel = category === "beauty" ? "미용" : "맛집";
  const ids = candidates.map((candidate) => `@${candidate.handle}`).join("\n");

  return `playwright_b의 현재 로그인된 Chrome 세션만 사용한다.

목적: 아래 FixUp ${categoryLabel} 후보만 중복 확인 후 Instagram 원본 검증하고 결과를 FixUp Scout에 자동 반영한다.
중복 페이지: ${FIXUP_DUPLICATE_CHECK_URL}

금지: 등록하기 클릭, 새 로그인, DM/팔로우/좋아요/댓글, 후보 외 탐색, 숫자 추정, Reels 평균 계산.

처리:
1. 후보별 FixUp 중복 확인 버튼을 눌러 실제 문구로 available / duplicate / protected / unknown 판정.
2. available만 Instagram 확인. 나머지는 Instagram을 열지 않는다.
3. Instagram에서 존재/비공개, 개인 크리에이터 여부, BIO, 팔로워, 최근 90일 활동, 일본 타깃, 한국 접점, ${categoryLabel} 반복 콘텐츠를 확인한다.
4. 실제 게시일 기준 최신 Reel 최대 10개의 url / postedAt / views 원본만 수집한다. pinned 순서를 최신순으로 가정하지 않는다. 확인 불가는 null.

후보:
${ids}

모든 후보를 포함해 아래 형식의 JSON만 만든다. available이 아니면 Instagram 필드는 null, reels는 [].
{"jobId":"${jobId}","category":"${category}","results":[{"handle":"id","duplicateStatus":"available","duplicateMessage":"실제 핵심 문구 또는 null","exists":true,"isPrivate":false,"isPersonalCreator":true,"bio":"BIO 또는 null","followers":12345,"recentActivity":true,"lastActivityAt":"2026-08-31 또는 null","japaneseTarget":true,"koreaConnection":true,"categoryRelevant":true,"reels":[{"url":"https://www.instagram.com/reel/.../","postedAt":"2026-08-30","views":12345}],"note":"한국어 핵심 사유 1줄"}]}

완료 후 JSON을 UTF-8 임시파일로 저장하고 curl.exe --data-binary로 POST http://localhost:3000/api/verification/results 한다. 응답의 \"ok\":true를 확인해야 완료다.`;
}
