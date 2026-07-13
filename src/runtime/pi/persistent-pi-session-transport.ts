import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  loadEmployeeRuntimeConfig,
  type EmployeeRuntimeConfig,
} from "../company-config/employees-admin.js";
import { loadToolGuardPolicy } from "../company-config/tool-guard-admin.js";
import {
  AuthStorage,
  configureHttpDispatcher,
  createAgentSession,
  DefaultResourceLoader,
  DEFAULT_HTTP_IDLE_TIMEOUT_MS,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "./pi-coding-agent-sdk.js";
import {
  PI_EMPLOYEE_TOOL_NAMES,
  type CompanyPromptBlock,
  type EmployeeInstructionFile,
  type PiSessionTransport,
  type PiSessionTransportReplyInput,
  type PiSessionTransportStartInput,
} from "./persistent-pi-employee-agent-contracts.js";
import {
  companyScopeFromEmployeeHome,
  repoRootFromEmployeeHome,
} from "./persistent-pi-employee-agent-paths.js";
import {
  assertExplicitEmployeeRuntimeModel,
  formatCompanyPromptBlocks,
  formatEmployeeInstructionAppend,
  loadEmployeeInstructionFiles,
  loadEmployeeSkillPaths,
} from "./persistent-pi-employee-agent-prompt-resources.js";
import {
  canFallbackToSse,
  errorMessage,
  nowIso,
  PI_TRANSPORT_ENV,
  recordTransportFailure,
  recordTransportSuccess,
  resolveTransportSelection,
  type PiTransportSelection,
  type PiTransportSetting,
  writeTransportObservation,
} from "./persistent-pi-transport-state.js";

let sdkCreationChain: Promise<void> = Promise.resolve();
let piHttpDispatcherConfigured = false;

async function configurePiHttpDispatcherOnce(): Promise<void> {
  if (piHttpDispatcherConfigured) {
    return;
  }

  await configureHttpDispatcher(DEFAULT_HTTP_IDLE_TIMEOUT_MS);
  piHttpDispatcherConfigured = true;
}

async function withTemporaryEnv<T>(
  env: NodeJS.ProcessEnv,
  fn: () => Promise<T>,
): Promise<T> {
  const run = async () => {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(env)) {
      previous.set(key, process.env[key]);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    try {
      return await fn();
    } finally {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  };

  const result = sdkCreationChain.then(run, run);
  sdkCreationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export class DefaultPiSessionTransport implements PiSessionTransport {
  private session?: AgentSession;
  private activeTransport?: PiTransportSetting;
  private toolGuardEnv: NodeJS.ProcessEnv = {};
  private loadedSkillNames: string[] = [];
  private employeeInstructionFiles: EmployeeInstructionFile[] = [];

  private async createSession(
    input: PiSessionTransportStartInput,
    selection: PiTransportSelection,
  ): Promise<{
    session: AgentSession;
    employeeInstructionFiles: EmployeeInstructionFile[];
    promptBlocks: CompanyPromptBlock[];
    runtimeConfig: EmployeeRuntimeConfig;
    skillPaths: string[];
    loadedSkills: string[];
  }> {
    await mkdir(input.sessionDir, { recursive: true });
    const employeeInstructionFiles = input.employeeHomePath
      ? await loadEmployeeInstructionFiles({
          employeeHomePath: input.employeeHomePath,
          workspacePath: input.cwd,
        })
      : [];
    const skillPaths = input.employeeHomePath
      ? await loadEmployeeSkillPaths({
          employeeHomePath: input.employeeHomePath,
        })
      : [];
    const promptBlocks = input.promptBlocks || [];
    const runtimeConfig = input.employeeHomePath
      ? await loadEmployeeRuntimeConfig(companyScopeFromEmployeeHome(input.employeeHomePath))
      : { version: 1 as const, thinkingLevel: "minimal" as const };
    this.toolGuardEnv = input.employeeHomePath
      ? {
          PI_TOOL_GUARD_POLICY_JSON: JSON.stringify(
            await loadToolGuardPolicy(repoRootFromEmployeeHome(input.employeeHomePath), {
              companyId: companyScopeFromEmployeeHome(input.employeeHomePath).companyId,
            }),
          ),
        }
      : {};

    await configurePiHttpDispatcherOnce();

    const loader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir: getAgentDir(),
      noContextFiles: true,
      noSkills: true,
      additionalSkillPaths: skillPaths,
      systemPromptOverride: () => input.systemPromptAppend,
      appendSystemPromptOverride: () => [
        ...formatCompanyPromptBlocks(promptBlocks),
        ...formatEmployeeInstructionAppend(employeeInstructionFiles),
      ],
    });
    await loader.reload();
    const loadedSkills = loader.getSkills().skills
      .map((skill: { name: string }) => skill.name)
      .sort();

    const created = await withTemporaryEnv({ ...input.env, ...this.toolGuardEnv }, async () => {
      const authStorage = AuthStorage.create(path.join(getAgentDir(), "auth.json"));
      const modelRegistry = ModelRegistry.create(authStorage, path.join(getAgentDir(), "models.json"));
      const settingsManager = SettingsManager.inMemory({
        httpIdleTimeoutMs: DEFAULT_HTTP_IDLE_TIMEOUT_MS,
        transport: selection.effective,
        websocketConnectTimeoutMs: selection.websocketConnectTimeoutMs,
      });
      const configuredModelRef = input.employeeHomePath
        ? assertExplicitEmployeeRuntimeModel(path.basename(input.employeeHomePath), runtimeConfig)
        : undefined;
      const configuredModel = configuredModelRef
        ? modelRegistry.find(configuredModelRef.provider, configuredModelRef.id)
        : undefined;
      if (configuredModelRef && !configuredModel) {
        throw new Error(
          `configure-runtime-model-first: Employee ${path.basename(input.employeeHomePath || "unknown")} runtime model ${configuredModelRef.provider}/${configuredModelRef.id} is not available in the local PI configuration. Configure PI using the normal PI flow, then refresh Employee Config and save an available model.`,
        );
      }
      const { session } = await createAgentSession({
        cwd: input.cwd,
        agentDir: getAgentDir(),
        authStorage,
        modelRegistry,
        model: configuredModel,
        resourceLoader: loader,
        settingsManager,
        sessionManager: SessionManager.continueRecent(input.cwd, input.sessionDir),
        tools: [...PI_EMPLOYEE_TOOL_NAMES],
        thinkingLevel: runtimeConfig.thinkingLevel,
      });
      if (input.activeToolNames) {
        session.setActiveToolsByName(input.activeToolNames);
      }
      return session;
    });

    return {
      session: created,
      employeeInstructionFiles,
      promptBlocks,
      runtimeConfig,
      skillPaths,
      loadedSkills,
    };
  }

  async start(input: PiSessionTransportStartInput): Promise<void> {
    if (this.session) {
      return;
    }

    const selection = resolveTransportSelection({
      env: input.env,
      sessionDir: input.sessionDir,
    });
    await writeTransportObservation(input.sessionDir, {
      type: "transport_selected",
      timestamp: nowIso(),
      requested: selection.requested,
      effective: selection.effective,
      cooldownActive: selection.cooldownActive,
      cooldownUntil: selection.cooldownUntil,
      consecutiveFailures: selection.consecutiveFailures,
      maxFailures: selection.maxFailures,
      cooldownMs: selection.cooldownMs,
      websocketConnectTimeoutMs: selection.websocketConnectTimeoutMs,
    });

    const startedAt = Date.now();
    let created: Awaited<ReturnType<DefaultPiSessionTransport["createSession"]>>;
    try {
      created = await this.createSession(input, selection);
      this.activeTransport = selection.effective;
      recordTransportSuccess(input.sessionDir, selection);
      await writeTransportObservation(input.sessionDir, {
        type: "transport_success",
        timestamp: nowIso(),
        phase: "start",
        requested: selection.requested,
        effective: selection.effective,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const state = recordTransportFailure({
        sessionDir: input.sessionDir,
        selection,
      });
      await writeTransportObservation(input.sessionDir, {
        type: "transport_failure",
        timestamp: nowIso(),
        phase: "start",
        requested: selection.requested,
        effective: selection.effective,
        outputStarted: false,
        error: errorMessage(error),
        consecutiveFailures: state.consecutiveFailures,
        cooldownUntil: state.cooldownUntilMs ? new Date(state.cooldownUntilMs).toISOString() : undefined,
      });
      if (!canFallbackToSse(selection)) {
        throw error;
      }
      await writeTransportObservation(input.sessionDir, {
        type: "transport_retry_sse",
        timestamp: nowIso(),
        phase: "start",
        reason: "start failed before any assistant output",
      });
      const retrySelection = resolveTransportSelection({
        env: input.env,
        sessionDir: input.sessionDir,
        forceTransport: "sse",
      });
      created = await this.createSession(input, retrySelection);
      this.activeTransport = retrySelection.effective;
    }

    this.session = created.session;
    this.loadedSkillNames = created.loadedSkills;
    this.employeeInstructionFiles = created.employeeInstructionFiles;

  }

  async reply(input: PiSessionTransportReplyInput): Promise<{
    message: string;
    loadedSkillNames: string[];
    employeeInstructionFiles?: EmployeeInstructionFile[];
  }> {
    await this.start(input);
    const session = this.session;
    if (!session) {
      throw new Error("PI SDK session failed to initialize");
    }

    let reply = "";
    let fallbackReply: {
      message: string;
      loadedSkillNames: string[];
      employeeInstructionFiles?: EmployeeInstructionFile[];
    } | undefined;
    let outputStarted = false;
    const unsubscribe = session.subscribe((event: {
      type?: string;
      assistantMessageEvent?: {
        type?: string;
        delta?: string;
      };
    }) => {
      input.onSessionEvent?.(event);
      if (event.type === "message_update") {
        outputStarted = true;
      }
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        const delta = event.assistantMessageEvent.delta || "";
        reply += delta;
        input.onTextDelta?.(delta);
      }
    });

    const resolvedSelection = resolveTransportSelection({
      env: input.env,
      sessionDir: input.sessionDir,
    });
    const selection: PiTransportSelection = this.activeTransport
      ? { ...resolvedSelection, effective: this.activeTransport }
      : resolvedSelection;
    const startedAt = Date.now();
    try {
      const previousActiveToolNames = input.activeToolNames
        ? session.getActiveToolNames()
        : undefined;
      if (input.activeToolNames) {
        session.setActiveToolsByName(input.activeToolNames);
      }
      try {
        await withTemporaryEnv({ ...input.env, ...this.toolGuardEnv }, async () => {
          const promptOptions = input.imageInputs?.length
            ? { images: input.imageInputs }
            : undefined;
          await session.prompt(input.userPrompt, promptOptions);
        });
        recordTransportSuccess(input.sessionDir, selection);
        await writeTransportObservation(input.sessionDir, {
          type: "transport_success",
          timestamp: nowIso(),
          phase: "reply",
          requested: selection.requested,
          effective: selection.effective,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        const state = recordTransportFailure({
          sessionDir: input.sessionDir,
          selection,
        });
        await writeTransportObservation(input.sessionDir, {
          type: "transport_failure",
          timestamp: nowIso(),
          phase: "reply",
          requested: selection.requested,
          effective: selection.effective,
          outputStarted,
          error: errorMessage(error),
          consecutiveFailures: state.consecutiveFailures,
          cooldownUntil: state.cooldownUntilMs ? new Date(state.cooldownUntilMs).toISOString() : undefined,
        });
        if (outputStarted || !canFallbackToSse(selection)) {
          throw error;
        }
        await writeTransportObservation(input.sessionDir, {
          type: "transport_retry_sse",
          timestamp: nowIso(),
          phase: "reply",
          reason: "reply failed before any assistant output",
        });
        unsubscribe();
        await this.abort();
        this.session = undefined;
        fallbackReply = await this.reply({
          ...input,
          env: {
            ...input.env,
            [PI_TRANSPORT_ENV]: "sse",
          },
        });
      } finally {
        if (previousActiveToolNames) {
          session.setActiveToolsByName(previousActiveToolNames);
        }
      }
    } finally {
      unsubscribe();
    }

    return fallbackReply || {
      message: reply.trim(),
      loadedSkillNames: this.loadedSkillNames,
      employeeInstructionFiles: this.employeeInstructionFiles,
    };
  }

  async abort(): Promise<void> {
    await this.session?.abort();
    this.session = undefined;
    this.activeTransport = undefined;
  }
}
