import { createCompany, listCompanies } from "@/api/companyClient";
import { getMyProfile, saveMyProfile } from "@/api/profileClient";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { AvatarSeedEditor } from "@/components/product/AvatarSeedEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CreateCompanyPanel } from "@/app/CompanyLifecyclePage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CheckCircle2, UserRound } from "lucide-react";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import type { OwnedCreateCompanyResult, TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";
import { useTranslation } from "react-i18next";

export function OwnerOnboardingPage({ session }: { session: TinyOfficeCurrentSession }): ReactElement {
  return (
    <TooltipProvider>
      <OwnerOnboardingContent session={session} />
    </TooltipProvider>
  );
}

function OwnerOnboardingContent({ session }: { session: TinyOfficeCurrentSession }): ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: chatQueryKeys.myProfile(), queryFn: getMyProfile });
  const companiesQuery = useQuery({ queryKey: chatQueryKeys.companies(), queryFn: listCompanies });
  const [displayName, setDisplayName] = useState("");
  const [avatarSeed, setAvatarSeed] = useState("");
  const [createdCompany, setCreatedCompany] = useState<OwnedCreateCompanyResult>();

  useEffect(() => {
    if (!profileQuery.data) return;
    setDisplayName(profileQuery.data.initialized ? profileQuery.data.displayName : "");
    setAvatarSeed(profileQuery.data.avatarSeed);
  }, [profileQuery.data]);

  const saveProfile = useMutation({
    mutationFn: () => saveMyProfile({ displayName, avatarSeed, uiLocale: profileQuery.data?.uiLocale ?? "system", uiTheme: profileQuery.data?.uiTheme ?? "sakura" }),
    onSuccess: async (profile) => {
      queryClient.setQueryData(["my-profile"], profile);
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.currentSession() });
    },
  });
  const createFirstCompany = useMutation({
    mutationFn: createCompany,
    onSuccess: async (created) => {
      setCreatedCompany(created);
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.companies() });
    },
  });

  if (session.needsProfileInitialization) {
    return (
      <OnboardingShell step={t("onboarding.step1")} title={t("onboarding.profileTitle")} description={t("onboarding.profileDescription")} icon={<UserRound />}>
        <div className="grid gap-5">
          {avatarSeed ? <AvatarSeedEditor memberId={session.user.id} displayName={displayName || t("onboarding.you")} avatarSeed={avatarSeed} disabled={saveProfile.isPending} onChange={setAvatarSeed} /> : null}
          <label className="grid gap-2 text-sm">
            <span className="font-medium">{t("onboarding.displayName")}</span>
            <Input value={displayName} maxLength={80} autoFocus onChange={(event) => setDisplayName(event.currentTarget.value)} />
            <span className="text-xs text-muted-foreground">{t("onboarding.changeLater")}</span>
          </label>
          {saveProfile.error ? <OnboardingError error={saveProfile.error} /> : null}
          <Button className="w-fit" disabled={!displayName.trim() || !avatarSeed || saveProfile.isPending} onClick={() => saveProfile.mutate()}>
            {saveProfile.isPending ? t("onboarding.saving") : t("common.continue")}
          </Button>
        </div>
      </OnboardingShell>
    );
  }

  if (createdCompany) {
    return (
      <OnboardingShell step={t("onboarding.ready")} title={t("onboarding.companyReady", { company: createdCompany.company.displayName })} description={t("onboarding.companyReadyDescription", { hr: createdCompany.hr.hrEmployeeDisplayName })} icon={<CheckCircle2 />}>
        <Button className="w-fit" onClick={() => void queryClient.invalidateQueries({ queryKey: chatQueryKeys.currentSession() })}>{t("onboarding.enterOffice")}</Button>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell step={t("onboarding.step2")} title={t("onboarding.companyTitle")} description={t("onboarding.companyDescription")} icon={<Building2 />}>
      <CreateCompanyPanel
        viewModel={companiesQuery.data}
        busy={createFirstCompany.isPending}
        title={t("onboarding.companySetup")}
        submitLabel={t("onboarding.createOffice")}
        onCreate={(input) => createFirstCompany.mutate(input)}
      />
      {createFirstCompany.error ? <OnboardingError error={createFirstCompany.error} /> : null}
    </OnboardingShell>
  );
}

function OnboardingShell({ step, title, description, icon, children }: { step: string; title: string; description: string; icon: ReactElement; children: ReactNode }): ReactElement {
  return (
    <main className="grid min-h-svh place-items-center bg-muted/20 p-5">
      <section className="w-full max-w-2xl overflow-hidden rounded-xl border bg-background shadow-sm">
        <header className="flex items-start gap-4 border-b p-6">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--tiny-info-surface)] [&_svg]:size-5">{icon}</span>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{step}</div>
            <h1 className="mt-1 text-xl font-semibold">{title}</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </section>
    </main>
  );
}

function OnboardingError({ error }: { error: Error }): ReactElement {
  return <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error.message}</p>;
}
