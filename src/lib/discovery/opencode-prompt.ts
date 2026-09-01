import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildOpenCodeVerificationPrompt(candidates: DiscoveryCandidate[], category: SearchCategory, jobId: string) {
  const categoryLabel = category === "beauty" ? "미용" : "맛집";
  const lines = candidates.map((candidate, index) => {
    const extras: string[] = [];
    if (candidate.flags.some((flag) => flag.includes("일본 타깃"))) extras.push("일본인/일본어 대상 근거");
    if (candidate.flags.some((flag) => flag.includes("한국 접점"))) extras.push("한국 거주·반복 방한·반복 한국 콘텐츠 근거");
    if (candidate.flags.some((flag) => flag.includes("장르"))) extras.push(`${categoryLabel} 콘텐츠가 반복적으로 있는지`);
    const suffix = extras.length ? ` · 특히 확인: ${extras.join(", ")}` : "";
    return `${index + 1}. @${candidate.handle}${suffix}`;
  });

  return `playwright_b의 현재 로그인된 Instagram 세션만 사용한다.

목적은 아래 FixUp ${categoryLabel} 후보의 Instagram 원본 사실만 수집하는 것이다. 새 계정을 찾거나 DM을 작성/전송하는 작업이 아니다.

절대 하지 말 것:
- DM 전송
- 팔로우
- 좋아요
- 댓글
- 후보 외 계정 추가 탐색
- 숫자 추정
- Reels 평균 직접 계산

검증 기준:
- exists: 현재 프로필 존재가 확인되면 true, 존재하지 않음이 명확하면 false, Instagram 오류/차단 등으로 판단 불가면 null
- isPrivate: 비공개면 true, 공개면 false, 판단 불가면 null
- isPersonalCreator: 개인 크리에이터면 true. 병원/의사/브랜드/매장/서비스/미디어/공식 운영계정이면 false. 애매하면 null
- recentActivity: 최근 90일 안에 게시물 또는 Reel이 확인되면 true, 아니면 false, 확인 불가면 null
- japaneseTarget: 일본인 또는 일본어 중심으로 일본 이용자를 대상으로 발신하는 근거가 명확하면 true. 단순 일본 관련 1회 언급은 부족
- koreaConnection: 한국 거주, 반복 방한, 최근 12개월 내 여러 한국 관련 콘텐츠, 또는 명확한 한국 전문성이 있으면 true. 한국 관련 1회 협찬만으로 true 금지
- categoryRelevant: ${categoryLabel} 콘텐츠가 반복적으로 확인되면 true. 우연한 1회 게시물만으로 true 금지
- 확인 불가 값은 반드시 null

Reels 수집 규칙:
- Reels 탭에서 실제 게시일 기준 최신 Reel 최대 10개를 확인한다.
- 고정(pinned) 때문에 화면 상단 순서를 최신순이라고 가정하지 않는다. 가능한 경우 각 Reel의 실제 게시일을 확인한다.
- 각 Reel마다 url, postedAt, views 원본값을 기록한다.
- 조회수 확인 불가면 views:null, 게시일 확인 불가면 postedAt:null.
- 평균/중앙값은 계산하지 않는다. 앱이 원본값으로 계산한다.
- 10개 미만이면 확인 가능한 Reel 전부만 기록한다.

후보:
${lines.join("\n")}

마지막에는 설명문 대신 아래 JSON 한 개를 정확히 만든다. 후보를 빠뜨리지 않는다.
{
  "jobId": "${jobId}",
  "category": "${category}",
  "results": [
    {
      "handle": "계정ID",
      "exists": true,
      "isPrivate": false,
      "isPersonalCreator": true,
      "bio": "현재 BIO 원문 또는 null",
      "followers": 12345,
      "recentActivity": true,
      "lastActivityAt": "2026-08-31 또는 null",
      "japaneseTarget": true,
      "koreaConnection": true,
      "categoryRelevant": true,
      "reels": [
        {"url":"https://www.instagram.com/reel/.../","postedAt":"2026-08-30","views":12345}
      ],
      "note": "한국어로 핵심 사유 1줄"
    }
  ]
}

모든 후보 검증이 끝난 뒤 위 JSON을 localhost로 자동 제출한다.
POST http://localhost:3000/api/verification/results
Content-Type: application/json

Windows에서는 JSON을 UTF-8 임시파일로 저장하고 curl.exe로 전송한다. 예:
$tmp = Join-Path $env:TEMP "fixup-verification-${jobId}.json"
[System.IO.File]::WriteAllText($tmp, $jsonText, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X POST "http://localhost:3000/api/verification/results" -H "Content-Type: application/json" --data-binary "@$tmp"
Remove-Item $tmp -ErrorAction SilentlyContinue

응답에 \"ok\":true가 확인되어야 완료다. 제출 실패 시 임의로 성공 처리하지 말고 실패 사유만 보고한다.`;
}
