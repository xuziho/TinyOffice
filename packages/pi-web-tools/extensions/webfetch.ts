import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fetch } from "undici";
import { Type } from "typebox";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const MAX_REDIRECTS = 5;

const WebFetchParams = Type.Object({
	url: Type.String({ description: "The URL to fetch content from" }),
	format: Type.Optional(
		Type.Union(
			[Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")],
			{ description: "Return format. Defaults to markdown." },
		),
	),
	timeout_seconds: Type.Optional(
		Type.Number({ description: "Timeout in seconds. Defaults to 30. Maximum 120." }),
	),
});

type WebFetchArgs = {
	url: string;
	format?: "markdown" | "text" | "html";
	timeout_seconds?: number;
};

type WebFetchDetails = {
	url: string;
	finalUrl?: string;
	statusCode?: number;
	contentType?: string;
	format: "markdown" | "text" | "html";
	truncated: boolean;
	sizeBytes: number;
	redirected: boolean;
};

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
	bulletListMarker: "-",
});
turndown.remove(["script", "style", "noscript", "meta", "link"]);

function normalizeFormat(value: WebFetchArgs["format"]): "markdown" | "text" | "html" {
	return value ?? "markdown";
}

function normalizeTimeoutSeconds(value: number | undefined): number {
	if (value == null || Number.isNaN(value)) {
		return DEFAULT_TIMEOUT_SECONDS;
	}
	return Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, Math.floor(value)));
}

function requireHttpUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`Invalid URL: ${raw}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("URL must start with http:// or https://");
	}
	return url;
}

function getContentType(headers: Headers): string {
	return (headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function isHtmlContentType(contentType: string): boolean {
	return contentType === "text/html" || contentType === "application/xhtml+xml";
}

function isTextLikeContentType(contentType: string): boolean {
	return (
		contentType.startsWith("text/") ||
		contentType === "application/json" ||
		contentType === "application/xml" ||
		contentType.endsWith("+json") ||
		contentType.endsWith("+xml")
	);
}

function toMarkdownFromHtml(html: string, sourceUrl: string): string {
	const { document } = parseHTML(html);
	const reader = new Readability(document, { keepClasses: false });
	const article = reader.parse();
	if (article?.content) {
		const contentDoc = parseHTML(article.content).document;
		const bodyHtml = contentDoc.body?.innerHTML || article.content;
		const markdown = turndown.turndown(bodyHtml).trim();
		if (markdown.length > 0) {
			const title = article.title?.trim();
			return title ? `# ${title}\n\n${markdown}` : markdown;
		}
	}

	const fallbackMarkdown = turndown.turndown(document.body?.innerHTML || html).trim();
	if (fallbackMarkdown.length > 0) {
		return fallbackMarkdown;
	}

	return `[No readable content extracted from ${sourceUrl}]`;
}

function toPlainTextFromHtml(html: string): string {
	const { document } = parseHTML(html);
	for (const tag of ["script", "style", "noscript"]) {
		for (const node of Array.from(document.querySelectorAll(tag))) {
			node.remove();
		}
	}
	return (document.body?.textContent || document.textContent || "").replace(/\s+\n/g, "\n").trim();
}

async function fetchWithRedirectPolicy(url: URL, timeoutSeconds: number, signal?: AbortSignal) {
	let currentUrl = url;
	let redirects = 0;

	while (true) {
		const timeoutSignal = AbortSignal.timeout(timeoutSeconds * 1000);
		const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
		const response = await fetch(currentUrl, {
			method: "GET",
			headers: {
				"User-Agent": "pi-webfetch",
				"Accept": "text/html, text/plain, application/xhtml+xml, application/json;q=0.9, */*;q=0.1",
			},
			redirect: "manual",
			signal: combinedSignal,
		});

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			if (!location) {
				throw new Error(`Redirect response missing location header (${response.status})`);
			}

			const redirectUrl = new URL(location, currentUrl);
			if (redirectUrl.hostname !== currentUrl.hostname) {
				return {
					type: "redirect" as const,
					originalUrl: currentUrl.toString(),
					redirectUrl: redirectUrl.toString(),
					statusCode: response.status,
				};
			}

			redirects += 1;
			if (redirects > MAX_REDIRECTS) {
				throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
			}

			currentUrl = redirectUrl;
			continue;
		}

		return {
			type: "response" as const,
			response,
			finalUrl: currentUrl.toString(),
			redirected: redirects > 0,
		};
	}
}

function buildRedirectMessage(
	result: { originalUrl: string; redirectUrl: string; statusCode: number },
	format: "markdown" | "text" | "html",
) {
	return {
		text:
			`Redirect detected to a different host.\n\n` +
			`Original URL: ${result.originalUrl}\n` +
			`Redirect URL: ${result.redirectUrl}\n` +
			`Status: ${result.statusCode}\n\n` +
			`To continue, call webfetch again with the redirected URL and the same format (${format}).`,
		details: {
			url: result.originalUrl,
			finalUrl: result.redirectUrl,
			statusCode: result.statusCode,
			format,
			contentType: "redirect",
			truncated: false,
			sizeBytes: 0,
			redirected: true,
		} satisfies WebFetchDetails,
	};
}

export default function webfetchExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "webfetch",
		label: "WebFetch",
		description: "Fetch content from a known public URL and return markdown, text, or raw HTML.",
		parameters: WebFetchParams,
		async execute(_toolCallId, params, signal) {
			const args = params as WebFetchArgs;
			const parsedUrl = requireHttpUrl(args.url);
			const format = normalizeFormat(args.format);
			const timeoutSeconds = normalizeTimeoutSeconds(args.timeout_seconds);

			const fetched = await fetchWithRedirectPolicy(parsedUrl, timeoutSeconds, signal);
			if (fetched.type === "redirect") {
				const redirect = buildRedirectMessage(fetched, format);
				return {
					content: [{ type: "text", text: redirect.text }],
					details: redirect.details,
				};
			}

			const { response, finalUrl, redirected } = fetched;
			const contentLength = response.headers.get("content-length");
			if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE) {
				throw new Error(`Response too large (exceeds ${MAX_RESPONSE_SIZE} bytes)`);
			}

			const body = Buffer.from(await response.arrayBuffer());
			if (body.byteLength > MAX_RESPONSE_SIZE) {
				throw new Error(`Response too large (exceeds ${MAX_RESPONSE_SIZE} bytes)`);
			}

			const contentType = getContentType(response.headers);
			if (!contentType || (!isHtmlContentType(contentType) && !isTextLikeContentType(contentType))) {
				throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
			}

			const rawText = body.toString("utf8");
			let resultText = rawText;
			if (format === "markdown" && isHtmlContentType(contentType)) {
				resultText = toMarkdownFromHtml(rawText, finalUrl);
			} else if (format === "text" && isHtmlContentType(contentType)) {
				resultText = toPlainTextFromHtml(rawText);
			}

			return {
				content: [{ type: "text", text: resultText }],
				details: {
					url: parsedUrl.toString(),
					finalUrl,
					statusCode: response.status,
					contentType,
					format,
					truncated: false,
					sizeBytes: body.byteLength,
					redirected,
				} satisfies WebFetchDetails,
			};
		},
	});
}
