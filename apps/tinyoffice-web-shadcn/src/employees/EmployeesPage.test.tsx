import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chatQueryKeys } from "../chat/chatQueryKeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UnsavedChangesProvider } from "../config/UnsavedChangesProvider";
import type { EmployeesAdminState, TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";

const currentSession: TinyOfficeCurrentSession = {
  schema: "tinyoffice-current-session",
  version: 2,
  user: { id: "user-xu", displayName: "Xu Ziho" },
  currentCompanyId: "ziho-e-com",
  member: { memberId: "xuziho", displayName: "Xu Ziho", role: "boss" },
  needsProfileInitialization: false,
  needsCompanyInitialization: false,
};

function employeesState(): EmployeesAdminState {
  return {
    employees: [{
      employeeId: "avery",
      enabled: true,
      profile: {
        employeeId: "avery",
        avatarSeed: "avery",
        displayName: "Avery",
        role: "automation",
        presenceMode: "resident",
        sceneProfile: "Keeps weekly operations clean.",
      },
      resourcePolicy: {
        version: 1,
        filesystem: {
          ownWorkspace: "allow",
          otherEmployeeWorkspace: "approval",
          repo: "approval",
          secrets: "deny",
        },
      },
      runtime: {
        version: 1,
        modelProvider: "openai-codex",
        modelId: "gpt-5.5",
        thinkingLevel: "medium",
      },
      localAssets: {
        homePath: "/companies/ziho-e-com/employees/avery",
        workspacePath: "/companies/ziho-e-com/employees/avery/workspace",
        skillPaths: ["/companies/ziho-e-com/employees/avery/skills/weekly-audit/SKILL.md"],
        instructionFiles: [{
          location: "employee_home",
          name: "AGENTS.md",
          path: "/companies/ziho-e-com/employees/avery/AGENTS.md",
          relativePath: "AGENTS.md",
          exists: true,
          content: "You are Avery.\n",
          editable: true,
        }],
      },
    }, {
      employeeId: "retired-avery",
      enabled: false,
      profile: { employeeId: "retired-avery", avatarSeed: "retired-avery", displayName: "Retired Avery", role: "archive", presenceMode: "resident" },
      resourcePolicy: {
        version: 1,
        filesystem: {
          ownWorkspace: "allow",
          otherEmployeeWorkspace: "approval",
          repo: "approval",
          secrets: "deny",
        },
      },
      runtime: { version: 1, modelProvider: "openai-codex", modelId: "gpt-5.5", thinkingLevel: "minimal" },
    }],
    availableModels: [{ provider: "openai-codex", id: "gpt-5.5", name: "GPT-5.5" }],
    presenceModes: ["resident", "auto_exit_idle"],
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
  };
}

test("renders Employees as an employee configuration surface", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { EmployeesPage } = await import("./EmployeesPage");
  const queryClient = new QueryClient();
  queryClient.setQueryData(chatQueryKeys.employees("ziho-e-com"), employeesState());
  queryClient.setQueryData(chatQueryKeys.employeePrivateSkills("ziho-e-com", "avery"), {
    schema: "employee-private-skills",
    version: 1,
    companyId: "ziho-e-com",
    memberId: "avery",
    skillsRootPath: "/companies/ziho-e-com/employees/avery/skills",
    skills: [{
      skillId: "weekly-audit",
      name: "weekly-audit",
      path: "/companies/ziho-e-com/employees/avery/skills/weekly-audit/SKILL.md",
      relativePath: "weekly-audit/SKILL.md",
      exists: true,
    }],
  });
  queryClient.setQueryData(chatQueryKeys.employeePrivateSkill("ziho-e-com", "avery", "weekly-audit"), {
    schema: "employee-private-skill",
    version: 1,
    companyId: "ziho-e-com",
    memberId: "avery",
    skillId: "weekly-audit",
    name: "weekly-audit",
    path: "/companies/ziho-e-com/employees/avery/skills/weekly-audit/SKILL.md",
    relativePath: "weekly-audit/SKILL.md",
    exists: true,
    content: "Audit weekly operations.\n",
    editable: true,
  });

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <UnsavedChangesProvider>
        <EmployeesPage currentSession={currentSession} />
      </UnsavedChangesProvider>
    </QueryClientProvider>,
  );

  assert.match(html, /Employee configuration/);
  assert.doesNotMatch(html, />Employees</);
  assert.match(html, /New employee/);
  assert.doesNotMatch(html, /Reload all/);
  assert.match(html, /Save changes/);
  assert.match(html, /Avery/);
  assert.match(html, /Active 1/);
  assert.match(html, /Inactive 1/);
  assert.doesNotMatch(html, /Retired Avery/);
  assert.match(html, /automation/);
  assert.match(html, /Profile/);
  assert.match(html, /Runtime/);
  assert.match(html, /AGENTS.md/);
  assert.match(html, /Skills/);
  assert.match(html, /Display name/);
  assert.match(html, /Responsibilities/);
  assert.doesNotMatch(html, /openai-codex/);
  assert.doesNotMatch(html, /gpt-5.5/);
  assert.doesNotMatch(html, /weekly-audit/);
  assert.doesNotMatch(html, /Audit weekly operations/);
  assert.doesNotMatch(html, /Employee-private skills are edited here after they already exist/);
  assert.doesNotMatch(html, /Task command center/);
  assert.doesNotMatch(html, /Runtime sessions/);
  assert.doesNotMatch(html, /Company lifecycle/);
});

test("does not render a private skill editor when the employee has no private skills", async () => {
  const source = await readFile(new URL("./EmployeesPage.tsx", import.meta.url), "utf8");

  assert.match(source, /const hasPrivateSkills = Boolean\(skillsQuery\.data\?\.skills\.length\);/);
  assert.match(source, /!skillsQuery\.isLoading && !hasPrivateSkills/);
  assert.match(source, /return <PanelNote>No private skill file exists for this employee\.<\/PanelNote>;/);
});

test("hydrates delayed Skill content without creating a false unsaved state", async () => {
  const { hydrateSkillEditor } = await import("./skillEditorModel");
  const hydrated = hydrateSkillEditor(
    { identity: "", content: "", baseline: "" },
    "ziho-e-com:employee-hr:recruit-employee",
    "# Recruit Employee\n",
  );

  assert.deepEqual(hydrated, {
    identity: "ziho-e-com:employee-hr:recruit-employee",
    content: "# Recruit Employee\n",
    baseline: "# Recruit Employee\n",
  });
  assert.equal(hydrated.content === hydrated.baseline, true);
});

test("preserves edits during refetch and loads content when the employee or Skill changes", async () => {
  const { hydrateSkillEditor } = await import("./skillEditorModel");
  const dirty = {
    identity: "ziho-e-com:employee-hr:recruit-employee",
    content: "User edit",
    baseline: "Original",
  };

  assert.equal(hydrateSkillEditor(dirty, dirty.identity, "Server refresh"), dirty);
  assert.deepEqual(hydrateSkillEditor(dirty, "ziho-e-com:avery:weekly-audit", "Weekly audit"), {
    identity: "ziho-e-com:avery:weekly-audit",
    content: "Weekly audit",
    baseline: "Weekly audit",
  });
});

test("renders employee lifecycle as a segmented control and editor navigation as content tabs", async () => {
  const source = await readFile(new URL("./EmployeesPage.tsx", import.meta.url), "utf8");

  assert.match(source, /tiny-segmented-control/);
  assert.match(source, /tiny-segmented-trigger/);
  assert.match(source, /<TabsList variant="line" className="tiny-content-tabs/);
  assert.match(source, /w-fit max-w-full overflow-x-auto/);
  assert.match(source, /const employeeTabTriggerClassName =/);
  assert.match(source, /hover:text-foreground/);
});

test("employee lifecycle changes invalidate active Chat discovery", async () => {
  const source = await readFile(new URL("./EmployeesPage.tsx", import.meta.url), "utf8");

  assert.match(source, /chatQueryKeys\.directory\(companyId\)/);
  assert.match(source, /await Promise\.all\(\[/);
});

test("employee profile saves update and invalidate Chat avatar discovery", async () => {
  const source = await readFile(new URL("./EmployeesPage.tsx", import.meta.url), "utf8");

  assert.match(source, /setQueryData<CompanyDirectoryDto>\(chatQueryKeys\.directory\(companyId\)/);
  assert.match(source, /avatarSeed: savedEmployee\.profile\.avatarSeed/);
  assert.match(source, /queryClient\.invalidateQueries\(\{ queryKey: chatQueryKeys\.projectionScope\(companyId\) \}\)/);
});
