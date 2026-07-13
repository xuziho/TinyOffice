import type { ActionDispatchRequest } from "../contracts/action-dispatch.js";
import type { ActionResult } from "../contracts/action-result.js";
import { EmployeeDaemon } from "./employee-daemon.js";

export async function dispatchOnce<TInput, TOutput>(
  daemon: EmployeeDaemon,
  request: ActionDispatchRequest<TInput>,
): Promise<ActionResult<TOutput>> {
  return daemon.wakeAndDispatch<TInput, TOutput>(request);
}
