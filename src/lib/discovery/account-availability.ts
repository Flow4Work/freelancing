import type { AccountAvailability } from "./types";

const UNAVAILABLE_MARKERS = [
  "sorry, this page isn't available",
  "the link you followed may be broken",
  "페이지를 사용할 수 없습니다",
  "このページはご利用いただけません",
  "page isn't available",
];

export async function checkAccountAvailability(handle: string): Promise<AccountAvailability> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(`https://www.instagram.com/${handle}/`, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,ko;q=0.8,ja;q=0.7",
      },
    });

    if (response.status === 404) return "unavailable";
    if (response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) return "unknown";
    if (!response.ok) return "unknown";

    const finalPath = new URL(response.url).pathname.toLowerCase();
    if (finalPath.includes("/accounts/login") || finalPath.includes("/challenge/")) return "unknown";

    const html = (await response.text()).slice(0, 300_000);
    const lower = html.toLowerCase();
    if (UNAVAILABLE_MARKERS.some((marker) => lower.includes(marker))) return "unavailable";

    const handleLower = handle.toLowerCase();
    const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
    const profileMeta = metaTags.some((tag) => {
      const tagLower = tag.toLowerCase();
      return (tagLower.includes("og:title") || tagLower.includes("og:description")) && tagLower.includes(handleLower);
    });

    return profileMeta ? "active" : "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkAccountAvailabilities(handles: string[], concurrency = 6) {
  const result = new Map<string, AccountAvailability>();
  let cursor = 0;

  async function worker() {
    while (cursor < handles.length) {
      const index = cursor;
      cursor += 1;
      const handle = handles[index];
      result.set(handle, await checkAccountAvailability(handle));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, handles.length) }, () => worker()));
  return result;
}
