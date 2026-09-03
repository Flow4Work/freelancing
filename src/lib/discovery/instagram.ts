const RESERVED_PATHS = new Set([
  "about",
  "accounts",
  "api",
  "challenge",
  "developer",
  "direct",
  "directory",
  "emails",
  "explore",
  "graphql",
  "legal",
  "oauth",
  "p",
  "popular",
  "privacy",
  "reel",
  "reels",
  "session",
  "stories",
  "terms",
  "tv",
  "web",
  "web_search",
]);

const CONTENT_PATHS = new Set(["p", "reel", "reels", "tv"]);
const HANDLE_PATTERN = /^(?=.{1,30}$)[a-z0-9_](?:[a-z0-9._]*[a-z0-9_])?$/i;

export type InstagramEvidenceKind = "profile" | "content";

export type InstagramCandidateExtraction = {
  handle: string;
  evidenceKind: InstagramEvidenceKind;
  confidence: "high" | "medium";
};

export function extractInstagramCandidate(urlString: string, title = "", text = ""): InstagramCandidateExtraction | null {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "instagram.com" && host !== "m.instagram.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 1 && isValidHandle(parts[0])) {
    return { handle: normalizeHandle(parts[0]), evidenceKind: "profile", confidence: "high" };
  }

  const first = parts[0]?.toLowerCase();
  if (!first || !CONTENT_PATHS.has(first)) return null;

  const owner = extractOwnerFromInstagramSeo(`${title}\n${text}`);
  if (!owner) return null;
  return { handle: owner, evidenceKind: "content", confidence: "medium" };
}

export function extractOwnerFromInstagramSeo(text: string) {
  const patterns = [
    /\(@([a-z0-9._]{1,30})\)\s*(?:•|on)\s*Instagram\b/i,
    /Never miss a post from\s+([a-z0-9._]{1,30})\b/i,
    /(?:^|\s)([a-z0-9._]{1,30})'s profile picture\b/i,
    /(?:^|\n)([a-z0-9._]{1,30})\s*•\s*Follow\b/im,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && isValidHandle(match[1])) return normalizeHandle(match[1]);
  }
  return null;
}

export function isValidHandle(handle: string) {
  const normalized = normalizeHandle(handle);
  if (!HANDLE_PATTERN.test(normalized)) return false;
  if (normalized.includes("..")) return false;
  if (RESERVED_PATHS.has(normalized)) return false;
  return true;
}

export function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function profileUrl(handle: string) {
  return `https://www.instagram.com/${normalizeHandle(handle)}/`;
}
