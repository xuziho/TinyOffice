import type { AgentMessage, ContentBlock, HarnessPolicy } from "./types.ts";

export function normalizeMessagesForSummary(
	messages: AgentMessage[],
	policy: HarnessPolicy,
): { messages: AgentMessage[]; downgradedBlocks: number } {
	if (!policy.mediaDowngradeEnabled) return { messages, downgradedBlocks: 0 };
	let downgradedBlocks = 0;
	const normalized = messages.map((message) => {
		const content = message.content;
		if (!Array.isArray(content)) return message;
		const nextContent = (content as ContentBlock[]).map((block) => {
			const marker = mediaMarker(block);
			if (!marker) return block;
			downgradedBlocks += 1;
			return { type: "text", text: marker };
		});
		return { ...message, content: nextContent };
	});
	return { messages: normalized, downgradedBlocks };
}

function mediaMarker(block: ContentBlock): string | undefined {
	if (!block || typeof block !== "object") return undefined;
	const record = block as Record<string, unknown>;
	const type = typeof record.type === "string" ? record.type : "unknown";
	if (type === "text" || type === "toolCall" || type === "thinking") return undefined;
	if (!isMediaLike(type, record)) return undefined;
	const fields = [
		`type=${type}`,
		stringField(record, "name"),
		stringField(record, "filename"),
		stringField(record, "mimeType"),
		stringField(record, "mediaType"),
		stringField(record, "path"),
		stringField(record, "url"),
		numberField(record, "size"),
		numberField(record, "bytes"),
	].filter(Boolean);
	return `[non-text attachment downgraded for compaction: ${fields.join(" ")}]`;
}

function isMediaLike(type: string, record: Record<string, unknown>): boolean {
	return (
		type === "image" ||
		type === "file" ||
		type === "attachment" ||
		type === "document" ||
		type === "audio" ||
		type === "video" ||
		typeof record.mimeType === "string" ||
		typeof record.mediaType === "string" ||
		typeof record.data === "string" ||
		typeof record.base64 === "string"
	);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? `${key}=${value.trim()}` : undefined;
}

function numberField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? `${key}=${value}` : undefined;
}
