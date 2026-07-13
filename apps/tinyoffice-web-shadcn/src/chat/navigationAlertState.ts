export type NavigationAlertState = {
  chat: boolean;
  tasks: boolean;
};

type ChatAlertSource = {
  entries: Array<{ unreadCount: number; mentionCount: number }>;
};

type AccessAlertSource = {
  requests: Array<{
    status: string;
    requestedApproverMemberId?: string;
    foregroundTarget?: unknown;
  }>;
};

type TasksAlertSource = {
  tasks: Array<{
    status: string;
    latestExecution?: {
      status: string;
      actions: Array<{ id: string; enabled: boolean }>;
    };
  }>;
};

export function navigationAlertState(input: {
  projection?: ChatAlertSource;
  accessRequests?: AccessAlertSource;
  tasks?: TasksAlertSource;
  viewerMemberId?: string;
}): NavigationAlertState {
  return {
    chat: hasChatAlert(input),
    tasks: hasTasksAlert(input.tasks),
  };
}

function hasChatAlert(input: {
  projection?: ChatAlertSource;
  accessRequests?: AccessAlertSource;
  viewerMemberId?: string;
}): boolean {
  if ((input.projection?.entries ?? []).some((entry) => entry.unreadCount > 0 || entry.mentionCount > 0)) {
    return true;
  }
  return (input.accessRequests?.requests ?? []).some((request) =>
    request.status === "pending" &&
    Boolean(request.foregroundTarget) &&
    (!request.requestedApproverMemberId || request.requestedApproverMemberId === input.viewerMemberId)
  );
}

function hasTasksAlert(tasks: TasksAlertSource | undefined): boolean {
  return (tasks?.tasks ?? []).some((task) => {
    if (task.status !== "active" || !task.latestExecution) {
      return false;
    }
    if (task.latestExecution.status === "failed") {
      return true;
    }
    return task.latestExecution.actions.some(
      (action) => action.id === "retry-dispatch" && action.enabled,
    );
  });
}
