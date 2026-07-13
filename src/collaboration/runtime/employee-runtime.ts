import type { ActionDispatchRequest } from "../contracts/action-dispatch.js";
import type { ActionExecutionContext } from "../contracts/action-execution-context.js";
import type { ActionResult } from "../contracts/action-result.js";
import type { RuntimeStatus } from "./runtime-status.js";
import type { EmployeeRuntimeConfig } from "./startup-contract.js";
import { ActionRegistry } from "../actions/action-registry.js";

export class EmployeeRuntime {
  readonly registry = new ActionRegistry();
  private status: RuntimeStatus = "booted";

  constructor(
    readonly config: EmployeeRuntimeConfig,
    private readonly executionContext: ActionExecutionContext = {},
  ) {}

  getStatus(): RuntimeStatus {
    return this.status;
  }

  close(): void {
    this.executionContext.channelTopics?.store.close();
    this.executionContext.governance?.store.close?.();
  }

  markIdle(): void {
    this.status = "idle";
  }

  async dispatch<TInput, TOutput>(
    request: ActionDispatchRequest<TInput>,
  ): Promise<ActionResult<TOutput>> {
    const handler = this.registry.get(request.actionName);

    if (!handler) {
      return {
        status: "denied",
        reason: `Action ${request.actionName} is not registered.`,
      };
    }

    if (!this.config.mountedActions.includes(request.actionName)) {
      return {
        status: "denied",
        reason: `Action ${request.actionName} is not mounted for ${this.config.employeeId}.`,
      };
    }

    this.status = "handling_action";
    try {
      return (await handler(
        this.config,
        request,
        this.executionContext,
      )) as ActionResult<TOutput>;
    } finally {
      this.status = "idle";
    }
  }
}
