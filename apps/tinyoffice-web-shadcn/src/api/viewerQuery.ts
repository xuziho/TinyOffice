import type { TinyOfficeContextParams } from "tinyoffice/frontend-api-contracts";

export function viewerQuery(params: TinyOfficeContextParams): string {
  const searchParams = new URLSearchParams();
  if (params.viewer?.kind === "member") {
    searchParams.set("viewerMemberId", params.viewer.memberId);
  } else if (params.memberId?.trim()) {
    searchParams.set("viewerMemberId", params.memberId.trim());
  }
  return searchParams.toString();
}
