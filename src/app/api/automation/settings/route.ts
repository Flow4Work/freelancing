import { NextResponse } from "next/server";
import { AUTOMATION_BATCH_SIZE, FIXUP_DUPLICATE_CHECK_URL, getOpenCodeCommand } from "@/lib/automation/config";
import { getApiConnections, saveApiConnection } from "@/lib/automation/api-connections";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    openCodeCommand: getOpenCodeCommand(),
    duplicateUrl: FIXUP_DUPLICATE_CHECK_URL,
    batchSize: AUTOMATION_BATCH_SIZE,
    connections: getApiConnections(),
    connectionGuide: {
      required: "Exa 또는 Tavily 중 최소 1개",
      recommended: "OpenCode Zen",
      optional: "Google 추가 검색 및 OpenCode fallback provider",
    },
    modes: {
      qualified: "유력 후보만 FixUp 중복 확인",
      priority: "검증 우선 후보만 Instagram 원본 검증",
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

export async function POST(request: Request) {
  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    const hostHeader = (request.headers.get("host") ?? "").toLowerCase();
    const localUrl = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    const localHostHeader = hostHeader === "localhost"
      || hostHeader.startsWith("localhost:")
      || hostHeader === "127.0.0.1"
      || hostHeader.startsWith("127.0.0.1:")
      || hostHeader === "[::1]"
      || hostHeader.startsWith("[::1]:");
    if (!localUrl || !localHostHeader) {
      return NextResponse.json({ ok: false, error: "API Key 저장은 localhost에서만 사용할 수 있습니다." }, { status: 403 });
    }
    const body = await request.json() as { connectionId?: unknown; apiKey?: unknown };
    const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    if (!connectionId || !apiKey.trim()) {
      return NextResponse.json({ ok: false, error: "연결 대상과 API Key를 입력해 주세요." }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      connections: saveApiConnection(connectionId, apiKey),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "API 연결 저장 실패",
    }, { status: 400 });
  }
}