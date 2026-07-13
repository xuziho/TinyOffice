import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fetch } from "undici";
import { Type } from "typebox";

const MAX_RESULTS = 10;

const WebSearchParams = Type.Object({
	query: Type.String({ description: "The search query to use" }),
	allowed_domains: Type.Optional(
		Type.Array(Type.String({ description: "Only include results from this domain" })),
	),
	blocked_domains: Type.Optional(
		Type.Array(Type.String({ description: "Exclude results from this domain" })),
	),
	limit: Type.Optional(
		Type.Number({ description: "Maximum number of results to return. Defaults to 5, max 10." }),
	),
});

type WebSearchArgs = {
	query: string;
	allowed_domains?: string[];
	blocked_domains?: string[];
	limit?: number;
};

type SearchHit = {
	title: string;
	url: string;
	snippet?: string;
	domain?: string;
};

type SearchDetails = {
	query: string;
	results: SearchHit[];
	truncated: boolean;
	provider: "tavily" | "brave";
};

type TavilyCredential = { apiKey: string; slot: number };
type ProviderResolution =
	| { provider: "tavily"; credentials: TavilyCredential[] }
	| { provider: "brave"; apiKey: string };

let tavilyRoundRobinIndex = 0;

function normalizeLimit(limit: number | undefined): number {
	if (limit == null || Number.isNaN(limit)) {
		return 5;
	}
	return Math.max(1, Math.min(MAX_RESULTS, Math.floor(limit)));
}

function normalizeDomains(input: string[] | undefined): string[] | undefined {
	const values = input?.map((item) => item.trim()).filter(Boolean);
	return values?.length ? values : undefined;
}

function ensureValidInput(args: WebSearchArgs) {
	const query = args.query?.trim();
	if (!query) {
		throw new Error("query is required");
	}
	if (normalizeDomains(args.allowed_domains)?.length && normalizeDomains(args.blocked_domains)?.length) {
		throw new Error("allowed_domains and blocked_domains cannot both be set");
	}
}

function getTavilyCredentials(): TavilyCredential[] {
	const multi = process.env.TAVILY_API_KEYS;
	const single = process.env.TAVILY_API_KEY;
	const rawValues = [multi, single]
		.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
		.flatMap((value) => value.split(/[\n,]+/))
		.map((value) => value.trim())
		.filter(Boolean);

	return Array.from(new Set(rawValues)).map((apiKey, index) => ({ apiKey, slot: index }));
}

function resolveProvider(): ProviderResolution {
	const forced = process.env.PI_WEBSEARCH_PROVIDER?.trim().toLowerCase();
	const tavilyCredentials = getTavilyCredentials();
	const braveKey = process.env.BRAVE_API_KEY?.trim();

	if (forced === "tavily") {
		if (tavilyCredentials.length === 0) {
			throw new Error("PI_WEBSEARCH_PROVIDER=tavily but no Tavily API keys are configured");
		}
		return { provider: "tavily", credentials: tavilyCredentials };
	}

	if (forced === "brave") {
		if (!braveKey) throw new Error("PI_WEBSEARCH_PROVIDER=brave but BRAVE_API_KEY is missing");
		return { provider: "brave", apiKey: braveKey };
	}

	if (tavilyCredentials.length > 0) return { provider: "tavily", credentials: tavilyCredentials };
	if (braveKey) return { provider: "brave", apiKey: braveKey };

	throw new Error("No web search provider configured. Set TAVILY_API_KEYS/TAVILY_API_KEY or BRAVE_API_KEY.");
}

function withDomainFilters(query: string, allowed?: string[], blocked?: string[]): string {
	const allowClause = allowed?.length ? `(${allowed.map((domain) => `site:${domain}`).join(" OR ")}) ` : "";
	const blockClause = blocked?.length ? `${blocked.map((domain) => `-site:${domain}`).join(" ")} ` : "";
	return `${allowClause}${blockClause}${query}`.trim();
}

function extractDomain(url: string): string | undefined {
	try {
		return new URL(url).hostname;
	} catch {
		return undefined;
	}
}

function formatResults(details: SearchDetails): string {
	const header = `Web search results for "${details.query}" via ${details.provider}`;
	if (details.results.length === 0) {
		return `${header}\n\nNo results found.`;
	}

	const lines = details.results.map((result, index) => {
		const snippet = result.snippet ? `\n   ${result.snippet}` : "";
		const domain = result.domain ? ` (${result.domain})` : "";
		return `${index + 1}. ${result.title}${domain}\n   ${result.url}${snippet}`;
	});

	return `${header}\n\n${lines.join("\n\n")}`;
}

async function searchWithTavily(args: WebSearchArgs, apiKey: string, signal?: AbortSignal): Promise<SearchDetails> {
	const endpoint = process.env.PI_WEBSEARCH_TAVILY_ENDPOINT?.trim() || "https://api.tavily.com/search";
	const limit = normalizeLimit(args.limit);
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			query: args.query,
			max_results: limit,
			search_depth: "basic",
			include_answer: false,
			include_domains: normalizeDomains(args.allowed_domains),
			exclude_domains: normalizeDomains(args.blocked_domains),
		}),
		signal,
	});

	if (!response.ok) {
		throw new Error(`Tavily search failed: ${response.status}`);
	}

	const body = (await response.json()) as {
		results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
	};

	const results = (body.results ?? [])
		.map((hit) => {
			if (typeof hit.title !== "string" || typeof hit.url !== "string") return null;
			const url = hit.url;
			return {
				title: hit.title,
				url,
				snippet: typeof hit.content === "string" ? hit.content : undefined,
				domain: extractDomain(url),
			} satisfies SearchHit;
		})
		.filter((hit): hit is SearchHit => hit != null);

	return {
		query: args.query,
		results,
		truncated: results.length >= limit,
		provider: "tavily",
	};
}

function isRetryableTavilyStatus(status: number): boolean {
	return status === 401 || status === 402 || status === 403 || status === 429 || status >= 500;
}

async function searchWithTavilyPool(
	args: WebSearchArgs,
	credentials: TavilyCredential[],
	signal?: AbortSignal,
): Promise<SearchDetails> {
	if (credentials.length === 0) {
		throw new Error("No Tavily API keys configured");
	}

	const startIndex = tavilyRoundRobinIndex % credentials.length;
	let lastError: unknown;

	for (let attempt = 0; attempt < credentials.length; attempt += 1) {
		const index = (startIndex + attempt) % credentials.length;
		const credential = credentials[index];
		try {
			const details = await searchWithTavily(args, credential.apiKey, signal);
			tavilyRoundRobinIndex = (index + 1) % credentials.length;
			return details;
		} catch (error) {
			lastError = error;
			const message = error instanceof Error ? error.message : String(error);
			const statusMatch = message.match(/Tavily search failed: (\d+)/);
			const status = statusMatch ? Number(statusMatch[1]) : undefined;
			if (status == null || !isRetryableTavilyStatus(status) || attempt === credentials.length - 1) {
				throw error;
			}
		}
	}

	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function searchWithBrave(args: WebSearchArgs, apiKey: string, signal?: AbortSignal): Promise<SearchDetails> {
	const endpoint = process.env.PI_WEBSEARCH_BRAVE_ENDPOINT?.trim() || "https://api.search.brave.com/res/v1/web/search";
	const limit = normalizeLimit(args.limit);
	const url = new URL(endpoint);
	url.searchParams.set("q", withDomainFilters(args.query, normalizeDomains(args.allowed_domains), normalizeDomains(args.blocked_domains)));
	url.searchParams.set("count", String(limit));

	const response = await fetch(url, {
		headers: {
			Accept: "application/json",
			"X-Subscription-Token": apiKey,
		},
		signal,
	});

	if (!response.ok) {
		throw new Error(`Brave search failed: ${response.status}`);
	}

	const body = (await response.json()) as {
		web?: {
			results?: Array<{ title?: unknown; url?: unknown; description?: unknown }>;
		};
	};

	const results = (body.web?.results ?? [])
		.map((hit) => {
			if (typeof hit.title !== "string" || typeof hit.url !== "string") return null;
			const url = hit.url;
			return {
				title: hit.title,
				url,
				snippet: typeof hit.description === "string" ? hit.description : undefined,
				domain: extractDomain(url),
			} satisfies SearchHit;
		})
		.filter((hit): hit is SearchHit => hit != null);

	return {
		query: args.query,
		results,
		truncated: results.length >= limit,
		provider: "brave",
	};
}

export default function websearchExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "websearch",
		label: "WebSearch",
		description: "Search the web for current public information when you do not already know the target URL.",
		parameters: WebSearchParams,
		async execute(_toolCallId, params, signal) {
			const args = params as WebSearchArgs;
			ensureValidInput(args);

			const resolved = resolveProvider();
			const details =
				resolved.provider === "tavily"
					? await searchWithTavilyPool(args, resolved.credentials, signal)
					: await searchWithBrave(args, resolved.apiKey, signal);

			return {
				content: [{ type: "text", text: formatResults(details) }],
				details,
			};
		},
	});
}
