export type TinyOfficeAuthMode = "production" | "development-preview";

export interface TinyOfficeCurrentMemberSession {
  companyId: string;
  memberId: string;
  displayName?: string;
  role?: string;
  source: "server-session" | "development-preview";
}

export interface TinyOfficeCurrentUserSession {
  userId: string;
  displayName?: string;
  currentCompanyId?: string;
  member?: {
    memberId: string;
    displayName?: string;
    role?: string;
  };
  source: "server-session" | "development-preview";
}

export interface TinyOfficeAuthOptions {
  mode?: TinyOfficeAuthMode;
  developmentPreviewUser?: {
    userId: string;
    displayName?: string;
  };
  developmentPreviewSession?: Omit<TinyOfficeCurrentMemberSession, "source">;
}

export interface TinyOfficeSessionResponse {
  schema: "tinyoffice-current-session";
  version: 1;
  authMode: TinyOfficeAuthMode;
  user: {
    id: string;
    displayName?: string;
  };
  currentCompanyId?: string;
  companyId?: string;
  member?: {
    memberId: string;
    displayName?: string;
    role?: string;
  };
  needsInitialization: boolean;
  source: TinyOfficeCurrentMemberSession["source"];
}

function trimmed(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

function required(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
}

export function tinyOfficeAuthMode(options?: TinyOfficeAuthOptions): TinyOfficeAuthMode {
  return options?.mode ?? "production";
}

export function currentMemberFromRequest(
  request: Request,
  options?: TinyOfficeAuthOptions,
): TinyOfficeCurrentMemberSession {
  const mode = tinyOfficeAuthMode(options);
  const headerSession = currentMemberFromHeaders(request.headers);
  if (headerSession) {
    return headerSession;
  }
  if (mode === "development-preview" && options?.developmentPreviewSession) {
    return {
      companyId: required(trimmed(options.developmentPreviewSession.companyId), "developmentPreviewSession.companyId"),
      memberId: required(trimmed(options.developmentPreviewSession.memberId), "developmentPreviewSession.memberId"),
      ...(trimmed(options.developmentPreviewSession.displayName) ? { displayName: trimmed(options.developmentPreviewSession.displayName) } : {}),
      ...(trimmed(options.developmentPreviewSession.role) ? { role: trimmed(options.developmentPreviewSession.role) } : {}),
      source: "development-preview",
    };
  }
  throw new Error("TinyOffice current member session is required");
}

export function currentUserFromRequest(
  request: Request,
  options?: TinyOfficeAuthOptions,
): TinyOfficeCurrentUserSession {
  const mode = tinyOfficeAuthMode(options);
  const headerUser = currentUserFromHeaders(request.headers);
  if (headerUser) {
    return headerUser;
  }
  const headerMember = currentMemberFromHeaders(request.headers);
  if (headerMember) {
    return currentUserFromMember(headerMember);
  }
  if (mode === "development-preview") {
    if (options?.developmentPreviewSession) {
      return currentUserFromMember({
        companyId: required(trimmed(options.developmentPreviewSession.companyId), "developmentPreviewSession.companyId"),
        memberId: required(trimmed(options.developmentPreviewSession.memberId), "developmentPreviewSession.memberId"),
        ...(trimmed(options.developmentPreviewSession.displayName) ? { displayName: trimmed(options.developmentPreviewSession.displayName) } : {}),
        ...(trimmed(options.developmentPreviewSession.role) ? { role: trimmed(options.developmentPreviewSession.role) } : {}),
        source: "development-preview",
      });
    }
    if (options?.developmentPreviewUser) {
      return {
        userId: required(trimmed(options.developmentPreviewUser.userId), "developmentPreviewUser.userId"),
        ...(trimmed(options.developmentPreviewUser.displayName) ? { displayName: trimmed(options.developmentPreviewUser.displayName) } : {}),
        source: "development-preview",
      };
    }
  }
  throw new Error("TinyOffice current user session is required");
}

export function assertCurrentMemberCompany(
  session: TinyOfficeCurrentMemberSession,
  companyId: string,
): TinyOfficeCurrentMemberSession {
  if (session.companyId !== companyId) {
    throw new Error("TinyOffice current member session company mismatch");
  }
  return session;
}

export function currentSessionResponse(
  session: TinyOfficeCurrentUserSession,
  authMode: TinyOfficeAuthMode,
): TinyOfficeSessionResponse {
  return {
    schema: "tinyoffice-current-session",
    version: 1,
    authMode,
    user: {
      id: session.userId,
      ...(session.displayName ? { displayName: session.displayName } : {}),
    },
    ...(session.currentCompanyId ? { currentCompanyId: session.currentCompanyId, companyId: session.currentCompanyId } : {}),
    ...(session.member ? { member: session.member } : {}),
    needsInitialization: !session.currentCompanyId || !session.member,
    source: session.source,
  };
}

function currentUserFromMember(session: TinyOfficeCurrentMemberSession): TinyOfficeCurrentUserSession {
  return {
    userId: session.memberId,
    ...(session.displayName ? { displayName: session.displayName } : {}),
    currentCompanyId: session.companyId,
    member: {
      memberId: session.memberId,
      ...(session.displayName ? { displayName: session.displayName } : {}),
      ...(session.role ? { role: session.role } : {}),
    },
    source: session.source,
  };
}

function currentMemberFromHeaders(headers: Headers): TinyOfficeCurrentMemberSession | undefined {
  const companyId = trimmed(headers.get("x-tinyoffice-company-id"));
  const memberId = trimmed(headers.get("x-tinyoffice-member-id"));
  if (!companyId && !memberId) {
    return undefined;
  }
  return {
    companyId: required(companyId, "x-tinyoffice-company-id"),
    memberId: required(memberId, "x-tinyoffice-member-id"),
    ...(trimmed(headers.get("x-tinyoffice-member-display-name")) ? { displayName: trimmed(headers.get("x-tinyoffice-member-display-name")) } : {}),
    ...(trimmed(headers.get("x-tinyoffice-member-role")) ? { role: trimmed(headers.get("x-tinyoffice-member-role")) } : {}),
    source: "server-session",
  };
}

function currentUserFromHeaders(headers: Headers): TinyOfficeCurrentUserSession | undefined {
  const userId = trimmed(headers.get("x-tinyoffice-user-id"));
  if (!userId) {
    return undefined;
  }
  const currentCompanyId = trimmed(headers.get("x-tinyoffice-company-id"));
  const memberId = trimmed(headers.get("x-tinyoffice-member-id"));
  const displayName = trimmed(headers.get("x-tinyoffice-user-display-name")) ||
    trimmed(headers.get("x-tinyoffice-member-display-name"));
  const memberDisplayName = trimmed(headers.get("x-tinyoffice-member-display-name")) || displayName;
  const role = trimmed(headers.get("x-tinyoffice-member-role"));
  return {
    userId,
    ...(displayName ? { displayName } : {}),
    ...(currentCompanyId ? { currentCompanyId } : {}),
    ...(memberId ? {
      member: {
        memberId,
        ...(memberDisplayName ? { displayName: memberDisplayName } : {}),
        ...(role ? { role } : {}),
      },
    } : {}),
    source: "server-session",
  };
}
