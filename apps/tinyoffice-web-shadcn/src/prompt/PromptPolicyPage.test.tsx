import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chatQueryKeys } from "../chat/chatQueryKeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UnsavedChangesProvider } from "../config/UnsavedChangesProvider";
import type { PromptPolicyViewModel, TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";

const currentSession: TinyOfficeCurrentSession = {
  schema: "tinyoffice-current-session",
  version: 1,
  user: { id: "user-xu", displayName: "Xu Ziho" },
  currentCompanyId: "ziho-e-com",
  member: { memberId: "xuziho", displayName: "Xu Ziho", role: "boss" },
  needsInitialization: false,
};

function promptPolicyModel(): PromptPolicyViewModel {
  return {
    contract: { name: "prompt-policy", version: 1, boundary: "scene-runtime-contract" },
    routes: {
      htmlPath: "/config/prompt-policy",
      viewModelJsonPath: "/api/companies/ziho-e-com/prompt-policy",
      saveBlockPath: "/api/companies/ziho-e-com/prompt-policy/blocks/:blockPath",
      resetBlockPath: "/api/companies/ziho-e-com/prompt-policy/blocks/:blockPath/reset",
      saveTemplatePath: "/api/companies/ziho-e-com/prompt-policy/templates/:templateId",
      resetTemplatePath: "/api/companies/ziho-e-com/prompt-policy/templates/:templateId/reset",
    },
    config: {
      version: 1,
      always: [],
      scenes: {
        dm_thread: [],
        channel_thread: [],
        intake_event: [],
        work_run_execution: [],
      },
    },
    templates: [{
      id: "base-system-prompt",
      label: "Base System Prompt",
      description: "Stable employee identity and behavior text.",
      content: "You are an employee in TinyOffice.\n",
      defaultContent: "You are an employee in TinyOffice.\n",
      variableHints: ["{employeeId}", "{displayName}", "{role}"],
    }, {
      id: "runtime-prompt-template",
      label: "Runtime Prompt Template",
      description: "Wrapper used to assemble runtime calls.",
      content: "{promptBlocks}\n{userMessage}\n",
      defaultContent: "{promptBlocks}\n{userMessage}\n",
      variableHints: ["{promptBlocks}", "{contextBlocks}", "{userMessage}"],
    }],
    scenes: [{
      id: "dm_thread",
      label: "DM Thread",
      purpose: "Direct employee replies in TinyOffice DM conversations.",
      alwaysBlocks: [],
      sceneBlocks: [],
      effectiveBlockPaths: ["dm-scene"],
      effectivePrompt: "# DM Scene\n\nYou are replying in a direct-message thread.",
    }],
    availableBlocks: [{
      path: "dm-scene",
      title: "DM Scene",
      sha256: "abc",
      preview: "You are replying in a direct-message thread.",
      content: "# DM Scene\n\nYou are replying in a direct-message thread.",
      loadedBy: [{ scene: "dm_thread", label: "DM Thread", source: "runtime_default" }],
    }],
    diagnostics: {
      errors: [],
      warnings: [{ severity: "warning", code: "unused-block", message: "Reusable block is not mounted." }],
      unmountedBlocks: [],
    },
  };
}

test("renders Prompt Policy as a company-level prompt editor", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { PromptPolicyPage } = await import("./PromptPolicyPage");
  const queryClient = new QueryClient();
  queryClient.setQueryData(chatQueryKeys.promptPolicy("ziho-e-com"), promptPolicyModel());

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <UnsavedChangesProvider>
        <PromptPolicyPage currentSession={currentSession} />
      </UnsavedChangesProvider>
    </QueryClientProvider>,
  );

  assert.match(html, /Prompt Policy/);
  assert.match(html, /Company prompt configuration/);
  assert.match(html, /Foundation prompts/);
  assert.match(html, /Scene blocks/);
  assert.match(html, /Base System Prompt/);
  assert.match(html, /DM Scene/);
  assert.match(html, /Save changes/);
  assert.match(html, /Reset to default/);
  assert.doesNotMatch(html, /base-system-prompt/);
  assert.doesNotMatch(html, /No diagnostics/);
  assert.doesNotMatch(html, /Runtime usage/);
  assert.match(html, /unused-block/);
  assert.doesNotMatch(html, /AGENTS\.md/);
  assert.doesNotMatch(html, /SKILL\.md/);
  assert.doesNotMatch(html, /Access policy/);
  assert.doesNotMatch(html, /scene binding matrix/i);
});

test("keeps Prompt Policy focused on content instead of scene binding or JSON editors", async () => {
  const source = await readFile(new URL("./PromptPolicyPage.tsx", import.meta.url), "utf8");

  assert.match(source, /selectedPromptFor/);
  assert.match(source, /savePromptPolicyTemplate/);
  assert.match(source, /savePromptPolicyBlock/);
  assert.match(source, /resetPromptPolicyTemplate/);
  assert.match(source, /resetPromptPolicyBlock/);
  assert.match(source, /Other Prompt Policy entries will not change/);
  assert.match(source, /<Dialog open=\{resetDialogOpen\}/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.doesNotMatch(source, /Reset selectedPromptFor\(model, ""\)/);
  assert.doesNotMatch(source, /savePromptPolicyConfig/);
  assert.doesNotMatch(source, /Advanced JSON/);
  assert.doesNotMatch(source, /scene binding matrix/i);
});
