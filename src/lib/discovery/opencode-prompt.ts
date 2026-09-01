import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildOpenCodeVerificationPrompt(candidates: DiscoveryCandidate[], category: SearchCategory) {
  const categoryLabel = category === "beauty" ? "미용" : "맛집";
  const lines = candidates.map((candidate, index) => {
    const checks = [
      "계정 존재·공개/비공개",
      "개인 크리에이터인지(병원·의사·브랜드·매장·서비스·미디어 제외)",
      "현재 BIO와 팔로워 수",
      "최근 활동 여부",
      "최근 Reels 최대 10개 조회수와 산술평균",
      "일본 타깃 여부",
      "한국 접점 여부",
      `${categoryLabel} 콘텐츠 적합성`,
    ];

    if (candidate.flags.some((flag) => flag.includes("일본 타깃"))) checks.push("특히 일본인/일본어 대상 근거 확인");
    if (candidate.flags.some((flag) => flag.includes("한국 접점"))) checks.push("특히 한국 거주·방한·한국 관련 반복 콘텐츠 확인");
    if (candidate.flags.some((flag) => flag.includes("장르"))) checks.push(`특히 ${categoryLabel} 콘텐츠가 실제 주력인지 확인`);
    if (candidate.evidenceKind === "content") checks.push("검색 게시물의 작성자가 이 프로필 본인인지 재확인");

    return `${index + 1}. @${candidate.handle}\n확인: ${checks.join(", ")}`;
  });

  return `playwright_b의 현재 로그인된 Instagram 세션을 사용한다.\n\n목적은 아래 FixUp ${categoryLabel} 후보를 Instagram 원본에서 재검증하는 것이다. 새 계정을 찾거나 DM을 작성·전송하는 작업이 아니다.\n\n절대 하지 말 것:\n- DM 전송\n- 팔로우\n- 좋아요\n- 댓글\n- 후보 외 계정 추가 탐색\n\n판정 원칙:\n- 비공개 계정은 private\n- 병원·의사·브랜드·매장·서비스·미디어 등 개인 크리에이터가 아니면 reject\n- 확인할 수 없는 값은 추정하지 말고 확인 불가\n- Reels 평균은 실제 확인한 표본의 산술평균으로 계산하고 표본 수도 함께 기록\n\n후보:\n${lines.join("\n\n")}\n\n마지막 출력은 계정별 한 줄만:\n@ID | pass/review/reject/private | 팔로워 | Reels 평균(표본수) | 핵심 사유\n`;
}
