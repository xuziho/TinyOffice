import assert from "node:assert/strict";
import test from "node:test";

import {
  ChannelPermissionDeniedError,
  ChannelService,
  InMemoryChannelRepository,
} from "../../src/collaboration/channel/channel-service.js";

async function seededService(options: ConstructorParameters<typeof ChannelService>[1] = {}) {
  const repository = new InMemoryChannelRepository();
  const service = new ChannelService(repository, options);
  const channel = await service.createChannel({
    companyId: "acme",
    title: "Ops",
    actor: {
      participantKind: "company_member",
      memberId: "xuziho",
      displayName: "Xu",
    },
    members: [{
      memberId: "nora-automation",
      displayName: "Nora",
      hasRuntimeProfile: true,
    }, {
      memberId: "iris-growth",
      displayName: "Iris",
      hasRuntimeProfile: true,
    }],
  });
  return { service, channel };
}

test("ChannelService creates a participant-only Channel membership", async () => {
  const { channel } = await seededService();

  assert.deepEqual(
    channel.members.map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      hasRuntimeProfile: member.hasRuntimeProfile,
      role: "role" in member,
    })),
    [
      { memberId: "xuziho", displayName: "Xu", hasRuntimeProfile: false, role: false },
      { memberId: "nora-automation", displayName: "Nora", hasRuntimeProfile: true, role: false },
      { memberId: "iris-growth", displayName: "Iris", hasRuntimeProfile: true, role: false },
    ],
  );
});

test("ChannelService keeps the creator once when create members include the actor", async () => {
  const service = new ChannelService(new InMemoryChannelRepository());

  const channel = await service.createChannel({
    companyId: "acme",
    title: "Boss room",
    actor: {
      participantKind: "company_member",
      memberId: "xuziho",
      displayName: "Xuziho",
    },
    members: [{
      memberId: "xuziho",
      displayName: "Xuziho",
    }],
  });

  assert.deepEqual(channel.members.map((member) => member.memberId), ["xuziho"]);
});

test("ChannelService requires an actor display name when creating a Channel", async () => {
  const service = new ChannelService(new InMemoryChannelRepository());

  await assert.rejects(
    () => service.createChannel({
      companyId: "acme",
      title: "Boss room",
      actor: {
        participantKind: "company_member",
        memberId: "xuziho",
      },
    }),
    /actor.displayName is required/,
  );
});

test("ChannelService lets any Channel participant update details and members", async () => {
  const { service, channel } = await seededService();

  const updated = await service.updateDetails({
    companyId: "acme",
    channelId: channel.chatChannelId,
    actor: { participantKind: "company_member", memberId: "nora-automation" },
    title: "Launch room",
    summary: "Coordinate launch work across content and analytics.",
  });
  assert.equal(updated.title, "Launch room");

  const removed = await service.removeMember({
    companyId: "acme",
    channelId: channel.chatChannelId,
    actor: { participantKind: "company_member", memberId: "iris-growth" },
    member: { participantKind: "company_member", memberId: "nora-automation" },
  });
  assert.deepEqual(
    removed.members.map((member) => member.memberId),
    ["xuziho", "iris-growth"],
  );
});

test("ChannelService rejects Channel management from nonparticipants", async () => {
  const { service, channel } = await seededService();

  await assert.rejects(
    () => service.removeMember({
      companyId: "acme",
      channelId: channel.chatChannelId,
      actor: { participantKind: "company_member", memberId: "outside-member" },
      member: { participantKind: "company_member", memberId: "iris-growth" },
    }),
    ChannelPermissionDeniedError,
  );
});

test("ChannelService hard deletes a Channel when a participant has dissolve permission", async () => {
  const { service, channel } = await seededService({
    dissolvePermissionResolver: ({ actor }) => actor.memberId === "xuziho",
  });

  const result = await service.dissolveChannel({
    companyId: "acme",
    channelId: channel.chatChannelId,
    actor: { participantKind: "company_member", memberId: "xuziho" },
    confirmation: "DELETE",
  });

  assert.deepEqual(result, {
    companyId: "acme",
    chatChannelId: channel.chatChannelId,
    dissolved: true,
  });
  assert.equal(
    (await service.listChannelsForViewer("acme", { participantKind: "company_member", memberId: "xuziho" })).length,
    0,
  );
  await assert.rejects(
    () => service.requireChannel("acme", channel.chatChannelId),
    /Channel not found/,
  );
});

test("ChannelService can restrict dissolve with a company-level permission resolver", async () => {
  const { service, channel } = await seededService({
    dissolvePermissionResolver: ({ actor }) => actor.memberId === "xuziho",
  });

  await assert.rejects(
    () => service.dissolveChannel({
      companyId: "acme",
      channelId: channel.chatChannelId,
      actor: { participantKind: "company_member", memberId: "nora-automation" },
      confirmation: "DELETE",
    }),
    ChannelPermissionDeniedError,
  );
});

test("ChannelService requires the delete confirmation before dissolving a Channel", async () => {
  const { service, channel } = await seededService();

  await assert.rejects(
    () => service.dissolveChannel({
      companyId: "acme",
      channelId: channel.chatChannelId,
      actor: { participantKind: "company_member", memberId: "xuziho" },
      confirmation: "delete",
    }),
    /Channel dissolve confirmation must be DELETE/,
  );
});

test("ChannelService rejects old employee Channel member identity", async () => {
  await assert.rejects(
    () => new ChannelService(new InMemoryChannelRepository()).createChannel({
      companyId: "acme",
      title: "Ops",
      actor: {
        participantKind: "company_member",
        memberId: "xuziho",
        displayName: "Xu",
      },
      members: [{
        employeeId: "nora-automation",
        displayName: "Nora",
      } as never],
    }),
    /Channel member requires memberId/,
  );
});

test("ChannelService rejects inactive or unavailable members at the authoritative membership boundary", async () => {
  const service = new ChannelService(new InMemoryChannelRepository(), {
    memberEligibilityResolver: ({ memberIds }) => memberIds.filter((memberId) => memberId !== "inactive-analyst"),
  });
  const channel = await service.createChannel({
    companyId: "acme",
    title: "Ops",
    actor: {
      participantKind: "company_member",
      memberId: "xuziho",
      displayName: "Xu",
    },
    members: [{ memberId: "nora-automation", displayName: "Nora", hasRuntimeProfile: true }],
  });

  await assert.rejects(
    () => service.addMembers({
      companyId: "acme",
      channelId: channel.chatChannelId,
      actor: { participantKind: "company_member", memberId: "xuziho" },
      members: [{ memberId: "inactive-analyst", displayName: "Inactive Analyst", hasRuntimeProfile: true }],
    }),
    /inactive-analyst is not active or is not available/,
  );
  assert.deepEqual((await service.requireChannel("acme", channel.chatChannelId)).members.map((member) => member.memberId), [
    "xuziho",
    "nora-automation",
  ]);
});
