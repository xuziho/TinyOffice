import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useMemo, type ReactElement } from "react";
import { employeeAvatarDataUri } from "./employeeAvatarSource";
import { i18n } from "@/i18n";

export function EmployeeAvatar({
  memberId,
  avatarSeed,
  displayName,
  kind = "employee",
  className,
}: {
  memberId: string;
  avatarSeed: string;
  displayName: string;
  kind?: "employee" | "member";
  className?: string;
}): ReactElement {
  const employeeImage = useMemo(() => employeeAvatarDataUri(avatarSeed), [avatarSeed]);

  return (
    <Avatar
      data-member-id={memberId}
      className={cn("tiny-employee-avatar", kind === "member" && "tiny-member-avatar", className)}
      aria-label={i18n.t("shared.avatarLabel", { name: displayName })}
    >
      {employeeImage ? <AvatarImage src={employeeImage} alt="" /> : null}
      <AvatarFallback>{initialsForName(displayName)}</AvatarFallback>
    </Avatar>
  );
}

function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "T").concat(parts[1]?.[0] ?? "").toUpperCase();
}
