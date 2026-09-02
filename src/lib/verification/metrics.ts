import type { ReelMetricsStatus, ReelSnapshot } from "@/lib/discovery/types";

export type ReelMetrics = {
  snapshots: ReelSnapshot[];
  average: number | null;
  median: number | null;
  sampleSize: number;
  checkedCount: number;
  totalConsidered: number;
  status: ReelMetricsStatus;
};

export function computeReelMetrics(input: ReelSnapshot[]): ReelMetrics {
  const normalized = dedupeAndOrder(input).slice(0, 6);
  const views = normalized
    .map((item) => item.views)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);

  const average = views.length
    ? Math.round(views.reduce((sum, value) => sum + value, 0) / views.length)
    : null;

  const median = views.length ? Math.round(calculateMedian(views)) : null;
  const complete = normalized.length > 0 && normalized.every((item) => (
    Boolean(item.url)
    && typeof item.views === "number"
    && Number.isFinite(item.views)
    && item.views >= 0
  ));

  return {
    snapshots: normalized,
    average,
    median,
    sampleSize: views.length,
    checkedCount: views.length,
    totalConsidered: normalized.length,
    status: complete ? "ready" : "insufficient",
  };
}

function dedupeAndOrder(input: ReelSnapshot[]) {
  const deduped: ReelSnapshot[] = [];
  const seen = new Set<string>();

  for (const item of input.slice(0, 20)) {
    const key = item.url?.trim() || `${item.postedAt ?? "unknown"}:${item.views ?? "unknown"}:${deduped.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      url: item.url?.trim() || null,
      views: typeof item.views === "number" && Number.isFinite(item.views) && item.views >= 0 ? Math.round(item.views) : null,
      postedAt: normalizeDate(item.postedAt),
    });
  }

  // 모든 항목의 실제 게시일이 확인된 경우에만 날짜순으로 다시 정렬한다.
  // 일부 날짜가 없으면 verifier가 수집한 최신순을 그대로 보존한다.
  if (deduped.length && deduped.every((item) => item.postedAt)) {
    deduped.sort((a, b) => Date.parse(b.postedAt!) - Date.parse(a.postedAt!));
  }

  return deduped;
}

function calculateMedian(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
