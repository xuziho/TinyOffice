import type { AgentMessage, ContentBlock } from "./types.ts";
import { isTextContent } from "./text.ts";

export function summarizeMessages(messages: AgentMessage[], maxChars: number): string {
	const chunks: string[] = [];
	for (const message of messages) {
		chunks.push(serializeMessage(message));
		if (chunks.join("\n\n").length >= maxChars) break;
	}
	return truncateMiddle(chunks.join("\n\n"), maxChars);
}

export function serializeMessage(message: AgentMessage): string {
	const role = typeof message.role === "string" ? message.role : "unknown";
	if (role === "toolResult") {
		const toolName = typeof message.toolName === "string" ? message.toolName : "unknown";
		const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : "unknown";
		const content = Array.isArray(message.content) ? serializeContent(message.content as ContentBlock[]) : "";
		return `[toolResult:${toolName}:${toolCallId}]\n${truncateMiddle(content, 2_500)}`;
	}
	if (role === "assistant") {
		const content = Array.isArray(message.content) ? serializeContent(message.content as ContentBlock[]) : "";
		return `[assistant]\n${truncateMiddle(content, 3_500)}`;
	}
	const rawContent = message.content;
	const content =
		typeof rawContent === "string"
			? rawContent
			: Array.isArray(rawContent)
				? serializeContent(rawContent as ContentBlock[])
				: "";
	return `[${role}]\n${truncateMiddle(content, 3_500)}`;
}

export function serializeContent(content: ContentBlock[]): string {
	const lines: string[] = [];
	for (const block of content) {
		if (isTextContent(block)) {
			lines.push(block.text);
			continue;
		}
		if (block?.type === "toolCall") {
			const record = block as Record<string, unknown>;
			lines.push(`[toolCall:${String(record.name ?? "unknown")}:${String(record.id ?? "unknown")}] ${JSON.stringify(record.arguments ?? {})}`);
			continue;
		}
		if (block?.type === "thinking") {
			continue;
		}
		lines.push(`[${String(block?.type ?? "unknown")} content]`);
	}
	return lines.join("\n");
}

export function truncateMiddle(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const head = Math.floor(maxChars * 0.65);
	const tail = Math.max(0, maxChars - head - 80);
	return `${text.slice(0, head).trimEnd()}\n\n[... ${text.length - head - tail} characters omitted ...]\n\n${text.slice(-tail).trimStart()}`;
}
