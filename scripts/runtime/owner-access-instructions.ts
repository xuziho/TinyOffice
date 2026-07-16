export interface OwnerAccessInstructionInput {
  publicOrigin: string;
  bootstrapToken?: string;
  localAccessTicket?: string;
}

export function buildOwnerAccessInstructions(
  input: OwnerAccessInstructionInput,
): string[] {
  const publicOrigin = input.publicOrigin.replace(/\/+$/, "");
  if (input.bootstrapToken) {
    return [
      "TinyOffice needs its first Owner passkey.",
      `Open once: ${publicOrigin}/?bootstrap=${encodeURIComponent(input.bootstrapToken)}`,
    ];
  }
  if (input.localAccessTicket) {
    return [
      "TinyOffice local Owner access is ready.",
      `Open once: ${publicOrigin}/?localAccess=${encodeURIComponent(input.localAccessTicket)}`,
    ];
  }
  return [`Open: ${publicOrigin}/`];
}

export function printOwnerAccessInstructions(
  input: OwnerAccessInstructionInput,
  write: (line: string) => void = console.log,
): void {
  for (const line of buildOwnerAccessInstructions(input)) {
    write(line);
  }
}
