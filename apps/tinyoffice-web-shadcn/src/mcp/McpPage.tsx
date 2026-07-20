import { getMcpState, saveMcpAssignment, saveMcpConnection, saveMcpServer, deleteMcpAssignment } from "@/api/mcpClient";
import { getCompanyDirectory } from "@/api/directoryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ManagementPageHeader } from "@/components/product/ManagementPageHeader";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlugIcon, ServerIcon, Trash2Icon } from "lucide-react";
import { useState, type FormEvent, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";

function objectJson(value: string, errorMessage: string): Record<string, string> {
  if (!value.trim()) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((item) => typeof item !== "string")) {
    throw new Error(errorMessage);
  }
  return parsed as Record<string, string>;
}

function stringArrayJson(value: string, errorMessage: string): string[] {
  if (!value.trim()) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(errorMessage);
  }
  return parsed;
}

export function McpPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const { t } = useTranslation();
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: chatQueryKeys.mcp(companyId), enabled: Boolean(companyId), queryFn: () => getMcpState({ companyId }) });
  const directory = useQuery({ queryKey: chatQueryKeys.directory(companyId), enabled: Boolean(companyId), queryFn: () => getCompanyDirectory({ companyId }) });
  const [error, setError] = useState("");
  const [transport, setTransport] = useState<"stdio" | "streamable_http">("stdio");
  const [assignmentScope, setAssignmentScope] = useState<"company" | "employee">("company");
  const [connectionServerId, setConnectionServerId] = useState("");
  const [assignmentConnectionId, setAssignmentConnectionId] = useState("");
  const [assignmentMemberId, setAssignmentMemberId] = useState("");

  const update = useMutation({
    mutationFn: async (action: () => ReturnType<typeof getMcpState>) => action(),
    onSuccess: (data) => { queryClient.setQueryData(chatQueryKeys.mcp(companyId), data); setError(""); },
    onError: (reason) => setError(reason instanceof Error ? reason.message : String(reason)),
  });

  function submitServer(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      update.mutate(() => saveMcpServer({ companyId, body: {
        serverId: data.get("serverId"), displayName: data.get("displayName"), transport,
        ...(transport === "stdio" ? { command: data.get("endpoint"), args: stringArrayJson(String(data.get("args") ?? ""), t("mcpPage.invalidArguments")) } : { url: data.get("endpoint") }),
        enabled: true,
      } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  function submitConnection(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      update.mutate(() => saveMcpConnection({ companyId, body: {
        connectionId: data.get("connectionId"), serverId: connectionServerId, displayName: data.get("displayName"),
        envRefs: objectJson(String(data.get("envRefs") ?? ""), t("mcpPage.invalidReferences")),
        headerRefs: objectJson(String(data.get("headerRefs") ?? ""), t("mcpPage.invalidReferences")), enabled: true,
      } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  function submitAssignment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    update.mutate(() => saveMcpAssignment({ companyId, body: {
      connectionId: assignmentConnectionId, scopeKind: assignmentScope,
      ...(assignmentScope === "employee" ? { memberId: assignmentMemberId } : {}), enabled: true,
    } }));
  }

  return <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
    <ManagementPageHeader title={t("nav.mcp")} />
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto grid max-w-6xl gap-8">
        {error ? <div className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div> : null}
        <section>
          <SectionTitle icon={<ServerIcon />} title={t("mcpPage.servers")} />
          <div className="mt-3 divide-y border-y">
            {(state.data?.servers ?? []).map((server) => <div key={server.serverId} className="flex items-center justify-between gap-4 py-3">
              <div><div className="font-medium">{server.displayName}</div><div className="text-sm text-muted-foreground">{server.serverId} · {server.transport}</div></div>
              <Badge variant={server.enabled ? "secondary" : "outline"}>{server.enabled ? t("common.enabled") : t("common.disabled")}</Badge>
            </div>)}
            {state.data?.servers.length === 0 ? <EmptyLine text={t("mcpPage.noServers")} /> : null}
          </div>
          <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={submitServer}>
            <Field label={t("mcpPage.serverId")}><Input name="serverId" required placeholder="google-workspace" /></Field>
            <Field label={t("mcpPage.displayName")}><Input name="displayName" required placeholder="Google Workspace" /></Field>
            <Field label={t("mcpPage.transport")}><Select value={transport} onValueChange={(value) => setTransport(value as typeof transport)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="stdio">stdio</SelectItem><SelectItem value="streamable_http">Streamable HTTP</SelectItem></SelectContent></Select></Field>
            <Field label={transport === "stdio" ? t("mcpPage.command") : t("mcpPage.url")}><Input name="endpoint" required placeholder={transport === "stdio" ? "npx" : "https://mcp.example.com/mcp"} /></Field>
            {transport === "stdio" ? <Field label={t("mcpPage.arguments")} className="md:col-span-2"><Input name="args" placeholder={'["-y","@example/mcp-server"]'} /></Field> : null}
            <div className="md:col-span-2"><Button type="submit" disabled={update.isPending}>{t("mcpPage.saveServer")}</Button></div>
          </form>
        </section>

        <section>
          <SectionTitle icon={<PlugIcon />} title={t("mcpPage.connections")} />
          <div className="mt-3 divide-y border-y">
            {(state.data?.connections ?? []).map((connection) => <div key={connection.connectionId} className="py-3">
              <div className="font-medium">{connection.displayName}</div><div className="text-sm text-muted-foreground">{connection.connectionId} → {connection.serverId}</div>
              {Object.entries(connection.resolvedEnvironment).map(([name, resolved]) => <Badge key={name} variant={resolved ? "secondary" : "destructive"} className="mr-2 mt-2">{name}: {resolved ? t("mcpPage.configured") : t("mcpPage.missing")}</Badge>)}
            </div>)}
            {state.data?.connections.length === 0 ? <EmptyLine text={t("mcpPage.noConnections")} /> : null}
          </div>
          <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={submitConnection}>
            <Field label={t("mcpPage.connectionId")}><Input name="connectionId" required placeholder="google-workspace-main" /></Field>
            <Field label={t("mcpPage.displayName")}><Input name="displayName" required placeholder="Google Workspace" /></Field>
            <Field label={t("mcpPage.server")}><Select value={connectionServerId} onValueChange={setConnectionServerId}><SelectTrigger className="w-full"><SelectValue placeholder={t("common.none")} /></SelectTrigger><SelectContent>{state.data?.servers.map((server) => <SelectItem key={server.serverId} value={server.serverId}>{server.displayName}</SelectItem>)}</SelectContent></Select></Field>
            <Field label={t("mcpPage.envRefs")}><Input name="envRefs" placeholder={'{"GOOGLE_TOKEN":"TINYOFFICE_GOOGLE_TOKEN"}'} /></Field>
            <Field label={t("mcpPage.headerRefs")} className="md:col-span-2"><Input name="headerRefs" placeholder={'{"Authorization":"TINYOFFICE_MCP_AUTH"}'} /></Field>
            <div className="md:col-span-2 text-xs text-muted-foreground">{t("mcpPage.secretHelp")}</div>
            <div className="md:col-span-2"><Button type="submit" disabled={update.isPending}>{t("mcpPage.saveConnection")}</Button></div>
          </form>
        </section>

        <section>
          <SectionTitle title={t("mcpPage.assignments")} />
          <div className="mt-3 divide-y border-y">
            {(state.data?.assignments ?? []).map((assignment) => <div key={assignment.assignmentId} className="flex items-center justify-between gap-4 py-3">
              <div><div className="font-medium">{state.data?.connections.find((item) => item.connectionId === assignment.connectionId)?.displayName ?? assignment.connectionId}</div><div className="text-sm text-muted-foreground">{assignment.scopeKind === "company" ? t("mcpPage.wholeCompany") : directory.data?.directoryMembers.find((item) => item.memberId === assignment.memberId)?.displayName ?? assignment.memberId}</div></div>
              <Button variant="ghost" size="icon" aria-label={t("common.remove")} onClick={() => update.mutate(() => deleteMcpAssignment({ companyId, assignmentId: assignment.assignmentId }))}><Trash2Icon /></Button>
            </div>)}
            {state.data?.assignments.length === 0 ? <EmptyLine text={t("mcpPage.noAssignments")} /> : null}
          </div>
          <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={submitAssignment}>
            <Field label={t("mcpPage.connection")}><Select value={assignmentConnectionId} onValueChange={setAssignmentConnectionId}><SelectTrigger className="w-full"><SelectValue placeholder={t("common.none")} /></SelectTrigger><SelectContent>{state.data?.connections.map((connection) => <SelectItem key={connection.connectionId} value={connection.connectionId}>{connection.displayName}</SelectItem>)}</SelectContent></Select></Field>
            <Field label={t("mcpPage.scope")}><Select value={assignmentScope} onValueChange={(value) => setAssignmentScope(value as typeof assignmentScope)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="company">{t("mcpPage.wholeCompany")}</SelectItem><SelectItem value="employee">{t("common.employee")}</SelectItem></SelectContent></Select></Field>
            {assignmentScope === "employee" ? <Field label={t("common.employee")}><Select value={assignmentMemberId} onValueChange={setAssignmentMemberId}><SelectTrigger className="w-full"><SelectValue placeholder={t("common.none")} /></SelectTrigger><SelectContent>{directory.data?.directoryMembers.filter((member) => member.hasRuntimeProfile).map((member) => <SelectItem key={member.memberId} value={member.memberId}>{member.displayName}</SelectItem>)}</SelectContent></Select></Field> : <div />}
            <div className="md:col-span-3"><Button type="submit" disabled={update.isPending}>{t("mcpPage.assign")}</Button></div>
          </form>
        </section>
      </div>
    </div>
  </div>;
}

function SectionTitle({ icon, title }: { icon?: ReactElement; title: string }): ReactElement { return <h2 className="flex items-center gap-2 text-lg font-semibold">{icon}<span>{title}</span></h2>; }
function Field({ label, className, children }: { label: string; className?: string; children: ReactElement }): ReactElement { return <label className={className}><span className="mb-1.5 block text-sm font-medium">{label}</span>{children}</label>; }
function EmptyLine({ text }: { text: string }): ReactElement { return <div className="py-4 text-sm text-muted-foreground">{text}</div>; }
