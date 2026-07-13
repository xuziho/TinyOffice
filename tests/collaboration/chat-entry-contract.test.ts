import assert from "node:assert/strict";
import test from "node:test";

import {
  assertChatEntryContractBoundary,
  CHAT_ENTRY_CONTRACT_VERSION,
  PUBLIC_CHAT_ENTRY_DTO_KEY_SETS,
  type ChatContainerDto,
  type ChatChannelMemberDto,
  type ChatEntryDto,
} from "../../src/collaboration/contracts/chat-entry-contract.js";
import { FORBIDDEN_PUBLIC_CARRIER_FIELD_NAMES } from "../../src/collaboration/contracts/conversation-message-contract.js";

test("chat entry DTO keys expose containers and entries with TinyOffice vocabulary only", () => {
  const forbidden = new Set<string>(FORBIDDEN_PUBLIC_CARRIER_FIELD_NAMES);
  const leaks: string[] = [];

  for (const [schemaName, keys] of Object.entries(PUBLIC_CHAT_ENTRY_DTO_KEY_SETS)) {
    for (const key of keys) {
      if (forbidden.has(key)) {
        leaks.push(`${schemaName}.${key}`);
      }
    }
  }

  assert.deepEqual(leaks, []);
  assert.deepEqual(PUBLIC_CHAT_ENTRY_DTO_KEY_SETS.container, [
    "schema",
    "version",
    "companyId",
    "containerId",
    "chatChannelId",
    "kind",
    "title",
    "summary",
    "unreadCount",
    "mentionCount",
    "entryCount",
    "runtimeLinks",
    "members",
  ]);
  assert.deepEqual(PUBLIC_CHAT_ENTRY_DTO_KEY_SETS.channelMember, [
    "schema",
    "version",
    "companyId",
    "chatChannelId",
    "memberId",
    "displayName",
    "hasRuntimeProfile",
    "joinedAt",
  ]);
  assert.deepEqual(PUBLIC_CHAT_ENTRY_DTO_KEY_SETS.entry, [
    "schema",
    "version",
    "companyId",
    "entryId",
    "kind",
    "parentContainerId",
    "title",
    "titleStatus",
    "titleSourceMessageId",
    "summary",
    "unreadCount",
    "mentionCount",
    "openTarget",
    "runtimeLinks",
    "updatedAt",
  ]);
  assert.equal(PUBLIC_CHAT_ENTRY_DTO_KEY_SETS.entry.includes("status"), false);
  assert.equal(PUBLIC_CHAT_ENTRY_DTO_KEY_SETS.entry.includes("lifecycle"), false);
});

test("chat containers are directories and chat entries are concrete open targets", () => {
  const channelContainer: ChatContainerDto = {
    schema: "chat-container",
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId: "company-acme",
    containerId: "chat-container-channel-general",
    chatChannelId: "general",
    kind: "channel",
    title: "General",
    unreadCount: 3,
    mentionCount: 1,
    entryCount: 2,
    runtimeLinks: [],
    members: [{
      schema: "chat-channel-member",
      version: CHAT_ENTRY_CONTRACT_VERSION,
      companyId: "company-acme",
      chatChannelId: "general",
      memberId: "ada",
      displayName: "Ada",
      hasRuntimeProfile: true,
      joinedAt: "2026-06-23T10:20:00.000Z",
    }],
  };
  const dmContainer: ChatContainerDto = {
    ...channelContainer,
    containerId: "chat-container-dm-employee-ada",
    kind: "member_dm",
    title: "Ada",
  };
  const channelTopic: ChatEntryDto = {
    schema: "chat-entry",
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId: "company-acme",
    entryId: "chat-entry-topic-release-plan",
    kind: "channel_topic",
    parentContainerId: channelContainer.containerId,
    title: "Release plan",
    titleStatus: "manual",
    unreadCount: 1,
    mentionCount: 1,
    openTarget: {
      kind: "topic_room",
      roomId: "topic-room-release-plan",
    },
    runtimeLinks: [],
    updatedAt: "2026-06-23T10:20:00.000Z",
  };
  const dmSessionEntry: ChatEntryDto = {
    ...channelTopic,
    entryId: "chat-entry-dm-session-42",
    kind: "dm_session_entry",
    parentContainerId: dmContainer.containerId,
    title: "New DM session",
    titleStatus: "placeholder",
    titleSourceMessageId: "message-42",
    openTarget: {
      kind: "dm_session_entry_room",
      roomId: "dm-session-entry-room-42",
    },
  };

  assertChatEntryContractBoundary(channelContainer);
  assertChatEntryContractBoundary(dmContainer);
  assertChatEntryContractBoundary(channelTopic);
  assertChatEntryContractBoundary(dmSessionEntry);
  assert.notEqual(channelTopic.kind, dmSessionEntry.kind);
  assert.notEqual(channelTopic.openTarget.kind, dmSessionEntry.openTarget.kind);
  assert.throws(
    () =>
      assertChatEntryContractBoundary({
        ...dmSessionEntry,
        openTarget: {
          kind: "topic_room",
          roomId: "topic-room-wrong-shape",
        },
      }),
    /dm_session_entry entries must open dm_session_entry_room targets/,
  );
});

test("chat Channel members are memberId-only public DTOs", () => {
  const channelMember: ChatChannelMemberDto = {
    schema: "chat-channel-member",
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId: "company-acme",
    chatChannelId: "general",
    memberId: "nora-automation",
    displayName: "Nora Automation",
    role: "member",
    hasRuntimeProfile: true,
    joinedAt: "2026-07-04T10:20:00.000Z",
  };

  assertChatEntryContractBoundary(channelMember);
  assert.equal(channelMember.memberId, "nora-automation");
  assert.doesNotMatch(JSON.stringify(channelMember), /\bemployeeId\b/);
  assert.throws(
    () =>
      assertChatEntryContractBoundary({
        ...channelMember,
        memberId: undefined,
        employeeId: "nora-automation",
      }),
    /memberId/,
  );
});

test("chat entry boundary rejects carrier ids and keeps runtime evidence out of identity", () => {
  const entry: ChatEntryDto = {
    schema: "chat-entry",
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId: "company-acme",
    entryId: "chat-entry-topic-release-plan",
    kind: "channel_topic",
    parentContainerId: "chat-container-channel-general",
    title: "Release plan",
    titleStatus: "generated",
    titleSourceMessageId: "message-title-source",
    unreadCount: 0,
    mentionCount: 0,
    openTarget: {
      kind: "topic_room",
      roomId: "topic-room-release-plan",
    },
    runtimeLinks: [
      {
        schema: "chat-runtime-link",
        version: CHAT_ENTRY_CONTRACT_VERSION,
        companyId: "company-acme",
        linkId: "runtime-link-1",
        targetKind: "work_run",
        targetId: "work-run-1",
        label: "Implementation run",
        createdAt: "2026-06-23T10:20:00.000Z",
      },
    ],
    updatedAt: "2026-06-23T10:20:00.000Z",
  };

  assertChatEntryContractBoundary(entry);
  assert.doesNotMatch(JSON.stringify(entry), /\b(sessionId|workRunId|traceId)\b/);
  assert.throws(
    () =>
      assertChatEntryContractBoundary({
        ...entry,
        channelId: "mattermost-channel-id",
      }),
    /forbidden carrier field: channelId/,
  );
});
