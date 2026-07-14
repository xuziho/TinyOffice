export interface TinyOfficeCurrentMemberSession {
  companyId: string;
  memberId: string;
  displayName?: string;
  role?: string;
  source: "owner-session" | "test-session";
}

export interface TinyOfficeCurrentUserSession {
  userId: string;
  displayName?: string;
  profileInitialized?: boolean;
  currentCompanyId?: string;
  member?: {
    memberId: string;
    displayName?: string;
    role?: string;
  };
  source: "owner-session" | "test-session";
}

export interface TinyOfficeSessionResponse {
  schema: "tinyoffice-current-session";
  version: 2;
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
  needsProfileInitialization: boolean;
  needsCompanyInitialization: boolean;
}

export interface TinyOfficeAuthStatus {
  schema: "tinyoffice-auth-status";
  version: 2;
  accessMode: "local" | "remote";
  authenticated: boolean;
  bootstrapRequired: boolean;
  ownerConfigured: boolean;
  passkeyConfigured: boolean;
}

export interface TinyOfficeAuthProvider {
  handle(request: Request): Promise<Response>;
  resolveCurrentUser(request: Request): Promise<TinyOfficeCurrentUserSession | undefined>;
  status(request: Request): Promise<TinyOfficeAuthStatus>;
}

export class TinyOfficeAuthenticationError extends Error {
  readonly statusCode = 401;

  constructor(message = "TinyOffice Owner authentication is required") {
    super(message);
    this.name = "TinyOfficeAuthenticationError";
  }
}

const authenticatedRequests = new WeakMap<Request, TinyOfficeCurrentUserSession>();

export function bindAuthenticatedRequest(request: Request, session: TinyOfficeCurrentUserSession): void {
  authenticatedRequests.set(request, session);
}

export function currentUserFromRequest(request: Request): TinyOfficeCurrentUserSession {
  const session = authenticatedRequests.get(request);
  if (!session) {
    throw new TinyOfficeAuthenticationError();
  }
  return session;
}

export function currentMemberFromRequest(request: Request): TinyOfficeCurrentMemberSession {
  const session = currentUserFromRequest(request);
  if (!session.currentCompanyId || !session.member) {
    throw new Error("TinyOffice current member session is required");
  }
  return {
    companyId: session.currentCompanyId,
    memberId: session.member.memberId,
    ...(session.member.displayName ? { displayName: session.member.displayName } : {}),
    ...(session.member.role ? { role: session.member.role } : {}),
    source: session.source,
  };
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

export function currentSessionResponse(session: TinyOfficeCurrentUserSession): TinyOfficeSessionResponse {
  return {
    schema: "tinyoffice-current-session",
    version: 2,
    user: {
      id: session.userId,
      ...(session.displayName ? { displayName: session.displayName } : {}),
    },
    ...(session.currentCompanyId ? { currentCompanyId: session.currentCompanyId, companyId: session.currentCompanyId } : {}),
    ...(session.member ? { member: session.member } : {}),
    needsProfileInitialization: session.profileInitialized === false,
    needsCompanyInitialization: !session.currentCompanyId || !session.member,
  };
}

export function createTestAuthProvider(session: TinyOfficeCurrentUserSession): TinyOfficeAuthProvider {
  return {
    async handle() {
      return new Response("Not found", { status: 404 });
    },
    async resolveCurrentUser() {
      return session;
    },
    async status() {
      return {
        schema: "tinyoffice-auth-status",
        version: 2,
        accessMode: "local",
        authenticated: true,
        bootstrapRequired: false,
        ownerConfigured: true,
        passkeyConfigured: false,
      };
    },
  };
}
