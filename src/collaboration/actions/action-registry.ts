import type { ActionDispatchRequest } from "../contracts/action-dispatch.js";
import type { ActionExecutionContext } from "../contracts/action-execution-context.js";
import type { ActionResult } from "../contracts/action-result.js";
import type { EmployeeRuntimeConfig } from "../runtime/startup-contract.js";

export type ActionHandler<TInput = unknown, TOutput = unknown> = (
  runtime: EmployeeRuntimeConfig,
  request: ActionDispatchRequest<TInput>,
  executionContext: ActionExecutionContext,
) => Promise<ActionResult<TOutput>>;

export class ActionRegistry {
  private readonly handlers = new Map<string, ActionHandler<any, any>>();

  register<TInput, TOutput>(
    name: string,
    handler: ActionHandler<TInput, TOutput>,
  ): void {
    this.handlers.set(name, handler as ActionHandler<any, any>);
  }

  get<TInput = unknown, TOutput = unknown>(
    name: string,
  ): ActionHandler<TInput, TOutput> | undefined {
    return this.handlers.get(name) as
      | ActionHandler<TInput, TOutput>
      | undefined;
  }

  list(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }
}
