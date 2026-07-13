import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { EmployeeAvatar } from "@/components/product/EmployeeAvatar";
import { HashIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { CompanyDirectoryMemberEntryDto } from "tinyoffice/frontend-api-contracts";
import type { ChatShellModel, ChatShellNavigationItem, ChatShellSurface } from "./chatShellModel";

export function WorkspaceSidebar({
  model,
  companyName,
  onSelectSurface,
  onCreateChannel,
}: {
  model: ChatShellModel;
  companyName?: string;
  onSelectSurface(surface: ChatShellSurface): void;
  onCreateChannel?(input: { title: string; summary?: string; members: CompanyDirectoryMemberEntryDto[] }): Promise<void>;
}): ReactElement {
  return (
    <SidebarProvider
      defaultOpen
      className="h-full min-h-0 w-full"
      style={{ "--sidebar-width": "274px" } as CSSProperties}
    >
      <Sidebar collapsible="none" className="tiny-sidebar h-full w-full min-w-0 border-r">
        <SidebarHeader className="tiny-sidebar-header border-b">
          <div className="truncate text-base font-semibold">{companyName ?? model.companyId ?? "TinyOffice"}</div>
          <div className="truncate text-xs text-muted-foreground">
            {model.companyId ? model.viewerLabel : "Waiting for Company context"}
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-3 px-2 py-1.5">
          <NavigationGroup
            title="Channels"
            items={model.channels}
            emptyText="No channels loaded"
            icon="channel"
            action={onCreateChannel ? <CreateChannelDialog model={model} onCreateChannel={onCreateChannel} /> : undefined}
            isSelected={(item) => model.selectedContainer?.containerId === item.id}
            onSelect={(item) => onSelectSurface({ kind: "container-directory", containerId: item.id })}
          />
          <NavigationGroup
            title="Direct messages"
            items={model.directMessages}
            emptyText="No AI employee DMs"
            icon="dm"
            isSelected={(item) => model.selectedContainer?.containerId === item.containerId}
            onSelect={(item) => onSelectSurface({ kind: "dm-directory", memberId: item.id, containerId: item.containerId })}
          />
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

function NavigationGroup({
  title,
  items,
  emptyText,
  icon,
  isSelected,
  onSelect,
  action,
}: {
  title: string;
  items: ChatShellNavigationItem[];
  emptyText: string;
  icon: "channel" | "dm";
  isSelected(item: ChatShellNavigationItem): boolean;
  onSelect(item: ChatShellNavigationItem): void;
  action?: ReactElement;
}): ReactElement {
  return (
    <SidebarGroup className="p-0">
      <div className="flex h-7 items-center justify-between gap-2 px-2">
        <SidebarGroupLabel className="tiny-section-label h-auto px-0">{title}</SidebarGroupLabel>
        {action}
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.length ? items.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                type="button"
                size="lg"
                isActive={isSelected(item)}
                className={`tiny-sidebar-row h-auto px-1.5 py-1.5 pr-10 text-[15px] ${icon === "dm" ? "min-h-12" : "min-h-[42px]"}`}
                onClick={() => onSelect(item)}
              >
                {navigationIcon(icon, item)}
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate font-medium">{item.title}</span>
                    <NavigationRuntimeStatusIndicator status={item.runtimeStatus} mentionCount={item.mentionCount} unreadCount={item.unreadCount} />
                  </span>
                  {icon === "dm" && item.subtitle ? <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span> : null}
                </span>
              </SidebarMenuButton>
              <NavigationUnreadBadge mentionCount={item.mentionCount} unreadCount={item.unreadCount} />
            </SidebarMenuItem>
          )) : <div className="px-2 py-2 text-xs text-muted-foreground">{emptyText}</div>}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function NavigationRuntimeStatusIndicator({
  status,
  mentionCount,
  unreadCount,
}: {
  status: ChatShellNavigationItem["runtimeStatus"];
  mentionCount: number;
  unreadCount: number;
}): ReactElement | null {
  if (!status || status.kind === "idle" || mentionCount > 0 || unreadCount > 0) {
    return null;
  }
  const tone = status.kind === "blocked" || status.kind === "needs_approval"
      ? "bg-[var(--tiny-warning-strong)]"
      : "bg-[var(--tiny-success-strong)]";
  return (
    <span
      className={`inline-block size-1.5 shrink-0 rounded-full ${tone}`}
      aria-label={status.label}
      title={`${status.label}: ${status.reason}`}
    />
  );
}

function NavigationUnreadBadge({
  mentionCount,
  unreadCount,
}: {
  mentionCount: number;
  unreadCount: number;
}): ReactElement | null {
  if (mentionCount > 0) {
    const label = `${mentionCount} mention${mentionCount === 1 ? "" : "s"}`;
    return (
      <SidebarMenuBadge className="tiny-attention-badge tiny-attention-badge-mention right-2 !top-1/2 !-translate-y-1/2" aria-label={label} title={label}>
        {mentionCount}
      </SidebarMenuBadge>
    );
  }
  if (unreadCount > 0) {
    const label = `${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`;
    return (
      <SidebarMenuBadge className="tiny-attention-badge tiny-attention-badge-unread right-2 !top-1/2 !-translate-y-1/2" aria-label={label} title={label}>
        {unreadCount}
      </SidebarMenuBadge>
    );
  }
  return null;
}

function navigationIcon(icon: "channel" | "dm", item: ChatShellNavigationItem): ReactElement {
  if (icon === "dm") {
    return (
      <EmployeeAvatar memberId={item.id} avatarSeed={item.avatarSeed ?? item.id} displayName={item.title} className="size-[30px]" />
    );
  }
  return (
    <span className="tiny-channel-mark size-5">
      <HashIcon className="size-[18px]" />
    </span>
  );
}

function CreateChannelDialog({
  model,
  onCreateChannel,
}: {
  model: ChatShellModel;
  onCreateChannel(input: { title: string; summary?: string; members: CompanyDirectoryMemberEntryDto[] }): Promise<void>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const selectedMembers = useMemo(
    () => model.directoryMembers.filter((member) => selectedMemberIds.includes(directoryMemberKey(member))),
    [model.directoryMembers, selectedMemberIds],
  );

  useEffect(() => {
    if (!open) {
      setTitle("");
      setSummary("");
      setSelectedMemberIds([]);
      setIsSaving(false);
    }
  }, [open]);

  async function createChannel(): Promise<void> {
    if (!title.trim()) {
      return;
    }
    setIsSaving(true);
    try {
      await onCreateChannel({ title, summary, members: selectedMembers });
      setOpen(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Create channel">
          <PlusIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="tiny-chat-dialog max-h-[90svh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create channel</DialogTitle>
          <DialogDescription>Create a shared workspace with selected members.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[64svh] pr-3">
          <div className="grid gap-4">
            <section className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Channel profile</div>
              <Input value={title} disabled={isSaving} placeholder="Channel name" onChange={(event) => setTitle(event.currentTarget.value)} />
              <Textarea value={summary} disabled={isSaving} placeholder="Purpose" onChange={(event) => setSummary(event.currentTarget.value)} />
            </section>
            <section className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Members</div>
              {model.directoryMembers.length === 0 ? (
                <div className="text-xs text-muted-foreground">No directory members available.</div>
              ) : (
                <div className="grid gap-2">
                  {model.directoryMembers.map((member) => {
                    const key = directoryMemberKey(member);
                    const selected = selectedMemberIds.includes(key);
                    return (
                      <Button
                        key={key}
                        type="button"
                        variant={selected ? "secondary" : "outline"}
                        className="h-auto justify-start px-3 py-2 text-left"
                        disabled={isSaving}
                        onClick={() => {
                          setSelectedMemberIds((current) => selected
                            ? current.filter((item) => item !== key)
                            : [...current, key]);
                        }}
                      >
                        <span className="grid min-w-0 gap-1">
                          <span className="break-words [overflow-wrap:anywhere]">{member.displayName}</span>
                          <span className="text-xs text-muted-foreground">{member.role ?? (member.hasRuntimeProfile ? "Runtime-capable" : "Company member")}</span>
                        </span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button type="button" disabled={isSaving || !title.trim()} onClick={() => void createChannel()}>
            Create channel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function directoryMemberKey(member: CompanyDirectoryMemberEntryDto): string {
  return `member:${member.memberId}`;
}
