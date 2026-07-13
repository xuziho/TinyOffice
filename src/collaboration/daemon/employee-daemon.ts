import type { ActionDispatchRequest } from "../contracts/action-dispatch.js";
import type { ActionExecutionContext } from "../contracts/action-execution-context.js";
import type { ActionResult } from "../contracts/action-result.js";
import { EmployeeRuntime } from "../runtime/employee-runtime.js";
import type { EmployeeDaemonEnvelope } from "../runtime/startup-contract.js";

export class EmployeeDaemon {
  readonly runtime: EmployeeRuntime;

  constructor(
    readonly envelope: EmployeeDaemonEnvelope,
    executionContext: ActionExecutionContext = {},
  ) {
    this.runtime = new EmployeeRuntime(envelope.runtime, executionContext);
    this.runtime.markIdle();
  }

  async wakeAndDispatch<TInput, TOutput>(
    request: ActionDispatchRequest<TInput>,
  ): Promise<ActionResult<TOutput>> {
    return this.runtime.dispatch<TInput, TOutput>(request);
  }

  shouldRemainResident(): boolean {
    return this.envelope.runtime.presenceMode === "resident";
  }

  close(): void {
    this.runtime.close();
  }
}
