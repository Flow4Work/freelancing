export type TimestampedEntry = {
  timestamp: string | null | undefined;
};

export function eventTimestampEpoch(value: string | null | undefined) {
  const epoch = Date.parse(value ?? "");
  return Number.isFinite(epoch) ? epoch : 0;
}

export function sortByEventTimestampDesc<T extends TimestampedEntry>(entries: readonly T[]) {
  return [...entries].sort((a, b) => eventTimestampEpoch(b.timestamp) - eventTimestampEpoch(a.timestamp));
}
