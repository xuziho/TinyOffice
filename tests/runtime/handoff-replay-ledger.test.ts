import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  HandoffReplayLedger,
  buildHandoffReplayKey,
} from "../../src/runtime/realtime/handoff-replay-ledger.js";
import { createCompany } from "../../src/runtime/company-config/companies-admin.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import type { HandoffResult } from "../../src/runtime/pi/read-collaboration-tool-call-log.js";
import { resetRuntimePostgresTables, waitForRuntimePostgresCleanup } from "./postgres-test-utils.js";

after(waitForRuntimePostgresCleanup);

function testCall(overrides: Partial<HandoffResult> = {}): HandoffResult {
  return {
    timestamp: "2026-06-04T01:00:00.000Z",
    channelTopicId: "channel-topic-1",
    threadId: "thread-1",
    recipientParticipantId: "iris-growth",
    targetMemberId: "iris-growth",
    message: "Please take the next step.",
    ...overrides,
  };
}

test("HandoffReplayLedger persists emitted calls so they are skipped after reload", async () => {
  await resetRuntimePostgresTables();
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-handoff-ledger-"),
  );
  const handoff = testCall();
  const key = buildHandoffReplayKey({
    senderMemberId: "nora-automation",
    handoff,
  });

  const firstLedger = await HandoffReplayLedger.load(repoRoot, DEFAULT_COMPANY_ID);
  try {
    assert.equal(firstLedger.has(key), false);

    await firstLedger.mark({
      key,
      resolution: "emitted",
      senderMemberId: "nora-automation",
      handoff,
    });
  } finally {
    firstLedger.close();
  }

  const secondLedger = await HandoffReplayLedger.load(repoRoot, DEFAULT_COMPANY_ID);
  try {
    assert.equal(secondLedger.has(key), true);
  } finally {
    secondLedger.close();
  }
});

test("HandoffReplayLedger isolates identical replay keys by company", async () => {
  await resetRuntimePostgresTables();
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-handoff-ledger-company-"),
  );
  const otherCompanyId = "support-handoff-ledger";
  await createCompany({ repoRoot, companyId: otherCompanyId, displayName: "Support Handoff Ledger" });
  const handoff = testCall();
  const key = buildHandoffReplayKey({
    senderMemberId: "nora-automation",
    handoff,
  });

  const defaultLedger = await HandoffReplayLedger.load(repoRoot, DEFAULT_COMPANY_ID);
  const otherLedger = await HandoffReplayLedger.load(repoRoot, otherCompanyId);
  try {
    await defaultLedger.mark({
      key,
      resolution: "emitted",
      senderMemberId: "nora-automation",
      handoff,
    });

    assert.equal(defaultLedger.has(key), true);
    assert.equal(otherLedger.has(key), false);
  } finally {
    defaultLedger.close();
    otherLedger.close();
  }
});

test("buildHandoffReplayKey changes when the call content changes", () => {
  const firstKey = buildHandoffReplayKey({
    senderMemberId: "nora-automation",
    handoff: testCall(),
  });
  const secondKey = buildHandoffReplayKey({
    senderMemberId: "nora-automation",
    handoff: testCall({ message: "Different message." }),
  });

  assert.notEqual(firstKey, secondKey);
});

test("buildHandoffReplayKey uses owned room action identity before legacy thread id", () => {
  const ownedCall = testCall({
    channelTopicId: "channel-topic-owned-room",
    threadId: "legacy-thread-a",
    chatEntryId: "chat-entry-channel-topic-launch",
    conversationId: "conversation-launch-room",
    roomId: "conversation-launch-room",
    actionId: "handoff-action-1",
  });
  const legacyThreadChanged = testCall({
    ...ownedCall,
    threadId: "legacy-thread-b",
  });

  const firstKey = buildHandoffReplayKey({
    senderMemberId: "nora-automation",
    handoff: ownedCall,
  });
  const secondKey = buildHandoffReplayKey({
    senderMemberId: "nora-automation",
    handoff: legacyThreadChanged,
  });

  assert.equal(firstKey, secondKey);
});

test("buildHandoffReplayKey uses owned room identity before legacy thread id without action id", () => {
  const ownedCall = testCall({
    channelTopicId: "channel-topic-owned-room",
    threadId: "legacy-thread-a",
    chatEntryId: "chat-entry-channel-topic-launch",
    conversationId: "conversation-launch-room",
    roomId: "conversation-launch-room",
  });
  const legacyThreadChanged = testCall({
    ...ownedCall,
    threadId: "legacy-thread-b",
  });

  const firstKey = buildHandoffReplayKey({
    senderMemberId: "nora-automation",
    handoff: ownedCall,
  });
  const secondKey = buildHandoffReplayKey({
    senderMemberId: "nora-automation",
    handoff: legacyThreadChanged,
  });

  assert.equal(firstKey, secondKey);
});
