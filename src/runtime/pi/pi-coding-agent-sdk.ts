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

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

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
