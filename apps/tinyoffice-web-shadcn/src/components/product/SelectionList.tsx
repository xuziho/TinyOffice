import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";

export function SelectionList({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <div className={cn("tiny-selection-list grid gap-1", className)}>{children}</div>;
}

export function SelectionGroupLabel({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <div className={cn("tiny-selection-group-label", className)}>{children}</div>;
}

export function SelectionRowTitle({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <span className={cn("tiny-selection-row-title", className)}>{children}</span>;
}

export function SelectionRowDescription({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <span className={cn("tiny-selection-row-description", className)}>{children}</span>;
}

export function SelectionRow({
  selected,
  title,
  description,
  children,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & {
  selected: boolean;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}): ReactElement {
  const content = title === undefined ? children : (
    <span className="min-w-0">
      <SelectionRowTitle className="block truncate">{title}</SelectionRowTitle>
      {description === undefined ? null : <SelectionRowDescription className="block truncate">{description}</SelectionRowDescription>}
    </span>
  );
  return (
    <Button
      type="button"
      variant="ghost"
      data-active={selected || undefined}
      aria-pressed={selected}
      className={cn("tiny-selection-row h-auto w-full min-w-0 justify-start whitespace-normal px-3 py-2 text-left focus-visible:ring-0 focus-visible:ring-offset-0", className)}
      {...props}
    >
      {content}
    </Button>
  );
}
