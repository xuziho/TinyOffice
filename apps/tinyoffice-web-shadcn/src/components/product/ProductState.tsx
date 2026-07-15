import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

export function ProductState({
  title,
  description,
  icon: Icon,
  tone = "neutral",
  compact = false,
  className,
}: {
  title?: string;
  description: ReactNode;
  icon?: LucideIcon;
  tone?: "neutral" | "error";
  compact?: boolean;
  className?: string;
}): ReactElement {
  if (tone === "error") {
    return (
      <Alert variant="destructive" className={cn("tiny-product-state tiny-product-state-error", className)}>
        {Icon ? <Icon aria-hidden="true" /> : null}
        <AlertDescription>{description}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Empty
      role="status"
      aria-live="polite"
      className={cn("tiny-product-state", compact && "tiny-product-state-compact", className)}
    >
      <EmptyHeader>
        {Icon ? <EmptyMedia variant="icon"><Icon aria-hidden="true" /></EmptyMedia> : null}
        {title ? <EmptyTitle>{title}</EmptyTitle> : null}
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

