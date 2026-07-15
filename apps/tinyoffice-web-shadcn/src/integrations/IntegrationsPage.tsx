import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ManagementPageHeader } from "@/components/product/ManagementPageHeader";
import { ArrowRightIcon, BellRingIcon, FileInputIcon, MessageCircleIcon, PlugZapIcon, TimerIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

export function IntegrationsPage(): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex h-svh min-w-0 flex-col overflow-hidden bg-background">
      <ManagementPageHeader title={t("nav.integrations")} />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto grid max-w-5xl gap-6">
          <section className="py-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                  <PlugZapIcon className="size-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">{t("admin.externalIntake")}</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {t("admin.externalIntakeDescription")}
                  </p>
                </div>
              </div>
              <Badge variant="secondary">{t("common.available")}</Badge>
            </div>

            <div className="mt-6 grid divide-y border-y md:grid-cols-3 md:divide-x md:divide-y-0">
              <UseCase icon={<BellRingIcon />} title={t("admin.monitoringAlerts")} description={t("admin.monitoringAlertsDescription")} />
              <UseCase icon={<FileInputIcon />} title={t("admin.formsRequests")} description={t("admin.formsRequestsDescription")} />
              <UseCase icon={<TimerIcon />} title={t("admin.scheduledAutomation")} description={t("admin.scheduledAutomationDescription")} />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-md border bg-muted/20 p-4">
              <div>
                <div className="text-sm font-medium">{t("admin.askEmployee")}</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("admin.askEmployeeDescription")}
                </p>
              </div>
              <Button asChild>
                <a href="/chat">
                  <MessageCircleIcon /> {t("admin.askAiSetup")} <ArrowRightIcon />
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
    <div className="p-4">
      <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">{icon}</div>
      <h3 className="mt-3 text-sm font-medium">{title}</h3>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}
