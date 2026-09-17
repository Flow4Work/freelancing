const VALID_REF = /^(?:f\d+)?e\d+$/;
const SNAPSHOT_REF = /\[ref=((?:f\d+)?e\d+)\]/g;
const FIXUP_BROWSER_AGENTS = new Set([
  "fixup-duplicate",
  "fixup-verification",
  "fixup-dm",
  "fixup-dm-sync",
]);

const MAX_SNAPSHOT_PAGES_PER_SESSION = 8;
const stateBySession = new Map();
const RELAY_CONNECT_URL = /^chrome-extension:\/\/mmlmfjhmonkocbjadbfplnigmagldckm\/connect\.html(?:[?#]|$)/i;

function isRelayConnectUrl(url) {
  return typeof url === "string" && RELAY_CONNECT_URL.test(url.trim());
}

function collectToolOutputText(output) {
  if (typeof output?.output === "string") return output.output;
  if (!Array.isArray(output?.content)) return "";
  return output.content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function collectCurrentPageUrl(output) {
  if (typeof output !== "string") return null;
  const pageMatches = [...output.matchAll(/^- Page URL: (.+)$/gm)];
  if (pageMatches.length) return pageMatches.at(-1)[1].trim();
  const currentTab = output.match(/^- \d+: \(current\) \[[^\]]*\]\((.+)\)$/m);
  return currentTab?.[1]?.trim() ?? null;
}

function collectSnapshotRefs(output) {
  const refs = new Set();
  if (typeof output !== "string") return refs;
  for (const match of output.matchAll(SNAPSHOT_REF)) refs.add(match[1]);
  return refs;
}

function getSessionState(sessionID) {
  let state = stateBySession.get(sessionID);
  if (!state) {
    state = { currentPageUrl: null, snapshotsByPage: new Map(), sequence: 0 };
    stateBySession.set(sessionID, state);
  }
  return state;
}

function rememberSnapshot(state, pageUrl, refs) {
  const owner = pageUrl ?? state.currentPageUrl ?? "__unknown__";
  state.sequence += 1;
  state.snapshotsByPage.delete(owner);
  state.snapshotsByPage.set(owner, { pageUrl: owner, refs, sequence: state.sequence });
  while (state.snapshotsByPage.size > MAX_SNAPSHOT_PAGES_PER_SESSION) {
    state.snapshotsByPage.delete(state.snapshotsByPage.keys().next().value);
  }
}

function snapshotRecords(state) {
  return [...state.snapshotsByPage.values()];
}

function recordsContainingRaw(state, raw) {
  return snapshotRecords(state).filter((record) => record.refs.has(raw));
}

function rawRefIsProven(state, raw) {
  const current = state.currentPageUrl && state.snapshotsByPage.get(state.currentPageUrl);
  if (current?.refs.has(raw)) return true;
  return recordsContainingRaw(state, raw).length === 1;
}

function normalizeClickTarget(target, state, requireProvenRaw = false) {
  if (typeof target !== "string") return { target, corrected: false };
  if (VALID_REF.test(target)) {
    if (requireProvenRaw && !rawRefIsProven(state, target)) {
      throw new Error(`FIXUP_REF_GUARD raw snapshot ref ${target} is not proven by an active page snapshot`);
    }
    return { target, corrected: false };
  }
  const bracketed = target.match(/^\[ref=([^\]]+)\]$/);
  if (bracketed) {
    const result = normalizeClickTarget(`ref=${bracketed[1]}`, state, requireProvenRaw);
    return { target: result.target, corrected: result.target !== target };
  }

  if (!target.startsWith("ref=")) {
    if (requireProvenRaw) throw new Error(`FIXUP_REF_GUARD DM browser action requires a raw snapshot ref, got: ${target}`);
    return { target, corrected: false };
  }

  const raw = target.slice(4);
  if (!raw) throw new Error("FIXUP_REF_GUARD invalid empty snapshot ref");

  if (VALID_REF.test(raw)) {
    const matches = recordsContainingRaw(state, raw);
    const current = state.currentPageUrl && state.snapshotsByPage.get(state.currentPageUrl);
    if (current?.refs.has(raw) || matches.length === 1) return { target: raw, corrected: true };
    throw new Error(`FIXUP_REF_GUARD snapshot ref ${raw} is not uniquely proven by an active page snapshot`);
  }

  const collapsed = raw.match(/^f(\d+)$/);
  if (collapsed) {
    const suffix = `e${collapsed[1]}`;
    const matches = [];
    for (const record of snapshotRecords(state)) {
      for (const ref of record.refs) {
        if (ref.endsWith(suffix)) matches.push({ ref, pageUrl: record.pageUrl });
      }
    }
    if (matches.length === 1) return { target: matches[0].ref, corrected: true };
    throw new Error(`FIXUP_REF_GUARD cannot uniquely resolve ${target} from active page snapshots`);
  }

  throw new Error(`FIXUP_REF_GUARD invalid snapshot ref serialization: ${target}`);
}

function normalizeFillFormTarget(target, state) {
  if (typeof target !== "string") return { target, corrected: false };

  if (VALID_REF.test(target)) {
    return normalizeClickTarget(target, state, true);
  }

  const bracketed = target.match(/^\[ref=([^\]]+)\]$/);
  if (bracketed) {
    const result = normalizeClickTarget(`ref=${bracketed[1]}`, state, true);
    return { target: result.target, corrected: result.target !== target };
  }

  if (target.startsWith("ref=")) {
    return normalizeClickTarget(target, state, true);
  }

  return { target, corrected: false };
}

function assertRelayNavigationSafe(agent, currentUrl) {
  if (agent === "fixup-duplicate" && isRelayConnectUrl(currentUrl)) {
    throw new Error("FIXUP_RELAY_GUARD refusing browser_navigate on playwright_b connect.html relay tab; preserve relay and create/select a work tab");
  }
}

export default async function FixUpPlaywrightRefGuard() {
  return {
    "tool.execute.after": async (input, output) => {
      if (!FIXUP_BROWSER_AGENTS.has(process.env.FIXUP_SCOUT_AGENT)) return;
      if (!input.tool.startsWith("playwright_b_")) return;

      const state = getSessionState(input.sessionID);
      const text = collectToolOutputText(output);
      const currentUrl = collectCurrentPageUrl(text);
      if (currentUrl) state.currentPageUrl = currentUrl;

      const refs = collectSnapshotRefs(text);
      if (refs.size || input.tool === "playwright_b_browser_snapshot") {
        rememberSnapshot(state, currentUrl, refs);
      }
    },

    "tool.execute.before": async (input, output) => {
      if (!FIXUP_BROWSER_AGENTS.has(process.env.FIXUP_SCOUT_AGENT)) return;
      const state = getSessionState(input.sessionID);

      if (input.tool === "playwright_b_browser_navigate") {
        assertRelayNavigationSafe(process.env.FIXUP_SCOUT_AGENT, state.currentPageUrl);
        return;
      }
      if (input.tool === "playwright_b_browser_type") {
        const strict = process.env.FIXUP_SCOUT_AGENT === "fixup-dm-sync" || process.env.FIXUP_SCOUT_AGENT === "fixup-dm";
        if (!strict) return;
        const result = normalizeClickTarget(output?.args?.target, state, true);
        if (result.corrected) output.args.target = result.target;
        return;
      }
      if (input.tool === "playwright_b_browser_fill_form") {
        const fields = output?.args?.fields;
        if (!Array.isArray(fields)) return;
        for (const field of fields) {
          if (!field || typeof field !== "object") continue;
          const result = normalizeFillFormTarget(field.target, state);
          if (result.corrected) field.target = result.target;
        }
        return;
      }
      if (input.tool !== "playwright_b_browser_click") return;

      const result = normalizeClickTarget(
        output?.args?.target,
        state,
        process.env.FIXUP_SCOUT_AGENT === "fixup-dm-sync" || process.env.FIXUP_SCOUT_AGENT === "fixup-dm",
      );
      if (result.corrected) output.args.target = result.target;
    },
  };
}
