import { Buffer } from "node:buffer";
import type { ContentBlock, TextContent } from "./types.ts";

export function isTextContent(block: ContentBlock): block is TextContent {
	return block?.type === "text" && typeof (block as { text?: unknown }).text === "string";
}

export function extractModelText(content: ContentBlock[]): string {
	const chunks: string[] = [];
	for (const block of content) {
		if (isTextContent(block)) {
			chunks.push(block.text);
			continue;
		}
		if (block?.type === "image") {
			chunks.push("[image omitted from tool result text estimate]");
			continue;
		}
		chunks.push(`[${String(block?.type ?? "unknown")} content omitted from tool result text estimate]`);
	}
	return chunks.join("\n");
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function utf8Bytes(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

export function previewText(text: string, headChars: number, tailChars: number): string {
	if (text.length <= headChars + tailChars + 128) return text;
	const head = text.slice(0, headChars).trimEnd();
	const tail = text.slice(-tailChars).trimStart();
	const omitted = text.length - head.length - tail.length;
	return `${head}\n\n[... ${omitted.toLocaleString()} characters omitted ...]\n\n${tail}`;
}
