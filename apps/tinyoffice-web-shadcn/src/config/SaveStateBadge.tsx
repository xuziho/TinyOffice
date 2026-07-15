import { Badge } from "@/components/ui/badge";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

export function SaveStateBadge({ dirty, saving = false }: { dirty: boolean; saving?: boolean }): ReactElement | null {
  const { t } = useTranslation();
  if (saving) {
    return <Badge variant="secondary">{t("common.saving")}</Badge>;
  }
  return dirty ? <Badge variant="outline">{t("common.unsavedChanges")}</Badge> : null;
}
