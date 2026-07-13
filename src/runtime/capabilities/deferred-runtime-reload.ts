const pendingReloads = new Map<string, Set<string>>();

function queueKey(companyId: string, turnKey: string): string {
  return `${companyId}:${turnKey}`;
}

export function requestDeferredRuntimeReload(companyId: string, turnKey: string, memberIds: string[]): void {
  const key = queueKey(companyId, turnKey);
  const pending = pendingReloads.get(key) || new Set<string>();
  for (const memberId of memberIds) {
    if (memberId.trim()) pending.add(memberId.trim());
  }
  pendingReloads.set(key, pending);
}

export function consumeDeferredRuntimeReloads(companyId: string, turnKey: string): string[] {
  const key = queueKey(companyId, turnKey);
  const pending = pendingReloads.get(key);
  pendingReloads.delete(key);
  return pending ? [...pending].sort() : [];
}

export function clearDeferredRuntimeReloads(): void {
  pendingReloads.clear();
}
