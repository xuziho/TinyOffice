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
