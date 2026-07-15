import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type ComposerKeyEvent = Pick<
  ReactKeyboardEvent<HTMLTextAreaElement>,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
> & {
  nativeEvent?: {
    isComposing?: boolean;
  };
};

export function shouldSubmitComposerKey(event: ComposerKeyEvent): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.nativeEvent?.isComposing
  );
}
