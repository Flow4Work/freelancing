export type DmContactHistoryLike = {
  id: string;
  handle: string;
  approvedAt: string;
  createdAt: string;
  generatedAt?: string | null;
};

export function selectLatestDmContactByHandle<T extends DmContactHistoryLike>(contacts: readonly T[]) {
  const latest = new Map<string, T>();
  for (const contact of contacts) {
    const current = latest.get(contact.handle);
    if (!current || compareDmContactRecency(contact, current) > 0) latest.set(contact.handle, contact);
  }
  return latest;
}

export function compareDmContactRecency(a: DmContactHistoryLike, b: DmContactHistoryLike) {
  const approved = compareTimestamp(a.approvedAt, b.approvedAt);
  if (approved !== 0) return approved;
  const created = compareTimestamp(a.createdAt, b.createdAt);
  if (created !== 0) return created;
  const generated = compareTimestamp(a.generatedAt ?? "", b.generatedAt ?? "");
  if (generated !== 0) return generated;
  return a.id.localeCompare(b.id);
}

function compareTimestamp(a: string, b: string) {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  const safeA = Number.isFinite(aMs) ? aMs : Number.NEGATIVE_INFINITY;
  const safeB = Number.isFinite(bMs) ? bMs : Number.NEGATIVE_INFINITY;
  return safeA === safeB ? 0 : safeA > safeB ? 1 : -1;
}
