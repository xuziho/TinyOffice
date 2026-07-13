import type { CompanyDirectoryDto } from "../../collaboration/api/company-directory-api-routes.js";
import type { CompanyMemberDirectoryResponse } from "../contracts/tinyoffice-api-contracts.js";

export function projectCompanyMemberDirectoryEntries(
  directoryMembers: CompanyDirectoryDto["directoryMembers"],
): CompanyMemberDirectoryResponse["members"] {
  return directoryMembers
    .map((member) => {
      const displayName = requiredDisplayName(member.displayName, member.memberId);
      return {
        participantKind: "company_member" as const,
        memberId: member.memberId,
        avatarSeed: member.avatarSeed ?? member.memberId,
        displayName,
        ...(member.role ? { role: member.role } : {}),
        ...(member.summary ? { summary: member.summary } : {}),
        hasRuntimeProfile: member.hasRuntimeProfile,
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function requiredDisplayName(displayName: string | undefined, memberId: string): string {
  const trimmed = displayName?.trim();
  if (!trimmed) {
    throw new Error(`displayName is required for Company member ${memberId}`);
  }
  return trimmed;
}
