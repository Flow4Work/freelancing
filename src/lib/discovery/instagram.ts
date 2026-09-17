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
  "settings",
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

export type InstagramExtractionFailureReason =
  | "unsupported_instagram_url"
  | "owner_unresolved"
  | "invalid_handle"
  | "reserved_path";

export function extractInstagramCandidate(urlString: string, title = "", text = ""): InstagramCandidateExtraction | null {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "instagram.com" && host !== "m.instagram.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 1 && isValidHandle(parts[0])) {
    return { handle: normalizeHandle(parts[0]), evidenceKind: "profile", confidence: "high" };
  }

  if (parts.length === 3) {
    const [rawHandle, rawKind, shortcode] = parts;
    const handle = normalizeHandle(rawHandle);
    const kind = rawKind.toLowerCase();
    if (isValidHandle(handle) && CONTENT_PATHS.has(kind) && /^[a-z0-9_-]+$/i.test(shortcode)) {
      return { handle, evidenceKind: "content", confidence: "medium" };
    }
  }

  const first = parts[0]?.toLowerCase();
  if (!first || !CONTENT_PATHS.has(first) || parts.length !== 2 || !/^[a-z0-9_-]+$/i.test(parts[1])) return null;

  const owner = extractOwnerFromInstagramSeo(title, text);
  if (!owner) return null;
  return { handle: owner, evidenceKind: "content", confidence: "medium" };
}

export function getInstagramExtractionFailureReason(
  urlString: string,
  title = "",
  text = "",
): InstagramExtractionFailureReason | null {
  if (extractInstagramCandidate(urlString, title, text)) return null;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return "unsupported_instagram_url";
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if ((url.protocol !== "https:" && url.protocol !== "http:") || (host !== "instagram.com" && host !== "m.instagram.com")) {
    return "unsupported_instagram_url";
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (!parts.length) return "unsupported_instagram_url";
  const first = normalizeHandle(parts[0]);

  if (parts.length === 1) {
    if (RESERVED_PATHS.has(first)) return "reserved_path";
    return "invalid_handle";
  }

  if (parts.length === 3) {
    if (RESERVED_PATHS.has(first)) return "reserved_path";
    if (!HANDLE_PATTERN.test(first) || first.includes("..")) return "invalid_handle";
    return "unsupported_instagram_url";
  }

  if (CONTENT_PATHS.has(first) && parts.length === 2 && /^[a-z0-9_-]+$/i.test(parts[1])) {
    return extractOwnerFromInstagramSeo(title, text) ? null : "owner_unresolved";
  }

  if (RESERVED_PATHS.has(first)) return "reserved_path";
  return "unsupported_instagram_url";
}

export function extractExaInstagramCandidate(urlString: string, title = "", text = ""): InstagramCandidateExtraction | null {
  const generic = extractInstagramCandidate(urlString, title, text);
  if (generic) return generic;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "instagram.com" && host !== "m.instagram.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 3) return null;

  const [rawHandle, rawKind, shortcode] = parts;
  const handle = normalizeHandle(rawHandle);
  const kind = rawKind.toLowerCase();
  if (!isValidHandle(handle) || handle === "settings") return null;
  if (kind !== "p" && kind !== "reel") return null;
  if (!/^[a-z0-9_-]+$/i.test(shortcode)) return null;

  return { handle, evidenceKind: "content", confidence: "medium" };
}

export function extractOwnerFromInstagramSeo(title: string, text: string) {
  const normalizedTitle = title.replace(/\\(?=[a-z0-9._])/gi, "");
  const normalizedText = text.replace(/\\(?=[a-z0-9._])/gi, "");
  const titlePatterns = [
    /\(@([a-z0-9._]{1,30})\)\s*(?:•|on)\s*Instagram\b/i,
    /(?:^|\s)@([a-z0-9._]{1,30})\s+on\s+Instagram\b/i,
    /Instagram\s+(?:photo|video|reel)\s+by.{0,80}\(@([a-z0-9._]{1,30})\)/i,
    /(?:photo|video|reel)\s+by.{0,100}\(@([a-z0-9._]{1,30})\).{0,32}(?:Instagram|$)/i,
  ];

  for (const pattern of titlePatterns) {
    const match = normalizedTitle.match(pattern);
    if (match?.[1] && isValidHandle(match[1])) return normalizeHandle(match[1]);
  }

  const textPatterns = [
    /Never miss a post from\s+([a-z0-9._]{1,30})\b/i,
    /Instagram\s*[·•]\s*@?([a-z0-9._]{1,30})\b/i,
  ];
  for (const pattern of textPatterns) {
    const match = normalizedText.match(pattern);
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
