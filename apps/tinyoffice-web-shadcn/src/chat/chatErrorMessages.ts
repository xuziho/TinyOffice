export function chatUserFacingErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/does not support image understanding|cannot understand images|unsupported-vision/i.test(message)) {
    return "This employee cannot understand images yet. The image was sent, but the current runtime provider cannot inspect it.";
  }
  return message;
}
