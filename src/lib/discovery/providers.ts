import type { RawSearchResult, SearchProvider } from "./types";

const timeoutMs = Number(process.env.DISCOVERY_TIMEOUT_MS ?? 12000);

export function getConfiguredProviders(): SearchProvider[] {
  const providers: SearchProvider[] = [];
  if (process.env.EXA_API_KEY) providers.push(new ExaProvider(process.env.EXA_API_KEY));
  if (process.env.TAVILY_API_KEY) providers.push(new TavilyProvider(process.env.TAVILY_API_KEY));
  return providers;
}

export function getConfiguredGoogleProviders(): SearchProvider[] {
  const providers: SearchProvider[] = [];
  if (process.env.SERPER_API_KEY) providers.push(new SerperProvider(process.env.SERPER_API_KEY));
  if (process.env.SERPAPI_API_KEY) providers.push(new SerpApiProvider(process.env.SERPAPI_API_KEY));
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
        includeDomains: ["instagram.com"],
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
        include_domains: ["instagram.com"],
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

class SerperProvider implements SearchProvider {
  readonly name = "serper" as const;
  constructor(private readonly apiKey: string) {}

  async search(query: string, limit: number): Promise<RawSearchResult[]> {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify({
        q: query,
        gl: "jp",
        hl: "ja",
        num: Math.min(limit, 20),
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Serper ${response.status}`);
    const payload = await response.json() as { organic?: Array<{ link?: string; title?: string; snippet?: string }> };
    return (payload.organic ?? [])
      .slice(0, Math.min(limit, 20))
      .flatMap((item) => item.link ? [{ provider: this.name, url: item.link, title: item.title ?? "", text: item.snippet ?? "" }] : []);
  }
}

class SerpApiProvider implements SearchProvider {
  readonly name = "serpapi" as const;
  constructor(private readonly apiKey: string) {}

  async search(query: string, limit: number): Promise<RawSearchResult[]> {
    const endpoint = new URL("https://serpapi.com/search");
    endpoint.searchParams.set("engine", "google");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("api_key", this.apiKey);
    endpoint.searchParams.set("gl", "jp");
    endpoint.searchParams.set("hl", "ja");
    endpoint.searchParams.set("google_domain", "google.co.jp");

    const response = await fetch(endpoint, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`SerpApi ${response.status}`);
    const payload = await response.json() as {
      error?: string;
      search_metadata?: { status?: string };
      organic_results?: Array<{ link?: string; title?: string; snippet?: string }>;
    };
    if (payload.error || payload.search_metadata?.status === "Error") throw new Error("SerpApi API error");
    return (payload.organic_results ?? [])
      .slice(0, Math.min(limit, 20))
      .flatMap((item) => item.link ? [{ provider: this.name, url: item.link, title: item.title ?? "", text: item.snippet ?? "" }] : []);
  }
}
