import { NextResponse } from "next/server";
import {
  getOpenCodeModelPreset,
  getOpenCodeModelPresets,
  isOpenCodeModelPreset,
  setOpenCodeModelPreset,
} from "@/lib/automation/opencode-model-preset";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    activePreset: getOpenCodeModelPreset(),
    presets: getOpenCodeModelPresets(),
  });
}

export async function POST(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    return NextResponse.json({ ok: false, error: "모델 순서 변경은 localhost에서만 가능합니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { preset?: unknown } | null;
  if (!isOpenCodeModelPreset(body?.preset)) {
    return NextResponse.json({ ok: false, error: "모델 순서는 A/B/C/D 중 하나여야 합니다." }, { status: 400 });
  }
  setOpenCodeModelPreset(body.preset);
  return NextResponse.json({
    ok: true,
    activePreset: getOpenCodeModelPreset(),
    presets: getOpenCodeModelPresets(),
  });
}
