import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, BellRingIcon, FileInputIcon, MessageCircleIcon, PlugZapIcon, TimerIcon } from "lucide-react";
import type { ReactElement } from "react";
import type { TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";

export function IntegrationsPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";

  return (
    <div className="flex h-svh min-w-0 flex-col overflow-hidden bg-background">
      <header className="tiny-room-header border-b">
        <div className="min-w-0">
          <h1 className="tiny-room-title truncate">Integrations</h1>
          <p className="tiny-room-subtitle truncate">
            Connect external systems to AI employees - {companyId || "No company selected"}
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto grid max-w-5xl gap-6">
          <section className="rounded-md border bg-background p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                  <PlugZapIcon className="size-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">External Intake</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Forms, monitoring, email automation, and scheduled scripts can send events to a specific AI employee. The employee decides whether to respond, record evidence, or create a background Task.
                  </p>
                </div>
              </div>
              <Badge variant="secondary">Available</Badge>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <UseCase icon={<BellRingIcon />} title="Monitoring alerts" description="Notify an operations employee when a service needs attention." />
              <UseCase icon={<FileInputIcon />} title="Forms and requests" description="Route a new customer or internal request to the right employee." />
              <UseCase icon={<TimerIcon />} title="Scheduled automation" description="Hand generated reports or collected data to an analyst employee." />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-md border bg-muted/20 p-4">
              <div>
                <div className="text-sm font-medium">Tell an AI employee what you want to connect.</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  The employee can inspect TinyOffice's Intake contract, write the integration code, and verify the connection for you.
                </p>
              </div>
              <Button asChild>
                <a href="/chat">
                  <MessageCircleIcon /> Ask AI to set it up <ArrowRightIcon />
                </a>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function UseCase({ icon, title, description }: { icon: ReactElement; title: string; description: string }): ReactElement {
  return (
    <div className="rounded-md border p-4">
      <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">{icon}</div>
      <h3 className="mt-3 text-sm font-medium">{title}</h3>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}
