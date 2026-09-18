import { NextResponse } from "next/server";
import { z } from "zod";
import {
  calculateReminderAt,
  countDueUnseenPlannedVisits,
  createPlannedVisit,
  deletePlannedVisit,
  listPlannedVisits,
  markDuePlannedVisitsSeen,
  updatePlannedVisit,
} from "@/lib/supabase/planned";

export const runtime = "nodejs";

const plannedForSchema = z.string().regex(/^\d{4}-\d{2}(?:-\d{2})?$/);
const createSchema = z.object({
  instagramHandle: z.string().min(1).max(64),
  plannedFor: plannedForSchema,
  memo: z.string().max(1000).optional().default(""),
});
const updateSchema = z.object({
  id: z.string().uuid(),
  plannedFor: plannedForSchema,
  memo: z.string().max(1000).optional().default(""),
});
const deleteSchema = z.object({ id: z.string().uuid() });

export async function GET() {
  try {
    const items = await listPlannedVisits();
    return NextResponse.json({ ok: true, items, dueCount: countDueUnseenPlannedVisits(items) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "예정 등록 형식이 올바르지 않습니다." }, { status: 400 });
  try {
    calculateReminderAt(parsed.data.plannedFor);
    const item = await createPlannedVisit(parsed.data.instagramHandle, parsed.data.plannedFor, parsed.data.memo);
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return failure(error, 400);
  }
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "예정 수정 형식이 올바르지 않습니다." }, { status: 400 });
  try {
    calculateReminderAt(parsed.data.plannedFor);
    const item = await updatePlannedVisit(parsed.data.id, parsed.data.plannedFor, parsed.data.memo);
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return failure(error, 400);
  }
}

export async function PUT() {
  try {
    const seenCount = await markDuePlannedVisitsSeen();
    const items = await listPlannedVisits();
    return NextResponse.json({ ok: true, seenCount, items, dueCount: countDueUnseenPlannedVisits(items) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "예정 삭제 형식이 올바르지 않습니다." }, { status: 400 });
  try {
    await deletePlannedVisit(parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "예정 처리에 실패했습니다.";
  return NextResponse.json({ ok: false, error: message }, { status });
}
