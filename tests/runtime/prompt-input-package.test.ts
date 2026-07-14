import assert from "node:assert/strict";
import test from "node:test";

import { buildPromptInputPackage } from "../../src/runtime/provider/prompt-input-package.js";
import type { EmployeeHome } from "../../src/runtime/registry/employee-home.js";

const employee: EmployeeHome = {
  companyId: "acme",
  employeeId: "mira-hr",
  homePath: "C:/employees/mira-hr",
  workspacePath: "C:/employees/mira-hr/workspace",
  profile: {
    employeeId: "mira-hr",
    role: "hr",
    displayName: "Mira",
    presenceMode: "resident",
  },
  resourcePolicy: {
    version: 1,
    allowedResourceIds: [],
  },
};

test("prompt input package keeps changing Channel context out of the stable prefix", () => {
  const shared = {
    employee,
    sessionKey: "mira-hr|channel_thread|topic-1",
    createdAt: "2026-07-14T10:00:00.000Z",
    systemPromptAppend: "Stable employee system prompt.",
    promptBlocks: [{
      path: "channel-scene",
      sha256: "scene-sha",
      content: "Stable Channel scene policy.",
    }],
    employeeInstructionFiles: [{
      path: "C:/employees/mira-hr/AGENTS.md",
      content: "Stable employee instructions.",
    }],
    activeToolNames: ["handoff_topic_turn", "read"],
    loadedSkillNames: ["research", "analysis"],
  };
  const first = buildPromptInputPackage({
    ...shared,
    message: "First trigger",
    userPrompt: "Runtime Context:\n- [trigger] Xu: First trigger",
    contextBlocks: [],
  });
  const second = buildPromptInputPackage({
    ...shared,
    message: "Second trigger",
    userPrompt: "Runtime Context:\n- [trigger] Xu: Second trigger",
    contextBlocks: [],
  });

  assert.equal(first.cacheEvidence.stablePrefixSha256, second.cacheEvidence.stablePrefixSha256);
  assert.notEqual(first.cacheEvidence.fullInputSha256, second.cacheEvidence.fullInputSha256);
  assert.deepEqual(first.tools.map((tool) => tool.name), ["handoff_topic_turn", "read"]);
  assert.deepEqual(first.skills.map((skill) => skill.name), ["analysis", "research"]);
});
