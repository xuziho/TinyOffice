export interface RuntimeShutdownCoordinatorInput {
  terminateWeb(): void;
  closeRuntime(onClosed: () => void): void;
  exit(exitCode: number): void;
}

export interface RuntimeShutdownRequest {
  exitCode: number;
  terminateWeb: boolean;
}

export function createRuntimeShutdownCoordinator(input: RuntimeShutdownCoordinatorInput): {
  shutdown(request: RuntimeShutdownRequest): void;
} {
  let shuttingDown = false;

  return {
    shutdown(request) {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      if (request.terminateWeb) {
        input.terminateWeb();
      }
      input.closeRuntime(() => input.exit(request.exitCode));
    },
  };
}
