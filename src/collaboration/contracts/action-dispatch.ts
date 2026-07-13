import type { ConversationActionContext } from "./conversation-action-context.js";

export interface ActionDispatchRequest<TInput = unknown> {
  actionName: string;
  context: ConversationActionContext;
  input: TInput;
}
