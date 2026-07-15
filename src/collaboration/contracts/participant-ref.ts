export interface ParticipantRef {
  id: string;
  displayName?: string;
  role?: string;
  participantKind?: "employee" | "company_member" | "system";
  runtimeCapable?: boolean;
  summary?: string;
  isDefaultRequester?: boolean;
  isFinalReportTarget?: boolean;
  isApprovalAuthority?: boolean;
}

export function formatHandoffCandidateForPrompt(participant: ParticipantRef): string {
  return [
    `id=${JSON.stringify(participant.id)}`,
    participant.displayName ? `displayName=${JSON.stringify(participant.displayName)}` : undefined,
    participant.role ? `role=${JSON.stringify(participant.role)}` : undefined,
    participant.summary ? `summary=${JSON.stringify(participant.summary)}` : undefined,
  ].filter((field): field is string => Boolean(field)).join("; ");
}
