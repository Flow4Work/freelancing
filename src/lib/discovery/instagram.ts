const RESERVED_PATHS = new Set([
  "accounts", "about", "developer", "directory", "explore", "p", "reel", "reels", "stories", "tv", "web",
]);

const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/i;

export function extractInstagramHandle(urlString: string, fallbackText = "") {
  try {
    const url = new URL(urlString);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "instagram.com" && host !== "m.instagram.com") return null;

    const parts = url.pathname.split("/").filter(Boolean);
    const direct = parts[0]?.toLowerCase();
    if (direct && !RESERVED_PATHS.has(direct) && HANDLE_PATTERN.test(direct)) return normalizeHandle(direct);
  } catch {
    return extractHandleFromText(fallbackText);
  }

  return extractHandleFromText(fallbackText);
}

export function extractHandleFromText(text: string) {
  const patterns = [
    /\(@([a-z0-9._]{1,30})\)/i,
    /instagram\.com\/([a-z0-9._]{1,30})/i,
    /(?:^|\s)@([a-z0-9._]{1,30})(?:\s|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && HANDLE_PATTERN.test(match[1])) return normalizeHandle(match[1]);
  }
  return null;
}

export function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function profileUrl(handle: string) {
  return `https://www.instagram.com/${normalizeHandle(handle)}/`;
}
