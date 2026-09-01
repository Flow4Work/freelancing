import type { RawSearchResult, SearchProvider } from "./types";

const timeoutMs = Number(process.env.DISCOVERY_TIMEOUT_MS ?? 12000);

export function getConfiguredProviders(): SearchProvider[] {
  const providers: SearchProvider[] = [];
  if (process.env.EXA_API_KEY) providers.push(new ExaProvider(process.env.EXA_API_KEY));
  if (process.env.TAVILY_API_KEY) providers.push(new TavilyProvider(process.env.TAVILY_API_KEY));
  return providers;
}

class ExaProvider implements SearchProvider {
  readonly name = "exa" as const;
  constructor(private readonly apiKey: string) {}

  async search(query: string, limit: number): Promise<RawSearchResult[]> {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: Math.min(limit, 20),
        contents: { text: { maxCharacters: 900 } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Exa ${response.status}`);
    const payload = await response.json() as { results?: Array<{ url?: string; title?: string; text?: string }> };
    return (payload.results ?? []).flatMap((item) => item.url ? [{ provider: this.name, url: item.url, title: item.title ?? "", text: item.text ?? "" }] : []);
  }
}

class TavilyProvider implements SearchProvider {
  readonly name = "tavily" as const;
  constructor(private readonly apiKey: string) {}

  async search(query: string, limit: number): Promise<RawSearchResult[]> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        search_depth: "basic",
        max_results: Math.min(limit, 20),
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Tavily ${response.status}`);
    const payload = await response.json() as { results?: Array<{ url?: string; title?: string; content?: string }> };
    return (payload.results ?? []).flatMap((item) => item.url ? [{ provider: this.name, url: item.url, title: item.title ?? "", text: item.content ?? "" }] : []);
  }
}
