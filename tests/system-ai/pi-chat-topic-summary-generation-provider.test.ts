import assert from "node:assert/strict";
import test from "node:test";

import { PiChatTopicSummaryGenerationProvider } from "../../src/system-ai/pi-chat-topic-summary-generation-provider.js";

test("PI chat topic summary provider uses the configured PI model and a no-tools summary prompt", async () => {
  const calls: Array<{
    modelProvider: string;
    modelId: string;
    systemPrompt: string;
    prompt: string;
    tools: string[];
  }> = [];
  const provider = new PiChatTopicSummaryGenerationProvider({
    modelRef: "openai-codex/gpt-5.4-mini",
    runPrompt: async (input) => {
      calls.push(input);
      return "  Iris asked Nora to own launch coordination. Nora accepted and will report back.  \n";
    },
  });

  const generated = await provider.generateSummary({
    companyId: "acme",
    topicId: "topic-1",
    roomId: "conversation-1",
    existingSummary: "Earlier summary.",
    sourceMessages: [
      {
        messageId: "message-1",
        senderDisplayName: "Iris",
        body: "Nora, please own the launch checklist.",
        createdAt: "2026-07-02T08:00:00.000Z",
      },
      {
        messageId: "message-2",
        senderDisplayName: "Nora",
        body: "I will draft it and hand it back.",
        createdAt: "2026-07-02T08:01:00.000Z",
      },
    ],
  }, {
    schema: "system-ai-provider-config",
    version: 1,
    companyId: "acme",
    capability: "chat_topic_summary",
    providerKind: "pi_model",
    enabled: true,
    configRef: "pi-model-registry",
    modelRef: "openai-codex/gpt-5.4-mini",
    configVersion: 1,
    createdAt: "2026-07-02T08:00:00.000Z",
    updatedAt: "2026-07-02T08:00:00.000Z",
  });

  assert.equal(generated.summary, "Iris asked Nora to own launch coordination. Nora accepted and will report back.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.modelProvider, "openai-codex");
  assert.equal(calls[0]?.modelId, "gpt-5.4-mini");
  assert.deepEqual(calls[0]?.tools, []);
  assert.match(calls[0]?.systemPrompt || "", /Only output the updated topic summary/);
  assert.doesNotMatch(calls[0]?.prompt || "", /Only output the updated topic summary/);
  assert.match(calls[0]?.prompt || "", /Existing topic summary/);
  assert.match(calls[0]?.prompt || "", /Earlier summary/);
  assert.match(calls[0]?.prompt || "", /Iris/);
  assert.match(calls[0]?.prompt || "", /Nora, please own the launch checklist/);
});

test("PI chat topic summary provider fails fast when the configured model ref is invalid", async () => {
  assert.throws(
    () => new PiChatTopicSummaryGenerationProvider({
      modelRef: "gpt-5.4-mini",
      runPrompt: async () => "unused",
    }),
    /modelRef must use provider\/model format/,
  );
});
