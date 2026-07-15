import { RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { newAvatarSeed } from "./employeeAvatarSource";

export function AvatarSeedEditor({ memberId, displayName, avatarSeed, disabled, onChange }: {
  memberId: string;
  displayName: string;
  avatarSeed: string;
  disabled?: boolean;
  onChange(avatarSeed: string): void;
}): ReactElement {
  const { t } = useTranslation();
  return <div className="tiny-avatar-editor flex flex-wrap items-center gap-4 rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-quiet)] p-4">
    <EmployeeAvatar memberId={memberId} avatarSeed={avatarSeed} displayName={displayName} className="size-20" />
    <div className="grid gap-2">
      <div><div className="text-sm font-medium">{t("shared.profileAvatar")}</div><p className="text-xs text-muted-foreground">{t("shared.avatarHelp")}</p></div>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange(newAvatarSeed())}>
        <RefreshCw className="size-4" />{t("shared.generateAnother")}
      </Button>
    </div>
  </div>;
}
