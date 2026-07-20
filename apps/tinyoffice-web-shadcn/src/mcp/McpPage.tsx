import { getMcpState } from "@/api/mcpClient";
import { getCompanyDirectory } from "@/api/directoryClient";
import { Badge } from "@/components/ui/badge";
import { ManagementPageHeader } from "@/components/product/ManagementPageHeader";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { useQuery } from "@tanstack/react-query";
import { PlugIcon, ServerIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";

export function McpPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const { t } = useTranslation();
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const state = useQuery({
    queryKey: chatQueryKeys.mcp(companyId),
    enabled: Boolean(companyId),
    queryFn: () => getMcpState({ companyId }),
  });
  const directory = useQuery({
    queryKey: chatQueryKeys.directory(companyId),
    enabled: Boolean(companyId),
    queryFn: () => getCompanyDirectory({ companyId }),
  });

  return <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
    <ManagementPageHeader title={t("nav.mcp")} />
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto grid max-w-6xl gap-8">
        <section>
          <SectionTitle icon={<ServerIcon />} title={t("mcpPage.servers")} />
          <div className="mt-3 divide-y border-y">
            {(state.data?.servers ?? []).map((server) => <div key={server.serverId} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="font-medium">{server.displayName}</div>
                <div className="text-sm text-muted-foreground">{server.serverId} · {server.transport}</div>
              </div>
              <Badge variant={server.enabled ? "secondary" : "outline"}>{server.enabled ? t("common.enabled") : t("common.disabled")}</Badge>
            </div>)}
            {state.data?.servers.length === 0 ? <EmptyLine text={t("mcpPage.noServers")} /> : null}
          </div>
        </section>

        <section>
          <SectionTitle icon={<PlugIcon />} title={t("mcpPage.connections")} />
          <div className="mt-3 divide-y border-y">
            {(state.data?.connections ?? []).map((connection) => <div key={connection.connectionId} className="py-3">
              <div className="font-medium">{connection.displayName}</div>
              <div className="text-sm text-muted-foreground">{connection.connectionId} · {connection.serverId}</div>
              {Object.entries(connection.resolvedEnvironment).map(([name, resolved]) => <Badge key={name} variant={resolved ? "secondary" : "destructive"} className="mr-2 mt-2">{name}: {resolved ? t("mcpPage.configured") : t("mcpPage.missing")}</Badge>)}
            </div>)}
            {state.data?.connections.length === 0 ? <EmptyLine text={t("mcpPage.noConnections")} /> : null}
          </div>
        </section>

        <section>
          <SectionTitle title={t("mcpPage.assignments")} />
          <div className="mt-3 divide-y border-y">
            {(state.data?.assignments ?? []).map((assignment) => <div key={assignment.assignmentId} className="py-3">
              <div className="font-medium">{state.data?.connections.find((item) => item.connectionId === assignment.connectionId)?.displayName ?? assignment.connectionId}</div>
              <div className="text-sm text-muted-foreground">{assignment.scopeKind === "company" ? t("mcpPage.wholeCompany") : directory.data?.directoryMembers.find((item) => item.memberId === assignment.memberId)?.displayName ?? assignment.memberId}</div>
            </div>)}
            {state.data?.assignments.length === 0 ? <EmptyLine text={t("mcpPage.noAssignments")} /> : null}
          </div>
        </section>
      </div>
    </div>
  </div>;
}

function SectionTitle({ icon, title }: { icon?: ReactElement; title: string }): ReactElement {
  return <h2 className="flex items-center gap-2 text-lg font-semibold">{icon}<span>{title}</span></h2>;
}

function EmptyLine({ text }: { text: string }): ReactElement {
  return <div className="py-4 text-sm text-muted-foreground">{text}</div>;
}
