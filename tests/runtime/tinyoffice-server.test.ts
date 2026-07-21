import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import {
  createRuntimeProcessTracePublisher,
} from "../../src/runtime/realtime/tinyoffice-server.js";
import { drainProcessTraceWriters, listProcessTraceEvents } from "../../src/runtime/realtime/process-trace-store.js";
import { defaultRuntimePostgresTestDatabaseUrl, resetRuntimePostgresTables } from "./postgres-test-utils.js";

test("TinyOffice runtime server mounts authenticated Chat and company directory APIs", async () => {
  const source = await readFile("src/runtime/realtime/tinyoffice-server.ts", "utf8");
  const gatewaySource = await readFile("src/runtime/realtime/tinyoffice-realtime-gateway.ts", "utf8");

  assert.match(source, /createTinyOfficeApi/);
  assert.match(source, /handleTinyOfficeApiRequest/);
  assert.match(source, /attachTinyOfficeRealtimeGateway/);
  assert.match(gatewaySource, /socket\.io/);
  assert.match(gatewaySource, /\/api\/realtime\/socket\.io/);
  assert.doesNotMatch(gatewaySource, /Sec-WebSocket-Accept|new WebSocket|\/api\/realtime\/ws/);
  assert.match(source, /createPostgresCompanyDirectoryApiSource/);
  assert.match(source, /createRuntimeProcessTracePublisher/);
  assert.match(source, /processTrace:\s*createRuntimeProcessTracePublisher/);
  assert.match(source, /processTraceId:\s*input\.processTraceId/);
  assert.doesNotMatch(source, /handleConversationApiRequest/);
  assert.doesNotMatch(source, /handleChatProjectionApiRequest/);
  assert.doesNotMatch(source, /handleCompanyDirectoryApiRequest/);
  assert.doesNotMatch(source, /from "\.\/conversation-api-routes\.js"/);
  assert.doesNotMatch(source, /text\/event-stream|EventSource|\/conversations\/[^"`']+\/events/);
  await assert.rejects(
    access("src/runtime/realtime/conversation-api-routes.ts", constants.F_OK),
    /ENOENT/,
  );
});

test("TinyOffice runtime uses formal Owner authentication without identity variables", async () => {
  const source = await readFile("scripts/runtime/run-tinyoffice.ts", "utf8");

  assert.match(source, /publicOrigin/);
  assert.match(source, /bootstrapToken/);
  assert.doesNotMatch(source, /previewUserId|previewUserDisplayName/);
  assert.doesNotMatch(source, /nora-automation/);
  assert.doesNotMatch(source, /xuziho/);
  assert.doesNotMatch(source, /actorEmployeeId/);
});

test("TinyOffice runtime wires admin reload controls to the same PI Runtime Provider used for replies", async () => {
  const source = await readFile("scripts/runtime/run-tinyoffice.ts", "utf8");

  assert.match(source, /defaultRuntimeProvider/);
  assert.match(source, /runtimeProvider:\s*defaultRuntimeProvider/);
});

test("TinyOffice runtime closes runtime and session state around Company deletion", async () => {
  const source = await readFile("src/runtime/realtime/tinyoffice-server.ts", "utf8");

  assert.doesNotMatch(source, /Cannot delete the active runtime Company/);
  assert.doesNotMatch(source, /scopedCompanyId === companyId/);
  assert.match(source, /deletionGuard/);
  assert.match(source, /session\.companyId === companyId/);
  assert.match(source, /saveUserPreferredCompanyId/);
  assert.match(source, /loadUserPreferredCompanyId/);
  assert.match(source, /loadCurrentUserMemberSession\(repoRoot, session, session\.currentCompanyId\)/);
  assert.doesNotMatch(source, /loadCurrentUserMemberSession\(repoRoot, session\)\s*\?\?/);
  assert.doesNotMatch(source, /WHERE member\.id = \$1\s*ORDER BY member\.company_id ASC/);
});

test("TinyOffice runtime starts a Work control-plane loop for queued WorkRuns", async () => {
  const source = await readFile("src/runtime/realtime/tinyoffice-server.ts", "utf8");

  assert.match(source, /CompanyControlPlane/);
  assert.match(source, /startRuntimeWorkControlPlaneLoop/);
  assert.match(source, /runOnce\(/);
  assert.match(source, /stopWorkControlPlaneLoop/);
});

test("real Chat runtime process trace publisher persists stable trace ids", async () => {
  const previousDatabaseUrl = process.env.TINYOFFICE_DATABASE_URL;
  process.env.TINYOFFICE_DATABASE_URL =
    process.env.TINYOFFICE_TEST_DATABASE_URL?.trim() || defaultRuntimePostgresTestDatabaseUrl;
  await resetRuntimePostgresTables();
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-runtime-process-trace-"));
  try {
    const publisher = createRuntimeProcessTracePublisher(repoRoot, DEFAULT_COMPANY_ID);

    await publisher.publishProcessTraceEvent({
      id: "tinyoffice-chat-process:nora-automation|chat_direct_room|conversation-preview:message-preview:delta",
      timestamp: "2026-06-24T04:40:00.000Z",
      kind: "model_text_delta",
      sessionKey: "nora-automation|chat_direct_room|conversation-preview",
      employeeId: "nora-automation",
      title: "nora-automation drafted a reply",
      summary: "Action list:",
      status: "running",
      metadata: {
        companyId: DEFAULT_COMPANY_ID,
        conversationId: "conversation-preview",
        messageId: "message-preview",
        chatEntryId: "entry-preview",
        sequenceInRun: 1,
      },
    });
    await drainProcessTraceWriters(repoRoot);

    const events = await listProcessTraceEvents(repoRoot, DEFAULT_COMPANY_ID, {
      processTraceId: "tinyoffice-chat-process:nora-automation|chat_direct_room|conversation-preview:message-preview:delta",
      conversationId: "conversation-preview",
      messageId: "message-preview",
      chatEntryId: "entry-preview",
    });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.id, "tinyoffice-chat-process:nora-automation|chat_direct_room|conversation-preview:message-preview:delta");
    assert.equal(events[0]?.kind, "model_text_delta");
    assert.equal(events[0]?.metadata?.sequenceInRun, 1);
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.TINYOFFICE_DATABASE_URL;
    } else {
      process.env.TINYOFFICE_DATABASE_URL = previousDatabaseUrl;
    }
  }
});
