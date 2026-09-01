import { NextResponse } from "next/server";
import { AUTOMATION_BATCH_SIZE, FIXUP_DUPLICATE_CHECK_URL, getOpenCodeCommand } from "@/lib/automation/config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    openCodeCommand: getOpenCodeCommand(),
    duplicateUrl: FIXUP_DUPLICATE_CHECK_URL,
    batchSize: AUTOMATION_BATCH_SIZE,
    modes: {
      qualified: "검증 필요/추천 후보만 FixUp 중복 확인",
      priority: "중복 통과 후보만 Instagram 원본 최종 검증",
    },
    rules: [
      "playwright_b 현재 로그인 Chrome만 사용",
      "등록하기·DM·팔로우·좋아요·댓글 금지",
      "확인 불가는 null, 숫자 추정 금지",
      "Reels 평균은 Scout가 원본 조회수로 계산",
      "완료 결과는 localhost API로 자동 반영",
    ],
    promptDetails: {
      qualified: "후보 ID만 FixUp 중복 페이지에 입력 → 중복 확인 버튼 클릭 → available / duplicate / protected / unknown 판정 → 결과를 /api/duplicate/results 로 자동 제출",
      priority: "FixUp 중복 페이지를 다시 열지 않음 → 기존 중복 결과를 보존 → available 후보만 Instagram 원본에서 존재/공개/개인 Creator/BIO/팔로워/최근 활동/일본 타깃/한국 접점/장르 + 최신 Reel 최대 10개 원본 조회수 수집 → /api/verification/results 로 자동 제출",
    },
  });
}
