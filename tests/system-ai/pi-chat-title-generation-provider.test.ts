import assert from "node:assert/strict";
import test from "node:test";

import { PiChatTitleGenerationProvider } from "../../src/system-ai/pi-chat-title-generation-provider.js";

test("PI chat title provider uses the configured PI model and a no-tools title prompt", async () => {
  const calls: Array<{
    modelProvider: string;
    modelId: string;
    prompt: string;
    tools: string[];
  }> = [];
  const provider = new PiChatTitleGenerationProvider({
    modelRef: "openai-codex/gpt-5.4-mini",
    runPrompt: async (input) => {
      calls.push(input);
      return " \"Website analytics collaboration\"\n";
    },
  });

  const generated = await provider.generateTitle({
    companyId: "acme",
    chatEntryId: "chat-entry-1",
    roomId: "conversation-1",
    currentTitle: "Please create someone to help with website analytics work",
    sourceMessage: {
      messageId: "message-1",
      body: "Please create someone to help with website analytics work",
    },
    actor: {
      actorKind: "company_member",
      memberId: "xuziho",
      displayName: "Xuziho",
    },
  });

  assert.equal(generated.title, "Website analytics collaboration");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.modelProvider, "openai-codex");
  assert.equal(calls[0]?.modelId, "gpt-5.4-mini");
  assert.deepEqual(calls[0]?.tools, []);
  assert.match(calls[0]?.prompt || "", /Only output the title/);
  assert.match(calls[0]?.prompt || "", /Do not explain/);
  assert.match(calls[0]?.prompt || "", /Prefer the same language as the user's message/);
  assert.match(calls[0]?.prompt || "", /Please create someone to help with website analytics work/);
});

test("PI chat title provider fails fast when the configured model ref is invalid", async () => {
  assert.throws(
    () => new PiChatTitleGenerationProvider({
      modelRef: "gpt-5.4-mini",
      runPrompt: async () => "unused",
    }),
    /modelRef must use provider\/model format/,
  );
});
