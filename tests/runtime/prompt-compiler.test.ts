import assert from "node:assert/strict";
import test from "node:test";

import { compileRuntimePrompt } from "../../src/runtime/prompting/prompt-compiler.js";

test("compileRuntimePrompt separates the user message from channel thread context", () => {
  const prompt = compileRuntimePrompt({
    sceneType: "channel_thread",
    sessionKey: "mira-hr|channel_thread|post-42",
    userVisibleMessage: "Can you summarize the hiring thread?",
    contextBlocks: [
      {
        role: "channel_thread_context",
        source: "tinyoffice.channel_topic_context",
        label: "TinyOffice Channel/Topic context",
        text: "Channel: hiring-room\nTopic: post-42\nParticipants: Mira, Alex",
      },
    ],
  });

  assert.equal(prompt.userVisibleMessage, "Can you summarize the hiring thread?");
  assert.equal(prompt.sections.find((section) => section.semanticRole === "user_visible_message")?.text, "Can you summarize the hiring thread?");
  assert.equal(prompt.sections.find((section) => section.semanticRole === "channel_thread_context")?.text, "Channel: hiring-room\nTopic: post-42\nParticipants: Mira, Alex");
  assert.match(prompt.userPrompt, /Runtime Context:/);
  assert.match(prompt.userPrompt, /User Message:/);
  assert.ok(prompt.userPrompt.indexOf("Runtime Context:") < prompt.userPrompt.indexOf("User Message:"));
});

test("compileRuntimePrompt records prompt package and tool policy as auditable sections", () => {
  const prompt = compileRuntimePrompt({
    sceneType: "intake_event",
    sessionKey: "mira-hr|intake_event|evt-7",
    userVisibleMessage: "New intake event arrived.",
    systemPromptAppend: "You are employee mira-hr.",
    promptBlocks: [
      {
        path: "intake-event",
        content: "Treat intake events as structured external requests.",
      },
    ],
    toolPolicy: {
      source: "runtime.tool_policy",
      activeToolNames: ["handoff", "get_channel_context"],
    },
  });

  assert.deepEqual(prompt.promptBlocks.map((block) => block.path), ["intake-event"]);
  assert.deepEqual(prompt.activeToolNames, ["handoff", "get_channel_context"]);
  assert.equal(prompt.sections.find((section) => section.semanticRole === "system_prompt")?.text, "You are employee mira-hr.");
  assert.equal(prompt.sections.find((section) => section.semanticRole === "runtime_prompt_package")?.data?.promptBlockPaths?.[0], "intake-event");
  assert.equal(prompt.sections.find((section) => section.semanticRole === "tool_policy")?.data?.activeToolNames?.[0], "handoff");
  assert.match(prompt.userPrompt, /Prompt Policy: intake-event:/);
  assert.match(prompt.userPrompt, /Treat intake events as structured external requests\./);
  assert.deepEqual(prompt.audit.sectionRoles, [
    "system_prompt",
    "runtime_prompt_package",
    "tool_policy",
    "user_visible_message",
  ]);
});

test("compileRuntimePrompt records intake event payload as its own context section", () => {
  const prompt = compileRuntimePrompt({
    sceneType: "intake_event",
    sessionKey: "quality-editor|intake_event|evt-7",
    userVisibleMessage: "External intake event received.",
    contextBlocks: [
      {
        role: "intake_event_context",
        source: "external_intake.event_payload",
        label: "External intake event context",
        text: "Event ID: evt-7\nCategory: website.article_audit\nPayload: {\"articleUrl\":\"https://example.test/articles/amethyst\"}",
      },
    ],
  });

  assert.equal(prompt.userVisibleMessage, "External intake event received.");
  assert.equal(
    prompt.sections.find((section) => section.semanticRole === "intake_event_context")?.text,
    "Event ID: evt-7\nCategory: website.article_audit\nPayload: {\"articleUrl\":\"https://example.test/articles/amethyst\"}",
  );
  assert.deepEqual(prompt.audit.sectionRoles, [
    "intake_event_context",
    "user_visible_message",
  ]);
  assert.ok(prompt.userPrompt.indexOf("External intake event context:") < prompt.userPrompt.indexOf("User Message:"));
});

test("compileRuntimePrompt records WorkRun execution detail as its own context section", () => {
  const prompt = compileRuntimePrompt({
    sceneType: "work_run_execution",
    sessionKey: "iris-growth|work_run_execution|work-run-2",
    userVisibleMessage: "Start background work_run_execution session for WorkRun work-run-2.",
    contextBlocks: [
      {
        role: "work_run_context",
        source: "work_execution.work_run_context",
        label: "WorkRun execution context",
        text: "WorkRun package:\n{\"workRunId\":\"work-run-2\"}\nRecent WorkRun events:\n- created",
      },
    ],
  });

  assert.equal(
    prompt.sections.find((section) => section.semanticRole === "work_run_context")?.source,
    "work_execution.work_run_context",
  );
  assert.ok(prompt.userPrompt.indexOf("WorkRun execution context:") < prompt.userPrompt.indexOf("User Message:"));
  assert.deepEqual(prompt.audit.sectionRoles, [
    "work_run_context",
    "user_visible_message",
  ]);
});

test("compileRuntimePrompt does not render a separate completion policy prompt block", () => {
  const prompt = compileRuntimePrompt({
    sceneType: "channel_thread",
    sessionKey: "mira-hr|channel_thread|post-42",
    userVisibleMessage: "Please hand this over to Quinn.",
  });

  assert.equal(prompt.userVisibleMessage, "Please hand this over to Quinn.");
  assert.equal(prompt.sections.find((section) => section.semanticRole === "completion_policy"), undefined);
  assert.doesNotMatch(prompt.userPrompt, /Completion Policy:/);
  assert.equal("completionPolicyKind" in prompt.audit, false);
});

test("compileRuntimePrompt renders prompt blocks even when a custom runtime template omits the slot", () => {
  const prompt = compileRuntimePrompt({
    sceneType: "channel_thread",
    sessionKey: "mira-hr|channel_thread|post-42",
    userVisibleMessage: "Please hand this to Avery.",
    runtimePromptTemplate: [
      "Scene slot: {sceneType}",
      "Context slot:",
      "{contextBlocks}",
      "Message slot:",
      "{userMessage}",
    ].join("\n"),
    promptBlocks: [{
      path: "channel-scene",
      content: "After replying, call `handoff_topic_turn` exactly once.",
    }],
  });

  assert.ok(prompt.userPrompt.indexOf("Prompt Policy: channel-scene:") === 0);
  assert.match(prompt.userPrompt, /call `handoff_topic_turn` exactly once/);
  assert.ok(prompt.userPrompt.indexOf("Prompt Policy: channel-scene:") < prompt.userPrompt.indexOf("Message slot:"));
});

test("compileRuntimePrompt renders configurable runtime prompt templates without completion policy slots", () => {
  const prompt = compileRuntimePrompt({
    sceneType: "channel_thread",
    sessionKey: "mira-hr|channel_thread|post-42",
    userVisibleMessage: "Please summarize this.",
    runtimePromptTemplate: [
      "Scene slot: {sceneType}",
      "Context slot:",
      "{contextBlocks}",
      "Message slot:",
      "{userMessage}",
    ].join("\n"),
    contextBlocks: [{
      role: "channel_thread_context",
      source: "tinyoffice.channel_topic_context",
      label: "TinyOffice Channel/Topic context",
      text: "Thread summary: hiring discussion",
    }],
  });

  assert.equal(
    prompt.userPrompt,
    [
      "Scene slot: channel_thread",
      "Context slot:",
      "TinyOffice Channel/Topic context:",
      "Thread summary: hiring discussion",
      "Message slot:",
      "Please summarize this.",
    ].join("\n"),
  );
});
