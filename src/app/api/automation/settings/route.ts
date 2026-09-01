import { NextResponse } from "next/server";
import { AUTOMATION_BATCH_SIZE, FIXUP_DUPLICATE_CHECK_URL, getOpenCodeCommand } from "@/lib/automation/config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    openCodeCommand: getOpenCodeCommand(),
    duplicateUrl: FIXUP_DUPLICATE_CHECK_URL,
    batchSize: AUTOMATION_BATCH_SIZE,
    modes: {
      qualified: "유력 후보만 FixUp 중복 확인",
      priority: "검증 우선 후보만 중복 확인 후 Instagram 원본 검증",
    },
    rules: [
      "playwright_b 현재 로그인 Chrome만 사용",
      "등록하기·DM·팔로우·좋아요·댓글 금지",
      "확인 불가는 null, 숫자 추정 금지",
      "Reels 평균은 Scout가 원본 조회수로 계산",
      "완료 결과는 localhost API로 자동 반영",
    ],
  });
}
