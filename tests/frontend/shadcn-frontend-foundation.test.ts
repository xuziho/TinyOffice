import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const appRoot = path.join(repoRoot, "apps", "tinyoffice-web-shadcn");

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8")) as T;
}

async function readText(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

async function readChatProductSource(): Promise<string> {
  const productFiles = [
    "apps/tinyoffice-web-shadcn/src/app/App.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/ChatWorkspaceRoute.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/WorkspaceSidebar.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/CenterWorkspace.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/DraftEntryPanel.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/EntryListPanel.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/MessagePanel.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/ContextPanel.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/Composer.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/SystemMessage.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/chatUiUtils.ts",
    "apps/tinyoffice-web-shadcn/src/chat/useChatWorkspace.ts",
    "apps/tinyoffice-web-shadcn/src/chat/chatQueryKeys.ts",
    "apps/tinyoffice-web-shadcn/src/chat/useChatRealtime.ts",
  ];
  return (await Promise.all(productFiles.map(readText))).join("\n");
}

test("shadcn frontend scaffold is isolated from the legacy local UI layer", async () => {
  assert.equal(existsSync(appRoot), true, "apps/tinyoffice-web-shadcn must exist");
  assert.equal(existsSync(path.join(appRoot, "components.json")), true, "new app must be initialized with shadcn components.json");
  assert.equal(existsSync(path.join(appRoot, "src", "components", "ui")), true, "new app must own its shadcn ui directory");
  assert.equal(existsSync(path.join(appRoot, "src", "app", "App.tsx")), true, "new app must own its product app entry");

  const packageJson = await readJson<{
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>("apps/tinyoffice-web-shadcn/package.json");

  assert.match(packageJson.scripts?.dev ?? "", /\bvite\b/);
  assert.match(packageJson.scripts?.build ?? "", /\bvite(?:\.js)? build\b/);
  assert.match(packageJson.scripts?.check ?? "", /\btsc\b.*--noEmit/);
  assert.ok(packageJson.dependencies?.react, "new app must declare its own React dependency");
  assert.ok(packageJson.dependencies?.["react-dom"], "new app must declare its own React DOM dependency");
  assert.ok(packageJson.devDependencies?.vite, "new app must declare its own Vite dependency");

  const rootPackageJson = await readJson<{ scripts?: Record<string, string> }>("package.json");
  assert.equal(rootPackageJson.scripts?.["dev:tinyoffice-web-shadcn"], "npm run dev --prefix apps/tinyoffice-web-shadcn");
  assert.equal(rootPackageJson.scripts?.["check:tinyoffice-web-shadcn"], "npm run check --prefix apps/tinyoffice-web-shadcn");
  assert.equal(rootPackageJson.scripts?.["build:tinyoffice-web-shadcn"], "npm run build --prefix apps/tinyoffice-web-shadcn");

  const componentJson = await readJson<{
    aliases?: Record<string, string>;
    iconLibrary?: string;
  }>("apps/tinyoffice-web-shadcn/components.json");
  assert.equal(componentJson.aliases?.components, "@/components");
  assert.equal(componentJson.aliases?.ui, "@/components/ui");
  assert.equal(componentJson.iconLibrary, "lucide");

  const sourceFiles = [
    "apps/tinyoffice-web-shadcn/src/app/App.tsx",
    "apps/tinyoffice-web-shadcn/src/main.tsx",
    "apps/tinyoffice-web-shadcn/src/index.css",
  ];
  const combinedSource = (await Promise.all(sourceFiles.map(readText))).join("\n");
  assert.doesNotMatch(combinedSource, /apps\/tinyoffice-web(?!-shadcn)/);
  assert.doesNotMatch(combinedSource, /\.\.\/\.\.\/tinyoffice-web/);
  assert.doesNotMatch(combinedSource, /ui-button|ui-card|AdminShell|StateBlock|(?:^|\W)Panel(?:$|\W)/);
});

test("shadcn frontend uses API contracts without installing the root package", async () => {
  const packageJson = await readJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>("apps/tinyoffice-web-shadcn/package.json");
  assert.equal(packageJson.dependencies?.tinyoffice, undefined, "new app must not install the repository root as a package dependency");
  assert.equal(packageJson.devDependencies?.tinyoffice, undefined, "new app must not install the repository root as a dev dependency");

  const tsconfigSource = await readText("apps/tinyoffice-web-shadcn/tsconfig.app.json");
  assert.match(
    tsconfigSource,
    /"tinyoffice\/frontend-api-contracts"\s*:\s*\[\s*"\.\.\/\.\.\/src\/api\/contracts\/tinyoffice-frontend-api-contracts\.ts"\s*\]/,
    "new app should type-check against the public frontend API contract file without a file:../.. dependency",
  );

  const apiFiles = [
    "apps/tinyoffice-web-shadcn/src/api/tinyofficeRequest.ts",
    "apps/tinyoffice-web-shadcn/src/api/currentSessionClient.ts",
    "apps/tinyoffice-web-shadcn/src/api/chatClient.ts",
    "apps/tinyoffice-web-shadcn/src/api/tasksClient.ts",
  ];
  for (const apiFile of apiFiles) {
    assert.equal(existsSync(path.join(repoRoot, apiFile)), true, `${apiFile} must exist`);
  }

  const apiSource = (await Promise.all(apiFiles.map(readText))).join("\n");
  assert.match(apiSource, /from "tinyoffice\/frontend-api-contracts"/);
  assert.doesNotMatch(apiSource, /from ["'](?:\.\.\/)+\.\.\/src\//);
  assert.doesNotMatch(apiSource, /apps\/tinyoffice-web(?!-shadcn)|tinyoffice-web\/src/);
  assert.doesNotMatch(apiSource, /from ["']tinyoffice(?!\/frontend-api-contracts)/);
});

test("shadcn frontend dev server uses a separate port and proxies TinyOffice APIs", async () => {
  const viteConfig = await readText("apps/tinyoffice-web-shadcn/vite.config.ts");
  assert.match(viteConfig, /port:\s*5175/);
  assert.match(viteConfig, /strictPort:\s*true/);
  assert.match(viteConfig, /TINYOFFICE_RUNTIME_ORIGIN/);
  assert.match(viteConfig, /http:\/\/127\.0\.0\.1:8095/);
  assert.match(viteConfig, /"\/api"/);
  assert.match(viteConfig, /ws:\s*true/);
});

test("shadcn frontend keeps theme tokens and horizontal workspace panels wired", async () => {
  const cssSource = await readText("apps/tinyoffice-web-shadcn/src/index.css");
  assert.match(cssSource, /@import\s+"tailwindcss"/);
  assert.match(cssSource, /--background:/, "shadcn theme variables must define background tokens");
  assert.match(cssSource, /--color-background:/, "Tailwind v4 theme mapping must expose shadcn background utilities");
  assert.match(cssSource, /--color-border:/, "Tailwind v4 theme mapping must expose shadcn border utilities");
  assert.match(cssSource, /--radius-md:/, "shadcn radius tokens must be available for installed primitives");

  assert.match(
    cssSource,
    /\.tiny-chat-workbench\s*\{[\s\S]*grid-template-columns:\s*274px minmax\(0, 1fr\) clamp\(248px, 22vw, 320px\)/,
    "workspace shell must keep explicit horizontal Chat columns",
  );
});

test("shadcn chat shell prevents message content from pushing panels off screen", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const chatRouteSource = await readText("apps/tinyoffice-web-shadcn/src/chat/ChatWorkspaceRoute.tsx");
  const productSource = await readChatProductSource();

  assert.match(appSource, /<main[^>]*overflow-hidden/, "app shell must prevent page-level horizontal overflow");
  assert.match(chatRouteSource, /<div[^>]*className="min-w-0 overflow-hidden"/, "workspace panels must allow children to shrink");
  assert.match(productSource, /<MessageScrollerViewport[^>]*overflow-x-hidden/, "message viewport must not create a horizontal page scroll");
  assert.match(productSource, /\[overflow-wrap:anywhere\]/, "message bubbles must break long paths and unspaced text");
});

test("shadcn chat shell uses stable grid columns instead of resizable pixel panel numbers", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const cssSource = await readText("apps/tinyoffice-web-shadcn/src/index.css");

  assert.doesNotMatch(appSource, /defaultSize=\{\d+\}/, "numeric defaultSize is pixels in react-resizable-panels");
  assert.doesNotMatch(appSource, /minSize=\{\d+\}/, "numeric minSize is pixels in react-resizable-panels");
  assert.doesNotMatch(appSource, /maxSize=\{\d+\}/, "numeric maxSize is pixels in react-resizable-panels");
  assert.doesNotMatch(appSource, /<ResizablePanel/);
  assert.match(cssSource, /grid-template-columns:\s*274px minmax\(0, 1fr\) clamp\(248px, 22vw, 320px\)/);
});

test("shadcn chat shell uses a fixed object rail, center workspace, and context rail", async () => {
  const chatRouteSource = await readText("apps/tinyoffice-web-shadcn/src/chat/ChatWorkspaceRoute.tsx");
  const productSource = await readChatProductSource();

  assert.match(productSource, /SidebarProvider/);
  assert.match(productSource, /<Sidebar[\s\S]*collapsible="none"/);
  assert.match(productSource, /SidebarContent/);
  assert.match(productSource, /SidebarMenuButton/);
  assert.match(productSource, /SidebarMenuBadge/);
  assert.doesNotMatch(productSource, /function WorkspaceSidebar[\s\S]*?<aside[\s\S]*?function NavigationGroup/);
  assert.doesNotMatch(productSource, /function WorkspaceSidebar[\s\S]*?<nav[\s\S]*?function NavigationGroup/);
  assert.doesNotMatch(productSource, /OpenRoomsGroup/);
  assert.doesNotMatch(productSource, /Open rooms/);
  assert.doesNotMatch(productSource, /RefreshCwIcon/);
  assert.doesNotMatch(productSource, />\{status\}<\/Badge>/);
  assert.match(productSource, /Direct messages/);
  assert.match(chatRouteSource, /<CenterWorkspace/);
  assert.match(productSource, /onBackToList/);
  assert.match(productSource, /<EntryListPanel[^>]*onSelectEntry/);
  assert.match(productSource, /<MessagePanel[^>]*onBackToList/);
  assert.match(productSource, /Back to list/);
  assert.equal((chatRouteSource.match(/className="min-w-0 overflow-hidden"/g) ?? []).length >= 3, true);
});

test("shadcn chat product composition lives outside the app orchestrator", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const chatRouteSource = await readText("apps/tinyoffice-web-shadcn/src/chat/ChatWorkspaceRoute.tsx");
  const productFiles = [
    "apps/tinyoffice-web-shadcn/src/chat/WorkspaceSidebar.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/CenterWorkspace.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/EntryListPanel.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/MessagePanel.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/ContextPanel.tsx",
    "apps/tinyoffice-web-shadcn/src/chat/Composer.tsx",
  ];

  for (const productFile of productFiles) {
    assert.equal(existsSync(path.join(repoRoot, productFile)), true, `${productFile} must exist`);
  }

  assert.match(appSource, /import\("@\/chat\/ChatWorkspaceRoute"\)/);
  assert.match(chatRouteSource, /from "@\/chat\/WorkspaceSidebar"/);
  assert.match(chatRouteSource, /from "@\/chat\/CenterWorkspace"/);
  assert.match(chatRouteSource, /from "@\/chat\/ContextPanel"/);
  assert.doesNotMatch(appSource, /function WorkspaceSidebar/);
  assert.doesNotMatch(appSource, /function EntryListPanel/);
  assert.doesNotMatch(appSource, /function MessagePanel/);
  assert.doesNotMatch(appSource, /function ContextPanel/);
  assert.doesNotMatch(appSource, /function RoomReplyComposer/);
  assert.doesNotMatch(appSource, /function EntryCreateComposer/);
});

test("shadcn app shell exposes Company switching as a global rail dropdown", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const currentSessionClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/currentSessionClient.ts");
  const pathSource = await readText("apps/tinyoffice-web-shadcn/src/api/tinyofficePaths.ts");

  assert.match(appSource, /DropdownMenu/);
  assert.match(appSource, /DropdownMenuTrigger/);
  assert.match(appSource, /DropdownMenuRadioGroup/);
  assert.match(appSource, /DropdownMenuRadioItem/);
  assert.match(appSource, /CompanySwitcher/);
  assert.match(appSource, /CompanyAvatar/);
  assert.match(appSource, /companyInitials/);
  assert.match(appSource, /switchCurrentCompany/);
  assert.match(appSource, /chatQueryKeys\.all\(\)/);
  assert.match(currentSessionClientSource, /switchCurrentCompany/);
  assert.match(pathSource, /\/api\/tinyoffice\/session\/current-company/);
  assert.doesNotMatch(appSource.match(/function CompanySwitcher[\s\S]*?function ViewButton/)?.[0] ?? "", /<Building2 \/>/);
  const switchCompanyBlock = appSource.match(/const switchCompanyMutation[\s\S]*?\n  \}\);/)?.[0] ?? "";
  assert.doesNotMatch(switchCompanyBlock, /setActiveView\("chat"\)/);
  assert.doesNotMatch(appSource, /localStorage/);
});

test("shadcn app shell exposes Tasks as a first-class operations surface", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const navigationSource = await readText("apps/tinyoffice-web-shadcn/src/app/navigationRoutes.ts");
  const tasksPageSource = await readText("apps/tinyoffice-web-shadcn/src/tasks/TasksPage.tsx");
  const tasksClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/tasksClient.ts");
  const contractSource = await readText("src/api/contracts/tinyoffice-frontend-api-contracts.ts");

  assert.match(navigationSource, /type AppView = [^;]*"tasks"/);
  assert.match(appSource, /import\("@\/tasks\/TasksPage"\)/);
  assert.match(appSource, /label="Tasks"/);
  assert.match(navigationSource, /return "\/tasks"/);
  assert.match(tasksPageSource, /TaskViewTabs/);
  assert.match(tasksPageSource, /"current" \| "scheduled" \| "history"/);
  assert.match(tasksPageSource, /Needs attention/);
  assert.doesNotMatch(tasksPageSource, /New Task|Create Task|createManualWork/);
  assert.match(tasksPageSource, /executeWorkTaskLifecycleAction/);
  assert.match(tasksClientSource, /companyTasksPath/);
  assert.doesNotMatch(tasksClientSource, /companyWorkPath|createManualWork/);
  assert.match(contractSource, /export type TasksViewModel =/);
  assert.doesNotMatch(tasksPageSource, /automation script/i);
  assert.doesNotMatch(tasksPageSource, /auto repair/i);
});

test("shadcn app shell keeps alerts on Chat and Tasks instead of a standalone Attention tray", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const alertSource = await readText("apps/tinyoffice-web-shadcn/src/chat/navigationAlertState.ts");
  const apiSource = await readText("src/api/tinyoffice-api.ts");
  const serverSource = await readText("src/server/tinyoffice-api-server.ts");

  assert.equal(existsSync(path.join(appRoot, "src", "attention", "AttentionTray.tsx")), false);
  assert.equal(existsSync(path.join(appRoot, "src", "api", "attentionClient.ts")), false);
  assert.equal(existsSync(path.join(repoRoot, "src", "attention", "attention-projection.ts")), false);
  assert.match(appSource, /indicator=\{navigationAlerts\.chat\}/);
  assert.match(appSource, /indicator=\{navigationAlerts\.tasks\}/);
  assert.match(appSource, /aria-label=\{accessibleLabel\}/);
  assert.match(alertSource, /entry\.unreadCount > 0 \|\| entry\.mentionCount > 0/);
  assert.match(alertSource, /request\.status === "pending"/);
  assert.match(alertSource, /task\.latestExecution\.status === "failed"/);
  assert.match(alertSource, /action\.id === "retry-dispatch"/);
  assert.doesNotMatch(appSource, /AttentionTray|title="Attention"/);
  assert.doesNotMatch(apiSource, /registerAttentionRoutes/);
  assert.doesNotMatch(serverSource, /\|attention\|/);
});

test("shadcn app shell exposes Employees as the runtime employee configuration surface", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const navigationStructureSource = await readText("apps/tinyoffice-web-shadcn/src/app/navigationStructure.ts");
  const navigationSource = await readText("apps/tinyoffice-web-shadcn/src/app/navigationRoutes.ts");
  const employeesPageSource = await readText("apps/tinyoffice-web-shadcn/src/employees/EmployeesPage.tsx");
  const employeesClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/employeesClient.ts");
  const contractSource = await readText("src/api/contracts/tinyoffice-frontend-api-contracts.ts");

  assert.match(appSource, /import\("@\/employees\/EmployeesPage"\)/);
  assert.match(appSource, /<WorkforceMenu/);
  assert.match(appSource, /<AdminMenu/);
  assert.match(navigationStructureSource, /view: "employees", label: "Employees"/);
  assert.match(navigationStructureSource, /view: "prompt", label: "Prompt"/);
  assert.match(navigationStructureSource, /view: "access", label: "Access"/);
  assert.match(navigationStructureSource, /view: "doctor", label: "Health"/);
  assert.match(navigationSource, /return "\/employees"/);
  assert.match(employeesPageSource, /Employee configuration/);
  assert.match(employeesPageSource, /AGENTS\.md/);
  assert.match(employeesPageSource, /No AGENTS\.md yet\./);
  assert.match(employeesPageSource, /instructionFile\?\.exists === false/);
  assert.match(employeesPageSource, /Employee-private skills are edited here after they already exist/);
  assert.match(employeesPageSource, /Runtime model/);
  assert.match(employeesPageSource, /reloadEmployeeRuntimeIfAvailable\(\{ companyId, memberId: selectedEmployee\.employeeId \}\)/);
  assert.match(employeesPageSource, /reloadEmployeeRuntimeIfAvailable\(\{ companyId, memberId: employee\.employeeId \}\)/);
  assert.match(employeesPageSource, /Company skills/);
  assert.match(employeesPageSource, /Employee skills/);
  assert.doesNotMatch(employeesPageSource, /Reload all/);
  assert.doesNotMatch(employeesPageSource, /<Input value=\{draft\.modelProvider\}/);
  assert.doesNotMatch(employeesPageSource, /Skills root/);
  assert.match(employeesClientSource, /companyMemberRuntimePath/);
  assert.match(employeesClientSource, /employeePrivateSkillPath/);
  assert.match(contractSource, /export type EmployeesAdminState =/);
  assert.match(contractSource, /export type EmployeePrivateSkillFile =/);
  assert.doesNotMatch(employeesPageSource, /Task command center|Runtime sessions|Company lifecycle/);
});

test("shadcn app shell exposes Prompt as the company Prompt Policy surface", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const navigationStructureSource = await readText("apps/tinyoffice-web-shadcn/src/app/navigationStructure.ts");
  const navigationSource = await readText("apps/tinyoffice-web-shadcn/src/app/navigationRoutes.ts");
  const promptPageSource = await readText("apps/tinyoffice-web-shadcn/src/prompt/PromptPolicyPage.tsx");
  const promptClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/promptPolicyClient.ts");
  const contractSource = await readText("src/api/contracts/tinyoffice-frontend-api-contracts.ts");

  assert.match(appSource, /import\("@\/prompt\/PromptPolicyPage"\)/);
  assert.match(navigationStructureSource, /view: "prompt", label: "Prompt"/);
  assert.match(appSource, /activeView === "prompt"/);
  assert.match(navigationSource, /return "\/prompt"/);
  assert.match(promptPageSource, /Company prompt configuration/);
  assert.match(promptPageSource, /Foundation prompts/);
  assert.match(promptPageSource, /Scene blocks/);
  assert.match(promptPageSource, /Loaded by/);
  assert.doesNotMatch(promptPageSource, /MetaPanel title="Boundary"/);
  assert.doesNotMatch(promptPageSource, /No diagnostics/);
  assert.doesNotMatch(promptPageSource, /runtime_default/);
  assert.match(promptClientSource, /companyPromptPolicyPath/);
  assert.match(promptClientSource, /promptPolicyTemplatePath/);
  assert.match(promptClientSource, /promptPolicyBlockPath/);
  assert.match(contractSource, /export type PromptPolicyViewModel =/);
  assert.doesNotMatch(promptPageSource, /savePromptPolicyConfig/);
  assert.doesNotMatch(promptPageSource, /Advanced JSON/);
  assert.doesNotMatch(promptPageSource, /scene binding matrix/i);
});

test("shadcn app shell keeps read-only Capabilities and operational Health in Admin", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const navigationStructureSource = await readText("apps/tinyoffice-web-shadcn/src/app/navigationStructure.ts");
  const navigationSource = await readText("apps/tinyoffice-web-shadcn/src/app/navigationRoutes.ts");
  const capabilitiesPageSource = await readText("apps/tinyoffice-web-shadcn/src/capabilities/CapabilitiesPage.tsx");
  const accessPageSource = await readText("apps/tinyoffice-web-shadcn/src/access/AccessPage.tsx");
  const doctorPageSource = await readText("apps/tinyoffice-web-shadcn/src/doctor/DoctorPage.tsx");
  const accessClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/accessClient.ts");
  const doctorClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/doctorClient.ts");
  const contractSource = await readText("src/api/contracts/tinyoffice-frontend-api-contracts.ts");

  assert.match(appSource, /import\("@\/access\/AccessPage"\)/);
  assert.match(appSource, /import\("@\/doctor\/DoctorPage"\)/);
  assert.doesNotMatch(appSource, /useDeveloperModePreference|developerMode\.enabled/);
  assert.match(navigationStructureSource, /view: "access", label: "Access"/);
  assert.match(navigationStructureSource, /view: "doctor", label: "Health"/);
  assert.match(appSource, /isAdminView\(activeView\)/);
  assert.match(appSource, /activeView === "access"/);
  assert.match(appSource, /activeView === "capabilities"/);
  assert.match(navigationStructureSource, /view: "capabilities", label: "Capabilities"/);
  assert.match(capabilitiesPageSource, /Read only/);
  assert.match(navigationSource, /return "\/access"/);
  assert.match(navigationSource, /return "\/doctor"/);
  assert.match(accessPageSource, /Company access policy/);
  assert.match(accessPageSource, /Rule groups/);
  assert.match(accessPageSource, /Runtime boundary/);
  assert.match(accessPageSource, /Advanced policy JSON/);
  assert.match(accessPageSource, /grid-cols-\[300px_minmax\(0,1fr\)\]/);
  assert.match(accessPageSource, /policyJson/);
  assert.doesNotMatch(accessPageSource, /Decision preview|Pending requests|Manual check|Policy tools|Preview is available/);
  assert.doesNotMatch(accessPageSource, /previewExamples|onExample|previewAccessDecision/);
  assert.match(accessClientSource, /companyAccessPath/);
  assert.match(accessClientSource, /getAccessRequests/);
  assert.match(accessClientSource, /resolveAccessRequest/);
  assert.match(accessClientSource, /previewAccessDecision/);
  assert.match(doctorPageSource, /Read-only diagnostics/);
  assert.match(doctorPageSource, /Next steps/);
  assert.match(doctorPageSource, /getDoctorReport/);
  assert.doesNotMatch(doctorPageSource, /policyJson|JSON\.stringify|raw JSON/i);
  assert.match(doctorClientSource, /companyDoctorPath/);
  assert.match(contractSource, /export type ToolSafetyViewModel =/);
  assert.match(contractSource, /TinyOfficeDoctorReport/);
  assert.doesNotMatch(accessPageSource, /Policy truth|Request boundary|Runtime scope|No diagnostics|Loaded by|route|viewModelJsonPath|policyPath/);
  assert.doesNotMatch(accessPageSource, /RBAC|Role matrix|Channel permissions|Employee permissions|Approval grants/);
});

test("shadcn Settings owns account profile without a developer mode switch", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const companyPageSource = await readText("apps/tinyoffice-web-shadcn/src/app/CompanyLifecyclePage.tsx");
  const settingsPageSource = await readText("apps/tinyoffice-web-shadcn/src/settings/SettingsPage.tsx");
  const navigationSource = await readText("apps/tinyoffice-web-shadcn/src/app/navigationRoutes.ts");

  assert.match(appSource, /import\("@\/settings\/SettingsPage"\)/);
  assert.match(appSource, /label="Settings"/);
  assert.match(appSource, /activeView === "settings"/);
  assert.doesNotMatch(appSource, /developerMode=/);
  assert.match(navigationSource, /return "\/settings"/);
  assert.match(settingsPageSource, /My Profile/);
  assert.match(settingsPageSource, /Display name/);
  assert.match(settingsPageSource, /Company role/);
  assert.match(settingsPageSource, /saveMyProfile/);
  assert.match(settingsPageSource, /Updates/);
  assert.match(settingsPageSource, /Check for updates/);
  assert.match(settingsPageSource, /Back up and install/);
  assert.match(settingsPageSource, /installApprovedUpdate/);
  assert.doesNotMatch(settingsPageSource, /Developer mode|Developer tools menu|aria-pressed/);
  assert.doesNotMatch(companyPageSource, /SectionHeading title="Developer mode"/);
  assert.doesNotMatch(companyPageSource, /DeveloperModePanel/);
  assert.doesNotMatch(companyPageSource, /Advanced runtime tools/);
  assert.doesNotMatch(companyPageSource, /Access is hidden from the left rail/);
  assert.doesNotMatch(companyPageSource, /debug mode/i);
});

test("shadcn Company creation does not expose a per-company owner display name override", async () => {
  const companyPageSource = await readText("apps/tinyoffice-web-shadcn/src/app/CompanyLifecyclePage.tsx");
  const companyClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/companyClient.ts");
  const contractSource = await readText("src/api/contracts/tinyoffice-frontend-api-contracts.ts");
  const createCompanyRequestBlock = contractSource.match(/export type CreateCompanyRequest = \{[\s\S]*?\n\};/)?.[0] ?? "";

  assert.doesNotMatch(companyPageSource, /Your name/);
  assert.doesNotMatch(companyPageSource, /ownerDisplayName/);
  assert.doesNotMatch(companyClientSource, /ownerDisplayName/);
  assert.doesNotMatch(companyClientSource, /ownerMemberId/);
  assert.doesNotMatch(createCompanyRequestBlock, /ownerDisplayName/);
  assert.doesNotMatch(createCompanyRequestBlock, /ownerMemberId/);
});

test("shadcn Company lifecycle page does not expose a manual refresh button", async () => {
  const companyPageSource = await readText("apps/tinyoffice-web-shadcn/src/app/CompanyLifecyclePage.tsx");

  assert.doesNotMatch(companyPageSource, /RefreshCw/);
  assert.doesNotMatch(companyPageSource, />\s*Refresh\s*</);
  assert.doesNotMatch(companyPageSource, /companiesQuery\.refetch/);
});

test("shadcn Company creation exposes System AI model setup as a separate configured model", async () => {
  const companyPageSource = await readText("apps/tinyoffice-web-shadcn/src/app/CompanyLifecyclePage.tsx");
  const companyClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/companyClient.ts");
  const contractSource = await readText("src/api/contracts/tinyoffice-frontend-api-contracts.ts");
  const createCompanyRequestBlock = contractSource.match(/export type CreateCompanyRequest = \{[\s\S]*?\n\};/)?.[0] ?? "";

  assert.match(createCompanyRequestBlock, /systemAiRuntime\?:/);
  assert.match(companyClientSource, /systemAiRuntime/);
  assert.match(companyPageSource, /System AI model/);
  assert.match(companyPageSource, /Tooltip/);
  assert.match(companyPageSource, /Info/);
  assert.match(companyPageSource, /title generation/i);
  assert.match(companyPageSource, /systemAiRuntime/);
  assert.match(companyPageSource, /systemAiModelValue/);
  assert.doesNotMatch(companyPageSource, /same model/i);
});

test("shadcn Admin exposes company-level System AI settings outside Company lifecycle", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const navigationStructureSource = await readText("apps/tinyoffice-web-shadcn/src/app/navigationStructure.ts");
  const companyPageSource = await readText("apps/tinyoffice-web-shadcn/src/app/CompanyLifecyclePage.tsx");
  const companyClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/companyClient.ts");
  const systemAiSource = await readText("apps/tinyoffice-web-shadcn/src/system-ai/SystemAiPage.tsx");

  assert.match(companyClientSource, /saveCompanySystemAiSettings/);
  assert.match(navigationStructureSource, /view: "system-ai", label: "System AI"/);
  assert.match(appSource, /activeView === "system-ai"/);
  assert.match(systemAiSource, /Chat title generation/);
  assert.match(systemAiSource, /Topic summaries/);
  assert.match(systemAiSource, /saveCompanySystemAiSettings/);
  assert.match(systemAiSource, /Set later/);
  assert.doesNotMatch(companyPageSource, /SectionHeading title="System AI"|saveCompanySystemAiSettings|Chat title generation|Topic summaries/);
});

test("shadcn Integrations page exposes Intake discovery without an Intake operations queue", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const navigationStructureSource = await readText("apps/tinyoffice-web-shadcn/src/app/navigationStructure.ts");
  const navigationSource = await readText("apps/tinyoffice-web-shadcn/src/app/navigationRoutes.ts");
  const companySource = await readText("apps/tinyoffice-web-shadcn/src/app/CompanyLifecyclePage.tsx");
  const source = await readText("apps/tinyoffice-web-shadcn/src/integrations/IntegrationsPage.tsx");

  assert.match(navigationStructureSource, /view: "integrations", label: "Integrations"/);
  assert.match(appSource, /activeView === "integrations"/);
  assert.match(navigationSource, /return "\/integrations"/);
  assert.match(source, /External Intake/);
  assert.match(source, /Ask AI to set it up/);
  assert.match(source, /href="\/chat"/);
  assert.doesNotMatch(source, /intent=intake-setup/);
  assert.match(source, /Monitoring alerts/);
  assert.doesNotMatch(source, /intake\/events|targetMemberId|sourceEventId|Copy JSON|POST endpoint/);
  assert.doesNotMatch(source, /Intake queue|Manage intake sources/);
  assert.doesNotMatch(companySource, /Intake \/ External inputs|intake\/events|Minimum event example/);
});

test("shadcn Company page keeps company list and selected company settings in a two-column workspace", async () => {
  const companyPageSource = await readText("apps/tinyoffice-web-shadcn/src/app/CompanyLifecyclePage.tsx");

  assert.match(companyPageSource, /NewCompanyDialog/);
  assert.match(companyPageSource, /xl:grid-cols-\[minmax\(360px,440px\)_minmax\(0,1fr\)\]/);
  assert.match(companyPageSource, /<h2 className="text-base font-semibold leading-tight">Companies<\/h2>[\s\S]*<CompanySettingsPanel/);
  assert.match(companyPageSource, /<SectionHeading title="Identity" \/>[\s\S]*<DangerZone/);
  assert.doesNotMatch(companyPageSource, /<SectionHeading title="System AI" \/>/);
  assert.doesNotMatch(companyPageSource, /<SectionHeading title="Developer mode" \/>/);
  assert.doesNotMatch(companyPageSource, /<CreateCompanyPanel[\s\S]*<CompanySettingsPanel/);
});

test("shadcn Company deletion requires a destructive confirmation dialog after typed confirmation", async () => {
  const companyPageSource = await readText("apps/tinyoffice-web-shadcn/src/app/CompanyLifecyclePage.tsx");

  assert.match(companyPageSource, /Dialog/);
  assert.match(companyPageSource, /DialogContent/);
  assert.match(companyPageSource, /DialogTitle/);
  assert.match(companyPageSource, /DialogDescription/);
  assert.match(companyPageSource, /Delete company permanently/);
  assert.match(companyPageSource, /Type DELETE to remove \{company\.displayName\}\. This action cannot be undone\./);
  assert.match(companyPageSource, /I understand, delete company/);
  assert.match(companyPageSource, /handleDeleteDialogOpenChange/);
  assert.match(companyPageSource, /setConfirmationText\(""\)/);
  assert.doesNotMatch(companyPageSource, /onClick=\{\(\) => onDelete\(confirmationText\)\}/);
});

test("shadcn chat data orchestration lives in a chat workspace hook", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const chatRouteSource = await readText("apps/tinyoffice-web-shadcn/src/chat/ChatWorkspaceRoute.tsx");
  const hookPath = "apps/tinyoffice-web-shadcn/src/chat/useChatWorkspace.ts";

  assert.equal(existsSync(path.join(repoRoot, hookPath)), true, `${hookPath} must exist`);
  assert.match(appSource, /import\("@\/chat\/ChatWorkspaceRoute"\)/);
  assert.doesNotMatch(appSource, /useChatWorkspace\(/);
  assert.match(chatRouteSource, /from "@\/chat\/useChatWorkspace"/);
  assert.match(chatRouteSource, /useChatWorkspace\(/);
  assert.match(appSource, /getCurrentSession/);
  assert.doesNotMatch(appSource, /getChatProjection/);
  assert.doesNotMatch(appSource, /getCompanyDirectory/);
  assert.doesNotMatch(appSource, /listChatRoomMessages/);
  assert.doesNotMatch(appSource, /markChatRoomRead/);
  assert.doesNotMatch(appSource, /createChatEntry/);
  assert.doesNotMatch(appSource, /sendChatRoomMessage/);
  assert.doesNotMatch(appSource, /function createEntryFromSelectedContainer/);
  assert.doesNotMatch(appSource, /function sendReplyToSelectedRoom/);
  assert.doesNotMatch(appSource, /function requiredTinyOfficeValue/);
});

test("frontend routes split product pages and isolate Chat lifecycle from the app shell", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const chatRouteSource = await readText("apps/tinyoffice-web-shadcn/src/chat/ChatWorkspaceRoute.tsx");
  const viteSource = await readText("apps/tinyoffice-web-shadcn/vite.config.ts");
  const packageJson = await readJson<{ scripts?: Record<string, string> }>("apps/tinyoffice-web-shadcn/package.json");

  assert.match(appSource, /lazy\(\(\) => import\("@\/tasks\/TasksPage"\)/);
  assert.match(appSource, /lazy\(\(\) => import\("@\/settings\/SettingsPage"\)/);
  assert.match(appSource, /lazy\(\(\) => import\("@\/chat\/ChatWorkspaceRoute"\)/);
  assert.match(appSource, /<Suspense fallback=\{<RouteLoadingFallback \/>\}>/);
  assert.doesNotMatch(appSource, /useChatWorkspace\(/);
  assert.match(chatRouteSource, /useChatWorkspace\(\{ requestedRoomId: focus\.roomId, currentSession, sessionOwnedByParent: true \}\)/);
  assert.match(viteSource, /manifest: true/);
  assert.match(packageJson.scripts?.build ?? "", /check-bundle-size\.mjs/);
});

test("shadcn frontend uses TanStack Query as the server-state foundation", async () => {
  const packageJson = await readJson<{
    dependencies?: Record<string, string>;
  }>("apps/tinyoffice-web-shadcn/package.json");
  const mainSource = await readText("apps/tinyoffice-web-shadcn/src/main.tsx");
  const hookSource = await readText("apps/tinyoffice-web-shadcn/src/chat/useChatWorkspace.ts");
  const queryKeysPath = "apps/tinyoffice-web-shadcn/src/chat/chatQueryKeys.ts";

  assert.ok(packageJson.dependencies?.["@tanstack/react-query"], "new frontend server state must use TanStack Query");
  assert.equal(existsSync(path.join(repoRoot, queryKeysPath)), true, `${queryKeysPath} must exist`);
  assert.match(mainSource, /QueryClientProvider/);
  assert.match(mainSource, /new QueryClient/);
  assert.match(hookSource, /useQuery/);
  assert.match(hookSource, /useMutation/);
  assert.match(hookSource, /useQueryClient/);
  assert.match(hookSource, /chatQueryKeys/);
  assert.doesNotMatch(hookSource, /useState<LoadState>/);
  assert.doesNotMatch(hookSource, /setState/);
});

test("shadcn chat realtime invalidates TanStack Query data instead of owning server state", async () => {
  const realtimePath = "apps/tinyoffice-web-shadcn/src/chat/useChatRealtime.ts";
  const realtimeSource = await readText(realtimePath);
  const hookSource = await readText("apps/tinyoffice-web-shadcn/src/chat/useChatWorkspace.ts");

  assert.match(realtimeSource, /socket\.io-client/);
  assert.match(realtimeSource, /io\(/);
  assert.match(realtimeSource, /\/api\/realtime\/socket\.io/);
  assert.doesNotMatch(realtimeSource, /new WebSocket/);
  assert.doesNotMatch(realtimeSource, /\/api\/realtime\/ws/);
  assert.match(realtimeSource, /tinyoffice\/realtime-contracts/);
  assert.match(realtimeSource, /useQueryClient/);
  assert.match(realtimeSource, /invalidateQueries/);
  assert.match(realtimeSource, /chat\.message\.created/);
  assert.match(realtimeSource, /chat\.projection\.changed/);
  assert.match(realtimeSource, /chat\.entry\.created/);
  assert.match(realtimeSource, /chat\.read_state\.updated/);
  assert.match(realtimeSource, /company\.directory\.changed/);
  assert.match(realtimeSource, /chatQueryKeys\.directory\(companyId\)/);
  assert.doesNotMatch(realtimeSource, /chat\.runtime_status\.changed/);
  assert.doesNotMatch(realtimeSource, /chat\.process_trace\.appended/);
  assert.doesNotMatch(realtimeSource, /chat\.reply\.snapshot/);
  assert.match(hookSource, /useChatRealtime/);
  assert.doesNotMatch(realtimeSource, /setMessages|setProjection|setDirectory/);
});

test("TinyOffice realtime documentation stays aligned with the current event contract", async () => {
  const realtimeDocs = await readText("docs/technical/tinyoffice-realtime.md");

  assert.match(realtimeDocs, /viewerMemberId/);
  assert.match(realtimeDocs, /chat\.read_state\.updated/);
  assert.match(realtimeDocs, /chat\.runtime_status\.changed/);
  assert.match(realtimeDocs, /chat\.process_trace\.appended/);
  assert.match(realtimeDocs, /chat\.reply\.delta/);
  assert.match(realtimeDocs, /runId/);
  assert.match(realtimeDocs, /REST remains authoritative/);
  assert.match(realtimeDocs, /TanStack Query/);
  assert.doesNotMatch(realtimeDocs, /eventKey: string/);
});

test("shadcn chat entry list opens a draft topic before creating the persisted room", async () => {
  const productSource = await readChatProductSource();
  const chatClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/chatClient.ts");
  const contractSource = await readText("src/api/contracts/tinyoffice-frontend-api-contracts.ts");

  assert.match(contractSource, /CreateChatEntryRequest/);
  assert.match(contractSource, /CreateChatEntryResponse/);
  assert.match(chatClientSource, /createChatEntry/);
  assert.match(productSource, /createChatEntry/);
  assert.match(productSource, /<StartEntryButton/);
  assert.match(productSource, /Start new topic/);
  assert.match(productSource, /kind: "draft-entry"/);
  assert.match(productSource, /<DraftEntryPanel/);
  assert.match(productSource, /placeholder="Type a message\.\.\."/);
  assert.doesNotMatch(productSource, /placeholder=\{header\.title\}/);
  assert.match(productSource, /onCreateEntry/);
  assert.match(productSource, /created\.entry\.entryId/);
  assert.match(productSource, /kind: "entry-room"/);
  assert.doesNotMatch(productSource, /<EntryCreateComposer/);
  assert.doesNotMatch(productSource, /titleSeedFromBody/);
  assert.doesNotMatch(productSource, /title:\s*titleSeedFromBody\(body\)/);
});

test("shadcn chat entry rows stay compact and hide zero-value metadata", async () => {
  const productSource = await readChatProductSource();

  assert.doesNotMatch(productSource, /entry\.kind\.replaceAll/);
  assert.doesNotMatch(productSource, /\{entry\.unreadCount\} unread/);
  assert.doesNotMatch(productSource, /rounded-md px-4 py-3 text-left/);
  assert.doesNotMatch(productSource, /Direct room creation is not wired yet/);
  assert.doesNotMatch(productSource, /entryTitleForDisplay/);
  assert.match(productSource, /unreadCount > 0/);
  assert.match(productSource, /EntryUpdatedTime/);
  assert.match(productSource, /grid-cols-\[minmax\(0,1fr\)_5\.75rem_1\.75rem_2\.125rem\]/);
  assert.match(productSource, /min-h-5 min-w-5 items-center justify-end/);
  assert.match(productSource, /EntryListScrollerContent/);
  assert.match(productSource, /entryListScrollKey/);
  assert.doesNotMatch(productSource, /AutoScrollViewport/);
  assert.doesNotMatch(productSource, /bottomRef/);
  assert.doesNotMatch(productSource, /ResizeObserver/);
  assert.doesNotMatch(productSource, /scrollIntoView/);
  assert.match(productSource, /<MessageScrollerProvider[^>]*autoScroll/);
  assert.match(productSource, /defaultScrollPosition="end"/);
  assert.match(productSource, /<MessageScrollerItem key=\{entry\.entryId\}>/);
  assert.match(productSource, /justify-end/);
  assert.match(productSource, /role="button"/);
  assert.match(productSource, /onKeyDown=\{\(event\) =>/);
  assert.doesNotMatch(productSource, /!h-auto !min-h-0/);
});

test("shadcn chat keeps archived topics out of the active production list", async () => {
  const source = await readText("apps/tinyoffice-web-shadcn/src/chat/EntryListPanel.tsx");

  assert.match(source, /showArchived \? model\.archivedDirectoryEntries \?\? \[\] : model\.directoryEntries/);
  assert.match(source, /showArchived \? `Archived \$\{archiveNoun\}` : header\.title/);
  assert.match(source, /showArchived \? "Back to topics"/);
  assert.match(source, /<ArchivedTopicRow entry=\{entry\} onRestoreEntry=\{onRestoreEntry\}/);
  assert.doesNotMatch(source, /className="mt-6 border-t pt-4"/);
});

test("shadcn chat entry starter is available for DM contacts without existing rooms", async () => {
  const productSource = await readChatProductSource();
  const modelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/chatShellModel.ts");

  assert.match(modelSource, /chat-container-member-dm-/);
  assert.match(productSource, /activeEntryContainerId/);
  assert.match(productSource, /model\.surface\.kind === "dm-directory"/);
  assert.match(productSource, /StartEntryButton/);
  assert.match(productSource, /draft-entry/);
});

test("frontend-safe Chat contracts do not expose retired employee attachment or mention fields", async () => {
  const contractSource = await readText("src/api/contracts/tinyoffice-frontend-api-contracts.ts");
  const mentionBlock = contractSource.match(/export type MessageMentionDto = \{[\s\S]*?\};/)?.[0] ?? "";

  assert.doesNotMatch(contractSource, /ownerEmployeeId/);
  assert.match(contractSource, /ownerMemberId/);
  assert.doesNotMatch(mentionBlock, /employeeId\?:/);
  assert.match(mentionBlock, /memberId: string/);
});

test("shadcn chat message stream separates the viewer's messages from others", async () => {
  const productSource = await readChatProductSource();
  const modelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/chatShellModel.ts");
  const messagePanelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/MessagePanel.tsx");

  assert.match(modelSource, /viewerMemberId/);
  assert.doesNotMatch(modelSource, /viewerEmployeeId/);
  assert.match(productSource, /messageAlignFor/);
  assert.match(messagePanelSource, /const align = messageAlignFor\(message, model\)/);
  assert.match(messagePanelSource, /<Message align=\{align\}/);
  assert.match(productSource, /MessageStreamScrollerContent/);
  assert.match(productSource, /messageStreamScrollKey/);
  assert.doesNotMatch(productSource, /AutoScrollViewport/);
  assert.doesNotMatch(productSource, /bottomRef/);
  assert.doesNotMatch(productSource, /ResizeObserver/);
  assert.doesNotMatch(productSource, /scrollIntoView/);
  assert.match(productSource, /MessageRow/);
  assert.match(messagePanelSource, /MessageStreamStatusOverlay/);
  assert.doesNotMatch(
    messagePanelSource.match(/<MessageStreamScrollerContent>[\s\S]*?<\/MessageStreamScrollerContent>/)?.[0] ?? "",
    /No messages in this room yet|Loading messages/,
    "empty message placeholders must not participate in message scroller item or anchor calculations",
  );
  assert.doesNotMatch(productSource, /processActivity/);
  assert.doesNotMatch(messagePanelSource, /isLastPersistedMessageScrollAnchor/);
  assert.doesNotMatch(
    messagePanelSource.match(/<MessageStreamScrollerContent>[\s\S]*?<\/MessageStreamScrollerContent>/)?.[0] ?? "",
    /scrollAnchor/,
    "message stream must use bottom-follow scrolling instead of per-item anchor jumps",
  );
  assert.match(productSource, /draftStatusLabel/);
  assert.doesNotMatch(productSource, /ProcessActivityLink/);
  assert.doesNotMatch(productSource, /onSelectProcessActivity/);
  assert.doesNotMatch(productSource, /ProcessActivityInline/);
  assert.doesNotMatch(productSource, /ProcessActivityFallback/);
  assert.match(productSource, /RuntimeActivityList/);
  assert.match(productSource, /activityItems=\{workspace\.activity\.items\}/);
  assert.doesNotMatch(productSource, /ProcessTraceSection/);
  assert.doesNotMatch(productSource, /No active trace/);
  assert.doesNotMatch(productSource, /ProcessTraceDock/);
  assert.doesNotMatch(productSource, /function ProcessActivityItem/);
  assert.doesNotMatch(productSource, /Waiting for runtime activity/);
  assert.match(messagePanelSource, /variant=\{align === "end" \? "secondary" : "ghost"\}/);
});

test("shadcn chat opens rooms by marking them read and refreshing projection counters", async () => {
  const productSource = await readChatProductSource();
  const chatClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/chatClient.ts");
  const modelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/chatShellModel.ts");

  assert.match(chatClientSource, /markChatRoomRead/);
  assert.match(productSource, /markChatRoomRead/);
  assert.match(productSource, /invalidateQueries\(\{ queryKey: chatQueryKeys\.projectionScope\(companyId\) \}\)/);
  assert.doesNotMatch(modelSource, /attentionFromEntries/);
  assert.doesNotMatch(modelSource, /attention:/);
});

test("shadcn chat chrome hides noisy presence and delivery metadata", async () => {
  const productSource = await readChatProductSource();
  const modelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/chatShellModel.ts");

  assert.doesNotMatch(modelSource, /presenceMode\]\.filter/);
  assert.doesNotMatch(modelSource, /runtimeCapability\?\.presenceMode/);
  assert.doesNotMatch(productSource, /message\.deliveryState/);
  assert.doesNotMatch(productSource, /MessageFooter/);
  assert.doesNotMatch(productSource, /<MessageFooter/);
  assert.match(productSource, /MessageMeta/);
  assert.match(productSource, /formatMessageTime\(message\.createdAt\)/);
  assert.match(productSource, /<SidebarMenuButton/);
});

test("shadcn chat message meta shows runtime usage without competing with the message body", async () => {
  const productSource = await readChatProductSource();

  assert.match(productSource, /message\.runtimeUsage/);
  assert.match(productSource, /formatRuntimeUsage\(message\.runtimeUsage\)/);
  assert.match(productSource, /text-\[11px\][^"]*text-muted-foreground\/70/);
  assert.doesNotMatch(productSource, /<MarkdownMessageBody[^>]*runtimeUsage/);
});

test("shadcn chat opens message activity from the reply block and labels the context source", async () => {
  const messagePanelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/MessagePanel.tsx");
  const contextPanelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/ContextPanel.tsx");
  const activitySourceSource = await readText("apps/tinyoffice-web-shadcn/src/chat/messageActivitySource.ts");

  assert.match(messagePanelSource, /<MessageContent[\s\S]*?role=\{activitySource \? "button" : undefined\}/);
  assert.match(messagePanelSource, /<MessageContent[\s\S]*?aria-pressed=\{activitySource \? isActivitySourceSelected : undefined\}/);
  assert.match(messagePanelSource, /<MessageContent[\s\S]*?onClick=\{activitySource \? handleActivityClick : undefined\}/);
  assert.doesNotMatch(messagePanelSource, /cursor-pointer/);
  assert.doesNotMatch(messagePanelSource, /\{activitySource\.label\}/);
  assert.doesNotMatch(activitySourceSource, /label: "Activity"/);
  assert.match(contextPanelSource, /activitySource\.senderName/);
  assert.match(contextPanelSource, /formatActivitySourceTime\(activitySource\.createdAt\)/);
});

test("shadcn chat topics show activity time and messages render markdown", async () => {
  const packageJson = await readJson<{
    dependencies?: Record<string, string>;
  }>("apps/tinyoffice-web-shadcn/package.json");
  const productSource = await readChatProductSource();

  assert.ok(packageJson.dependencies?.["react-markdown"], "message bodies should use a mature Markdown renderer");
  assert.match(productSource, /formatRelativeTime\(entry\.updatedAt\)/);
  assert.match(productSource, /Last updated/);
  assert.doesNotMatch(productSource, /Active \{formatRelativeTime\(entry\.updatedAt\)\}/);
  assert.doesNotMatch(productSource, /formatCompactDate\(entry\.updatedAt\)/);
  assert.match(productSource, /ReactMarkdown/);
  assert.match(productSource, /<MarkdownMessageBody body=\{message\.body\} \/>/);
  assert.doesNotMatch(productSource, /<BubbleContent[^>]*>\s*\{message\.body\}\s*<\/BubbleContent>/s);
});

test("shadcn context panel renders product states instead of debug facts", async () => {
  const contextPanelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/ContextPanel.tsx");
  const modelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/chatShellModel.ts");

  assert.match(modelSource, /kind: "workspace" \| "channel" \| "member-dm" \| "thread"/);
  assert.match(modelSource, /selectedDirectoryMember/);
  assert.match(contextPanelSource, /model\.context\.room\.kind/);
  assert.match(contextPanelSource, /model\.context\.room\.subtitle/);
  assert.match(contextPanelSource, /ChannelContextHeader/);
  assert.match(contextPanelSource, /DirectMessageContextHeader/);
  assert.match(contextPanelSource, /SummarySection/);
  assert.match(contextPanelSource, /shouldShowParticipants\(model\)/);
  assert.match(contextPanelSource, /participantSessionsByMemberId\(model\)/);
  assert.match(contextPanelSource, /message\.runtimeLinks/);
  assert.match(contextPanelSource, /Session/);
  assert.match(contextPanelSource, /onOpenSession\?\.\(/);
  assert.doesNotMatch(contextPanelSource, /EvidenceSection title="Sessions"/);
  assert.match(contextPanelSource, /model\.context\.room\.kind === "channel" \|\| model\.context\.room\.kind === "thread"/);
  assert.match(contextPanelSource, /ContextText/);
  assert.match(contextPanelSource, /EvidenceTarget/);
  assert.match(contextPanelSource, /min-w-0 max-w-full overflow-hidden/);
  assert.match(contextPanelSource, /flex-wrap/);
  assert.match(contextPanelSource, /\[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(modelSource, /row\("Your role"/);
  assert.doesNotMatch(contextPanelSource, />Context</);
  assert.doesNotMatch(contextPanelSource, />Facts</);
  assert.doesNotMatch(contextPanelSource, />None</);
  assert.doesNotMatch(contextPanelSource, />Process traces</);
  assert.doesNotMatch(contextPanelSource, /model\.context\.room\.title/);
  assert.doesNotMatch(modelSource, /row\("Purpose"/);
  assert.doesNotMatch(modelSource, /row\("Members"/);
  assert.match(contextPanelSource, /items\.length === 0/);
});

test("shadcn context panel renders directory-only direct message members", async () => {
  const contextPanelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/ContextPanel.tsx");

  assert.match(contextPanelSource, /model\.surface\.kind === "dm-directory"/);
  assert.match(contextPanelSource, /model\.surface\.memberId/);
  assert.match(contextPanelSource, /model\.directoryMembers\.find/);
});

test("shadcn Chat uses employee runtime summary only as lightweight Chat context", async () => {
  const productSource = await readChatProductSource();
  const workspaceSource = await readText("apps/tinyoffice-web-shadcn/src/chat/useChatWorkspace.ts");
  const modelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/chatShellModel.ts");
  const sidebarSource = await readText("apps/tinyoffice-web-shadcn/src/chat/WorkspaceSidebar.tsx");
  const contextPanelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/ContextPanel.tsx");
  const directMessageWorkSummarySource = contextPanelSource.match(/function DirectMessageWorkSummary[\s\S]*?function ActivityDock/)?.[0] ?? "";
  const apiSource = await readText("apps/tinyoffice-web-shadcn/src/api/employeeRuntimeSummaryClient.ts");
  const pathSource = await readText("apps/tinyoffice-web-shadcn/src/api/tinyofficePaths.ts");

  assert.match(apiSource, /getEmployeeRuntimeSummary/);
  assert.match(pathSource, /companyEmployeeRuntimeSummaryPath/);
  assert.match(pathSource, /companyEmployeesPath\(companyId\)}\/runtime-summary/);
  assert.match(workspaceSource, /getEmployeeRuntimeSummary/);
  assert.match(workspaceSource, /chatQueryKeys\.employeeRuntimeSummary/);
  assert.match(modelSource, /employeeRuntimeSummary\?: EmployeeRuntimeSummaryViewModel/);
  assert.match(modelSource, /runtimeStatus\?: EmployeeRuntimeSummaryCard\["status"\]/);
  assert.match(sidebarSource, /NavigationRuntimeStatusIndicator/);
  assert.match(sidebarSource, /status\.kind === "idle"/);
  assert.doesNotMatch(sidebarSource, /\{status\.label\}<\/SidebarMenuBadge>/);
  assert.match(contextPanelSource, /DirectMessageWorkSummary/);
  assert.match(contextPanelSource, /runtimeSummaryForMember/);
  assert.match(contextPanelSource, /model\.surface\.kind === "dm-directory"/);
  assert.match(contextPanelSource, /tasksHref/);
  assert.match(directMessageWorkSummarySource, /Blocked work/);
  assert.match(directMessageWorkSummarySource, /Open task/);
  assert.match(contextPanelSource, /summary\.issues\.slice\(0, 1\)/);
  assert.match(contextPanelSource, /summary\.status\.kind !== "idle" && issues\.length === 0/);
  assert.doesNotMatch(directMessageWorkSummarySource, /Needs attention|Open session/);
  assert.doesNotMatch(directMessageWorkSummarySource, /\{issue\.target\.label \?\? issue\.target\.kind\}: \{issue\.target\.id\}/);
  assert.doesNotMatch(productSource, /Active \d+m|formatRelativeTime\(.*runtimeStatus|modelProvider|modelId|thinkingLevel|detailSections|statusOptions|sortOptions/);
});

test("shadcn Chat exposes Channel settings without role-edit controls", async () => {
  const productSource = await readChatProductSource();
  const chatClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/chatClient.ts");

  assert.match(chatClientSource, /updateChatChannelDetails/);
  assert.match(chatClientSource, /addChatChannelMembers/);
  assert.match(chatClientSource, /removeChatChannelMember/);
  assert.match(productSource, /ChannelSettingsDialog/);
  assert.match(productSource, /Manage channel/);
  assert.match(productSource, /Add members/);
  assert.match(productSource, /Remove/);
  assert.match(productSource, /selectedContainer\?\.chatChannelId/);
  assert.doesNotMatch(productSource, /selectedContainer\?\.containerId, "chatChannelId"/);
  assert.doesNotMatch(productSource, /updateChatChannelMemberRole|Change role|RoleSelect/);
});

test("shadcn Chat exposes Channel creation and hard-delete dissolve controls", async () => {
  const productSource = await readChatProductSource();
  const chatClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/chatClient.ts");

  assert.match(chatClientSource, /createChatChannel/);
  assert.match(chatClientSource, /dissolveChatChannel/);
  assert.match(productSource, /CreateChannelDialog/);
  assert.match(productSource, /Create channel/);
  assert.match(productSource, /DissolveChannelDialog/);
  assert.match(productSource, /Dissolve permanently/);
  assert.match(productSource, /placeholder="DELETE"/);
  assert.match(productSource, /confirmation !== "DELETE"/);
  assert.match(productSource, /I understand, dissolve Channel/);
  assert.match(productSource, /setOpen\(false\)/);
  assert.doesNotMatch(productSource, /confirmation === channel\.title/);
});

test("shadcn chat room composer sends real replies through the API client", async () => {
  const productSource = await readChatProductSource();
  const chatClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/chatClient.ts");

  assert.match(chatClientSource, /sendChatRoomMessage/);
  assert.match(productSource, /sendChatRoomMessage/);
  assert.match(productSource, /RoomReplyComposer/);
  assert.match(productSource, /onSendReply/);
  assert.match(productSource, /sendReplyToSelectedRoom/);
  assert.match(productSource, /placeholder="Type a message\.\.\."/);
  assert.doesNotMatch(productSource, /placeholder=\{model\.selectedEntry \? `Message \$\{model\.selectedEntry\.title\}` : "Select a room"\}/);
  assert.doesNotMatch(productSource, /<Textarea placeholder=\{model\.selectedEntry \? `Message \$\{model\.selectedEntry\.title\}` : "Select a room"\} rows=\{3\} disabled \/>/);
});

test("shadcn chat composer uploads image attachments before sending messages", async () => {
  const composerSource = await readText("apps/tinyoffice-web-shadcn/src/chat/Composer.tsx");
  const hookSource = await readText("apps/tinyoffice-web-shadcn/src/chat/useChatWorkspace.ts");
  const chatClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/chatClient.ts");

  assert.match(chatClientSource, /uploadChatImageAttachment/);
  assert.match(chatClientSource, /FormData/);
  assert.match(chatClientSource, /viewerQuery/);
  assert.match(composerSource, /type="file"/);
  assert.match(composerSource, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(composerSource, /onPaste=\{handlePaste\}/);
  assert.match(composerSource, /uploadChatImageAttachment/);
  assert.match(composerSource, /buildComposerSubmitValue/);
  assert.match(composerSource, /uploadedAttachmentIds/);
  assert.match(composerSource, /const canSend = Boolean\(submitValue\)/);
  assert.doesNotMatch(composerSource, /!trimmedDraft/);
  assert.match(hookSource, /attachmentIds: value\.attachmentIds/);
});

test("shadcn chat composer groups toolbar affordances and can disable images", async () => {
  const composerSource = await readText("apps/tinyoffice-web-shadcn/src/chat/Composer.tsx");
  const messagePanelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/MessagePanel.tsx");
  const draftEntryPanelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/DraftEntryPanel.tsx");

  assert.match(composerSource, /imageAttachmentsEnabled/);
  assert.match(composerSource, /aria-label="Attach image"/);
  assert.match(composerSource, /aria-label="Attach file"/);
  assert.match(composerSource, /disabled=\{!imageAttachmentsEnabled/);
  assert.match(composerSource, /ImageIcon/);
  assert.match(composerSource, /PaperclipIcon/);
  assert.match(composerSource, /composer-toolbar-actions/);
  assert.match(composerSource, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(messagePanelSource, /imageAttachmentsEnabled=\{model\.imageAttachmentsEnabled\}/);
  assert.match(draftEntryPanelSource, /imageAttachmentsEnabled=\{model\.imageAttachmentsEnabled\}/);
});

test("shadcn chat message stream renders sent image attachment thumbnails", async () => {
  const messagePanelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/MessagePanel.tsx");

  assert.match(messagePanelSource, /function MessageAttachments/);
  assert.match(messagePanelSource, /attachment\.mimeType\.startsWith\("image\/"\)/);
  assert.match(messagePanelSource, /attachment\.previewUrl/);
  assert.match(messagePanelSource, /<MessageAttachments attachments=\{message\.attachments\} align=\{align\} \/>/);
  assert.match(messagePanelSource, /align === "end" \? "justify-end" : "justify-start"/);
});

test("shadcn chat composer offers inline and toolbar mention selection without losing focus", async () => {
  const composerSource = await readText("apps/tinyoffice-web-shadcn/src/chat/Composer.tsx");

  assert.match(composerSource, /PopoverAnchor/);
  assert.match(composerSource, /PopoverContent/);
  assert.match(composerSource, /CommandList/);
  assert.match(composerSource, /CommandItem/);
  assert.match(composerSource, /textareaRef/);
  assert.match(composerSource, /textareaRef\.current\?\.focus\(\)/);
  assert.match(composerSource, /selectedMentionCandidates/);
  assert.match(composerSource, /AtSignIcon/);
  assert.match(composerSource, /aria-label="Mention someone"/);
  assert.match(composerSource, /ensureMentionStarter/);
  assert.match(composerSource, /openMentionPicker/);
  assert.match(composerSource, /window\.addEventListener\("focus"/);
  assert.match(composerSource, /hadComposerFocusRef/);
  assert.match(composerSource, /buildComposerSubmitValue\(\{\s*draft,\s*uploadedAttachmentIds,\s*mentionCandidates,\s*selectedMentionCandidates,\s*\}\)/);
  assert.doesNotMatch(composerSource, />\s*Mention\s*</);
  assert.doesNotMatch(composerSource, /DropdownMenu/);
});

test("shadcn chat title editing uses the backend room-title API and mutation state", async () => {
  const productSource = await readChatProductSource();
  const chatClientSource = await readText("apps/tinyoffice-web-shadcn/src/api/chatClient.ts");

  assert.match(chatClientSource, /updateChatRoomTitle/);
  assert.match(chatClientSource, /\/title/);
  assert.match(productSource, /updateChatRoomTitle/);
  assert.match(productSource, /updateTitleMutation/);
  assert.match(productSource, /Dialog/);
  assert.match(productSource, /EditIcon/);
  assert.match(productSource, /onUpdateTitle/);
  assert.match(productSource, /invalidateChatWorkspace\(queryClient, companyId, model\.selectedRoomId\)/);
  assert.doesNotMatch(productSource, /entryTitleForDisplay|titleSeedFromBody/);
});

test("shadcn context and directory surfaces avoid frontend fallback guesses", async () => {
  const productSource = await readChatProductSource();
  const modelSource = await readText("apps/tinyoffice-web-shadcn/src/chat/chatShellModel.ts");
  const sidebarSource = await readText("apps/tinyoffice-web-shadcn/src/chat/WorkspaceSidebar.tsx");

  assert.match(productSource, /<ScrollArea/);
  assert.doesNotMatch(modelSource, /participantFromDirectoryMember/);
  assert.doesNotMatch(modelSource, /directoryMembers \?\? \[\]\)\.slice\(0, 6\)/);
  assert.doesNotMatch(modelSource, /containerId\.includes\(memberId\)/);
  assert.doesNotMatch(modelSource, /title === displayName/);
  assert.doesNotMatch(modelSource, /title === role/);
  assert.doesNotMatch(modelSource, /normalizeMatcher/);
  assert.doesNotMatch(modelSource, /dmContainerIdsForMember/);
  assert.doesNotMatch(modelSource, /member\.employeeId/);
  assert.doesNotMatch(modelSource, /displayName\s*\?\?\s*memberId/);
  assert.doesNotMatch(modelSource, /displayName\s*\|\|\s*memberId/);
  assert.doesNotMatch(productSource, /displayName:\s*member\.displayName\s*\?\?\s*member\.memberId/);
  assert.match(modelSource, /dmContainerIdForMember/);
  assert.doesNotMatch(sidebarSource, /member\.employeeId/);
  assert.doesNotMatch(sidebarSource, /member\.displayName\s*\?\?\s*member\.memberId/);
  assert.match(sidebarSource, /member:\$\{member\.memberId\}/);
});

test("shadcn chat thread header hides internal room identifiers", async () => {
  const chatRouteSource = await readText("apps/tinyoffice-web-shadcn/src/chat/ChatWorkspaceRoute.tsx");
  const productSource = await readChatProductSource();

  assert.doesNotMatch(productSource, /TinyOffice - \$\{model\.selectedRoomId\}/);
  assert.doesNotMatch(productSource, /Room \$\{model\.selectedRoomId\}/);
  assert.doesNotMatch(productSource, /conversation-/);
  assert.match(chatRouteSource, /document\.title = browserTitleFor\(model\)/);
  assert.match(productSource, /browserTitleFor/);
  assert.match(productSource, /threadSubtitleFor/);
  assert.match(productSource, /threadTitleFor/);
  assert.match(productSource, /return model\.selectedEntry\.title/);
});

test("management navigation uses one hierarchy language and hover-capable rail menus", async () => {
  const appSource = await readText("apps/tinyoffice-web-shadcn/src/app/App.tsx");
  const selectionSource = await readText("apps/tinyoffice-web-shadcn/src/components/product/SelectionList.tsx");
  const promptSource = await readText("apps/tinyoffice-web-shadcn/src/prompt/PromptPolicyPage.tsx");
  const cssSource = await readText("apps/tinyoffice-web-shadcn/src/index.css");

  assert.match(selectionSource, /SelectionGroupLabel/);
  assert.match(selectionSource, /SelectionRowTitle/);
  assert.match(selectionSource, /SelectionRowDescription/);
  assert.match(cssSource, /\.tiny-selection-row\[data-slot="button"\]\[data-active="true"\] \.tiny-selection-row-title/);
  assert.match(cssSource, /\[data-slot="dropdown-menu-item"\]:not\(\[data-disabled\]\):hover/);
  assert.match(cssSource, /\[data-slot="dropdown-menu-item"\]:not\(\[data-disabled\]\):active/);
  assert.match(promptSource, /className="tiny-readonly-fact" role="listitem"/);
  assert.doesNotMatch(promptSource, /key=\{item\} className="rounded-md border[^\n]+bg-\[#fffdf7\]/);
  assert.match(appSource, /function useRailHoverMenu/);
  assert.match(appSource, /onMouseEnter=\{hoverMenu\.openNow\}/);
  assert.match(appSource, /onMouseEnter=\{hoverMenu\.cancelClose\}/);
  assert.match(appSource, /onMouseLeave=\{hoverMenu\.closeSoon\}/);
  assert.match(appSource, /<DropdownMenu modal=\{false\} open=\{hoverMenu\.open\} onOpenChange=\{hoverMenu\.setOpen\}>/);
});

test("product actions share one button lifecycle and file uploads use the Button primitive", async () => {
  const cssSource = await readText("apps/tinyoffice-web-shadcn/src/index.css");
  const companySource = await readText("apps/tinyoffice-web-shadcn/src/app/CompanyLifecyclePage.tsx");
  const backupSource = await readText("apps/tinyoffice-web-shadcn/src/backup/BackupPage.tsx");
  const appSources = await readdir(path.join(appRoot, "src"), { recursive: true });
  const tsxFiles = appSources.filter((entry) => typeof entry === "string" && entry.endsWith(".tsx"));
  const productSource = (await Promise.all(tsxFiles.map((entry) => readFile(path.join(appRoot, "src", entry), "utf8")))).join("\n");

  assert.doesNotMatch(cssSource, /\[data-slot="button"\]\[data-variant="default"\][^{]*\{[^}]*background:[^;}]+!important/s);
  assert.match(cssSource, /\[data-slot="button"\]\[data-variant="default"\]:hover/);
  assert.match(companySource, /className="hidden" type="file"/);
  assert.match(companySource, /onClick=\{\(\) => logoInputRef\.current\?\.click\(\)\}/);
  assert.match(companySource, /<Upload \/>/);
  assert.match(backupSource, /<Button disabled=\{creating\}/);
  assert.doesNotMatch(productSource.replace(await readText("apps/tinyoffice-web-shadcn/src/components/ui/sidebar.tsx"), ""), /<button\b/);
});
