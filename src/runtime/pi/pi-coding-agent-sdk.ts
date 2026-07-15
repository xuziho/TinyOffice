import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

export {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
};

// This measures a completely idle provider connection, not total employee work time.
// Keep it bounded so a broken stream can retry while the Chat run is still actionable.
export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 120_000;

interface PiHttpDispatcherModule {
  configureHttpDispatcher(timeoutMs?: number): void;
}

export async function configureHttpDispatcher(
  timeoutMs = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): Promise<void> {
  const sdkEntryUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  const dispatcherUrl = new URL("./core/http-dispatcher.js", sdkEntryUrl);
  const dispatcher = await import(dispatcherUrl.href) as PiHttpDispatcherModule;
  dispatcher.configureHttpDispatcher(timeoutMs);
}
