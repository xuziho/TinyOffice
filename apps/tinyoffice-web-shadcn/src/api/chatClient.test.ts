import assert from "node:assert/strict";
import test from "node:test";

import { addChatChannelMembers, archiveChatRoomTopic, createChatChannel, createChatEntry, discardChatImageAttachment, dissolveChatChannel, listChatRoomActivity, markChatRoomRead, removeChatChannelMember, restoreChatRoomTopic, sendChatRoomMessage, updateChatChannelDetails, updateChatRoomTitle, uploadChatImageAttachment } from "./chatClient";

test("createChatEntry posts a first message to the TinyOffice create-entry API", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      schema: "chat-create-entry-result",
      version: 1,
      companyId: "ziho-co",
      firstMessageId: "message-1",
      container: { containerId: "chat-container-channel-general" },
      entry: { entryId: "entry-1", openTarget: { roomId: "room-1" } },
      openTarget: { kind: "topic_room", roomId: "room-1" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await createChatEntry({
      companyId: "ziho-co",
      containerId: "chat-container-channel-general",
      actorMemberId: "xuziho",
      actorDisplayName: "Xu Ziho",
      title: "Need a weekly plan",
      memberDisplayNames: { alex: "Alex" },
      firstMessage: { body: "Need a weekly plan" },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.ok(request.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/entries");
  assert.equal(request.init.method, "POST");
  assert.equal((request.init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    containerId: "chat-container-channel-general",
    actorMemberId: "xuziho",
    actorDisplayName: "Xu Ziho",
    title: "Need a weekly plan",
    memberDisplayNames: { alex: "Alex" },
    firstMessage: { body: "Need a weekly plan" },
  });
});

test("markChatRoomRead posts viewer identity to the TinyOffice read-state API", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      schema: "chat-read-state-result",
      version: 1,
      companyId: "ziho-co",
      roomId: "room-1",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await markChatRoomRead({
      companyId: "ziho-co",
      roomId: "room-1",
      memberId: "xuziho",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.ok(request.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/rooms/room-1/read");
  assert.equal(request.init.method, "POST");
  assert.equal((request.init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    viewerMemberId: "xuziho",
  });
});

test("listChatRoomActivity can request Activity for one source message", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await listChatRoomActivity({
      companyId: "ziho-co",
      roomId: "room-1",
      memberId: "xuziho",
      sourceMessageId: "message-source-1",
      limit: 500,
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.url,
    "http://127.0.0.1:5175/api/companies/ziho-co/chat/rooms/room-1/activity?viewerMemberId=xuziho&sourceMessageId=message-source-1&limit=500",
  );
});

test("listChatRoomActivity can request Activity for one process trace", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await listChatRoomActivity({
      companyId: "ziho-co",
      roomId: "room-1",
      memberId: "xuziho",
      processTraceId: "trace-reply-1",
      limit: 500,
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.url,
    "http://127.0.0.1:5175/api/companies/ziho-co/chat/rooms/room-1/activity?viewerMemberId=xuziho&processTraceId=trace-reply-1&limit=500",
  );
});

test("sendChatRoomMessage posts a real room reply to the TinyOffice message API", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      schema: "chat-send-message-result",
      version: 1,
      companyId: "ziho-co",
      roomId: "room-1",
      message: {
        schema: "message",
        version: 1,
        companyId: "ziho-co",
        conversationId: "room-1",
        messageId: "message-2",
        sender: { participantId: "xuziho", participantKind: "company_member", memberId: "xuziho", displayName: "Xu Ziho" },
        body: "Let's ship this.",
        mentions: [],
        attachments: [],
        runtimeLinks: [],
        createdAt: "2026-07-01T00:00:00.000Z",
        deliveryState: "sent",
      },
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };

  try {
    await sendChatRoomMessage({
      companyId: "ziho-co",
      roomId: "room-1",
      actorMemberId: "xuziho",
      actorDisplayName: "Xu Ziho",
      body: "Let's ship this.",
      mentionedMemberIds: ["aster"],
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.ok(request.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/rooms/room-1/messages");
  assert.equal(request.init.method, "POST");
  assert.equal((request.init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    actorMemberId: "xuziho",
    actorDisplayName: "Xu Ziho",
    body: "Let's ship this.",
    mentionedMemberIds: ["aster"],
  });
});

test("updateChatRoomTitle persists a manual title through the TinyOffice room title API", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      schema: "conversation",
      version: 1,
      companyId: "ziho-co",
      conversationId: "room-1",
      title: "Website analytics launch",
      titleStatus: "manual",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await updateChatRoomTitle({
      companyId: "ziho-co",
      roomId: "room-1",
      actorMemberId: "xuziho",
      title: "Website analytics launch",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.ok(request.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/rooms/room-1/title");
  assert.equal(request.init.method, "PATCH");
  assert.equal((request.init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    actorMemberId: "xuziho",
    title: "Website analytics launch",
  });
});

test("archiveChatRoomTopic confirms and posts to the TinyOffice room archive API", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      schema: "conversation",
      version: 1,
      companyId: "ziho-co",
      conversationId: "room-1",
      title: "Website analytics launch",
      topic: { status: "archived" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await archiveChatRoomTopic({
      companyId: "ziho-co",
      roomId: "room-1",
      actorMemberId: "xuziho",
      confirmation: "ARCHIVE",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.ok(request.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/rooms/room-1/archive");
  assert.equal(request.init.method, "POST");
  assert.equal((request.init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    actorMemberId: "xuziho",
    confirmation: "ARCHIVE",
  });
});

test("restoreChatRoomTopic confirms and posts to the TinyOffice room restore API", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      schema: "conversation",
      version: 1,
      companyId: "ziho-co",
      conversationId: "room-1",
      title: "Website analytics launch",
      topic: { status: "open" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await restoreChatRoomTopic({
      companyId: "ziho-co",
      roomId: "room-1",
      actorMemberId: "xuziho",
      confirmation: "RESTORE",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.ok(request.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/rooms/room-1/restore");
  assert.equal(request.init.method, "POST");
  assert.equal((request.init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    actorMemberId: "xuziho",
    confirmation: "RESTORE",
  });
});

test("sendChatRoomMessage supports an image-only message with uploaded attachment ids", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ message: { attachments: [] } }), { status: 201, headers: { "Content-Type": "application/json" } });
  };

  try {
    await sendChatRoomMessage({
      companyId: "ziho-co",
      roomId: "room-1",
      actorMemberId: "xuziho",
      body: "",
      attachmentIds: ["att-screen"],
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const request = requests[0];
  assert.ok(request?.init);
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    actorMemberId: "xuziho",
    body: "",
    attachmentIds: ["att-screen"],
  });
});

test("uploadChatImageAttachment posts multipart file to company Chat attachments route", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ attachment: { attachmentId: "att-1" } }), { status: 201, headers: { "Content-Type": "application/json" } });
  };

  try {
    await uploadChatImageAttachment({
      companyId: "ziho-co",
      memberId: "xuziho",
      file: new File([new Uint8Array([1])], "screen.png", { type: "image/png" }),
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const request = requests[0];
  assert.ok(request?.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/attachments?viewerMemberId=xuziho");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body instanceof FormData, true);
});

test("discardChatImageAttachment deletes the uploader's unreferenced attachment", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ discarded: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await discardChatImageAttachment({ companyId: "ziho-co", memberId: "xuziho", attachmentId: "att-1" });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/attachments/att-1?viewerMemberId=xuziho");
  assert.equal(requests[0]?.init?.method, "DELETE");
});

test("updateChatChannelDetails patches Channel title and summary", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      companyId: "ziho-co",
      chatChannelId: "channel-general",
      title: "Launch room",
      summary: "Coordinate launch work.",
      members: [],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await updateChatChannelDetails({
      companyId: "ziho-co",
      chatChannelId: "channel-general",
      actorMemberId: "xuziho",
      title: "Launch room",
      summary: "Coordinate launch work.",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.ok(request.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/channels/channel-general");
  assert.equal(request.init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    actorMemberId: "xuziho",
    title: "Launch room",
    summary: "Coordinate launch work.",
  });
});

test("createChatChannel posts Channel details and selected members", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ companyId: "ziho-co", chatChannelId: "channel-launch", title: "Launch room", members: [], createdAt: "", updatedAt: "" }), { status: 201, headers: { "Content-Type": "application/json" } });
  };

  try {
    await createChatChannel({
      companyId: "ziho-co",
      actorMemberId: "xuziho",
      actorDisplayName: "Xuziho",
      title: "Launch room",
      summary: "Coordinate launch work.",
      members: [{ memberId: "mira-hr", displayName: "Mira HR", hasRuntimeProfile: true }],
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const request = requests[0];
  assert.ok(request?.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/channels");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    actorMemberId: "xuziho",
    actorDisplayName: "Xuziho",
    title: "Launch room",
    summary: "Coordinate launch work.",
    members: [{ memberId: "mira-hr", displayName: "Mira HR", hasRuntimeProfile: true }],
  });
});

test("addChatChannelMembers posts selected members to Channel membership API", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ companyId: "ziho-co", chatChannelId: "channel-general", title: "General", members: [], createdAt: "", updatedAt: "" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await addChatChannelMembers({
      companyId: "ziho-co",
      chatChannelId: "channel-general",
      actorMemberId: "xuziho",
      members: [{ memberId: "mira-hr", displayName: "Mira HR", hasRuntimeProfile: true }],
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const request = requests[0];
  assert.ok(request?.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/channels/channel-general/members");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    actorMemberId: "xuziho",
    members: [{ memberId: "mira-hr", displayName: "Mira HR", hasRuntimeProfile: true }],
  });
});

test("removeChatChannelMember sends the exact selected Channel member identity", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ companyId: "ziho-co", chatChannelId: "channel-general", title: "General", members: [], createdAt: "", updatedAt: "" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await removeChatChannelMember({
      companyId: "ziho-co",
      chatChannelId: "channel-general",
      actorMemberId: "xuziho",
      member: { memberId: "mira-hr" },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const request = requests[0];
  assert.ok(request?.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/channels/channel-general/members");
  assert.equal(request.init.method, "DELETE");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    actorMemberId: "xuziho",
    member: { memberId: "mira-hr" },
  });
});

test("dissolveChatChannel sends DELETE confirmation to the Channel API", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ companyId: "ziho-co", chatChannelId: "channel-general", dissolved: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await dissolveChatChannel({
      companyId: "ziho-co",
      chatChannelId: "channel-general",
      actorMemberId: "xuziho",
      confirmation: "DELETE",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const request = requests[0];
  assert.ok(request?.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/chat/channels/channel-general");
  assert.equal(request.init.method, "DELETE");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    actorMemberId: "xuziho",
    confirmation: "DELETE",
  });
});
