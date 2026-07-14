import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAccessRequests, resolveAccessRequest } from "@/api/accessClient";
import { addChatChannelMembers, archiveChatRoomTopic, cancelChatRun, createChatChannel, createChatEntry, dissolveChatChannel, getActiveChatRun, getChatProjection, listChatRoomActivity, listChatRoomMessages, markChatRoomRead, removeChatChannelMember, restoreChatRoomTopic, retryChatRun, sendChatRoomMessage, updateChatChannelDetails, updateChatRoomTitle } from "@/api/chatClient";
import { getCurrentSession } from "@/api/currentSessionClient";
import { getCompanyDirectory } from "@/api/directoryClient";
import { getEmployeeRuntimeSummary } from "@/api/employeeRuntimeSummaryClient";
import { getTasksViewModel } from "@/api/tasksClient";
import type { AccessRequestDecision, AccessRequestDto, ChatChannelMemberDto, ChatProjectionPage, CompanyDirectoryMemberEntryDto, MessagePage, RuntimeActivity, TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildChatShellModel, type ChatShellModel, type ChatShellSurface } from "./chatShellModel";
import { accessDecisionContinuationMessage, accessRequestForegroundRoomId, accessRequestsForRoom } from "./chatAccessRequests";
import { mentionedMemberIdsForChatSubmit } from "./chatMentionRouting";
import { navigationAlertState, type NavigationAlertState } from "./navigationAlertState";
import { memberDisplayNamesForCreateEntry } from "./chatCreateEntryDisplayNames";
import { projectionWithCreatedEntry } from "./chatProjectionCache";
import { activeChatRunForRoom, applyChatRunRealtimeEvent, draftReplyForRoom, emptyChatRunState, reconcileActiveChatRun, type ChatRunRecord, type DraftReply } from "./chatRunState";
import { activeEntryContainerId, parentSurfaceFor } from "./chatUiUtils";
import { chatQueryKeys } from "./chatQueryKeys";
import { activitySourceForMessage, latestActivitySourceForMessages } from "./messageActivitySource";
import { useChatRealtime } from "./useChatRealtime";
import type { ComposerSubmitValue } from "./mentionComposerModel";

export type ChatWorkspaceStatus = "idle" | "loading" | "ready" | "error";

type ActivitySelection = {
  sourceMessageId?: string;
  processTraceId?: string;
};

type ActivityDisplaySnapshot = {
  activity: RuntimeActivity;
  selection?: ActivitySelection;
};

const EMPTY_RUNTIME_ACTIVITY: RuntimeActivity = { items: [] };

export function activityQueryPlaceholderData(previousData: RuntimeActivity | undefined): RuntimeActivity | undefined {
  return previousData;
}

export function activityDisplaySnapshot(input: {
  currentActivity?: RuntimeActivity;
  currentSelection?: ActivitySelection;
  activeSourceMessageId?: string;
  isPlaceholderData: boolean;
  settled?: ActivityDisplaySnapshot;
}): ActivityDisplaySnapshot {
  const current = {
    activity: input.currentActivity ?? EMPTY_RUNTIME_ACTIVITY,
    selection: input.currentSelection,
  };
  const currentSelectionIsActive = Boolean(
    input.activeSourceMessageId &&
      input.activeSourceMessageId === input.currentSelection?.sourceMessageId,
  );
  const currentActivityIsReady = !input.isPlaceholderData && current.activity.items.length > 0;
  const shouldKeepSettled = input.isPlaceholderData || (currentSelectionIsActive && !currentActivityIsReady);
  return shouldKeepSettled && input.settled ? input.settled : current;
}

export type ActivitySourceSummary = {
  senderName: string;
  createdAt: string;
};

export interface ChatWorkspaceController {
  model: ChatShellModel;
  currentSession?: TinyOfficeCurrentSession;
  status: ChatWorkspaceStatus;
  error?: string;
  loadWorkspace(selectedSurface?: ChatShellSurface): Promise<void>;
  selectSurface(surface: ChatShellSurface): void;
  selectEntry(entryId: string): void;
  selectRoom(roomId: string): void;
  startDraftEntry(): void;
  archiveEntry(entryId: string): Promise<void>;
  restoreEntry(entryId: string): Promise<void>;
  backToList(): void;
  createEntry(value: ComposerSubmitValue): Promise<void>;
  sendReply(value: ComposerSubmitValue): Promise<void>;
  clearComposerNotice(): void;
  cancelActiveRun(): Promise<void>;
  retryFailedRun(): Promise<void>;
  resolveAccessRequest(input: { request: AccessRequestDto; decision: AccessRequestDecision; note?: string }): Promise<void>;
  createChannel(input: { title: string; summary?: string; members: CompanyDirectoryMemberEntryDto[] }): Promise<void>;
  updateTitle(title: string): Promise<void>;
  updateChannelDetails(input: { title: string; summary?: string }): Promise<void>;
  addChannelMembers(members: CompanyDirectoryMemberEntryDto[]): Promise<void>;
  removeChannelMember(member: ChatChannelMemberDto): Promise<void>;
  dissolveChannel(confirmation: "DELETE"): Promise<void>;
  openMessageActivity(input: { sourceMessageId: string }): void;
  activeRun?: ChatRunRecord;
  activity: RuntimeActivity;
  activitySelection?: ActivitySelection;
  activitySource?: ActivitySourceSummary;
  draftReply?: DraftReply;
  isCancelingRun: boolean;
  accessRequests: AccessRequestDto[];
  isResolvingAccessRequest: boolean;
  composerNotice?: string;
  navigationAlerts: NavigationAlertState;
}

export function useChatWorkspace(input: { requestedRoomId?: string; currentSession?: TinyOfficeCurrentSession; sessionOwnedByParent?: boolean } = {}): ChatWorkspaceController {
  const queryClient = useQueryClient();
  const [selectedSurface, setSelectedSurface] = useState<ChatShellSurface>();
  const [activitySelection, setActivitySelection] = useState<ActivitySelection | undefined>();
  const [settledActivityDisplay, setSettledActivityDisplay] = useState<ActivityDisplaySnapshot | undefined>();
  const [chatRunState, setChatRunState] = useState(emptyChatRunState);
  const [composerNotice, setComposerNotice] = useState<string | undefined>();
  const markedReadKey = useRef<string | undefined>(undefined);

  const sessionQuery = useQuery({
    queryKey: chatQueryKeys.currentSession(),
    queryFn: getCurrentSession,
    enabled: !input.sessionOwnedByParent,
  });

  const session = input.currentSession ?? sessionQuery.data;
  const companyId = session?.companyId ?? session?.currentCompanyId;
  const viewer = useMemo(() => viewerFromSession(session), [session]);
  const hasCompanyScope = Boolean(companyId && !session?.needsInitialization);

  const projectionQuery = useQuery({
    queryKey: chatQueryKeys.projection(companyId, viewer),
    queryFn: () => getChatProjection({ companyId, ...viewer }),
    enabled: hasCompanyScope,
  });

  const directoryQuery = useQuery({
    queryKey: chatQueryKeys.directory(companyId),
    queryFn: () => getCompanyDirectory({ companyId }),
    enabled: hasCompanyScope,
  });

  const employeeRuntimeSummaryQuery = useQuery({
    queryKey: chatQueryKeys.employeeRuntimeSummary(companyId),
    queryFn: () => getEmployeeRuntimeSummary({ companyId }),
    enabled: hasCompanyScope,
  });

  const tasksQueryInput = {
    status: "all" as const,
    sort: "recent" as const,
    workTaskId: undefined,
  };

  const tasksQuery = useQuery({
    queryKey: chatQueryKeys.tasks(companyId, tasksQueryInput),
    queryFn: () => getTasksViewModel({ companyId: requiredTinyOfficeValue(companyId, "companyId"), ...tasksQueryInput }),
    enabled: hasCompanyScope,
    refetchInterval: (query) => query.state.data?.refresh.indexIntervalMs,
  });

  const baseModel = useMemo(
    () => buildChatShellModel({
      session,
      projection: projectionQuery.data,
      directory: directoryQuery.data,
      employeeRuntimeSummary: employeeRuntimeSummaryQuery.data,
      chatRunState,
      tasks: tasksQuery.data,
      selectedRoomId: input.requestedRoomId,
      selectedSurface,
    }),
    [session, projectionQuery.data, directoryQuery.data, employeeRuntimeSummaryQuery.data, chatRunState, tasksQuery.data, input.requestedRoomId, selectedSurface],
  );

  const messagesQuery = useQuery({
    queryKey: chatQueryKeys.roomMessages(companyId, baseModel.selectedRoomId, viewer),
    queryFn: () => listChatRoomMessages({ companyId, roomId: baseModel.selectedRoomId, ...viewer }),
    enabled: Boolean(hasCompanyScope && baseModel.selectedRoomId),
  });

  const activeRunQuery = useQuery({
    queryKey: chatQueryKeys.activeRun(companyId, baseModel.selectedRoomId, viewer),
    queryFn: () => getActiveChatRun({ companyId, roomId: baseModel.selectedRoomId, actorMemberId: viewer.memberId }),
    enabled: Boolean(hasCompanyScope && baseModel.selectedRoomId),
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (baseModel.selectedRoomId && activeRunQuery.isSuccess) {
      setChatRunState((current) => reconcileActiveChatRun(current, baseModel.selectedRoomId!, activeRunQuery.data));
    }
  }, [activeRunQuery.data, activeRunQuery.isSuccess, baseModel.selectedRoomId]);

  const activityQuery = useQuery({
    queryKey: chatQueryKeys.roomActivity(companyId, baseModel.selectedRoomId, viewer, activitySelection),
    queryFn: () => listChatRoomActivity({
      companyId,
      roomId: baseModel.selectedRoomId,
      sourceMessageId: activitySelection?.sourceMessageId,
      processTraceId: activitySelection?.processTraceId,
      limit: 500,
      ...viewer,
    }),
    enabled: Boolean(hasCompanyScope && baseModel.selectedRoomId && activitySelection),
    placeholderData: activityQueryPlaceholderData,
  });

  const accessRequestsQuery = useQuery({
    queryKey: chatQueryKeys.accessRequests(companyId),
    queryFn: () => getAccessRequests({ companyId }),
    enabled: hasCompanyScope,
    refetchInterval: 3000,
  });

  const model = useMemo(
    () => buildChatShellModel({
      session,
      projection: projectionQuery.data,
      directory: directoryQuery.data,
      employeeRuntimeSummary: employeeRuntimeSummaryQuery.data,
      chatRunState,
      tasks: tasksQuery.data,
      messages: messagesQuery.data,
      selectedSurface: baseModel.surface,
    }),
    [session, projectionQuery.data, directoryQuery.data, employeeRuntimeSummaryQuery.data, chatRunState, tasksQuery.data, messagesQuery.data, baseModel.surface],
  );
  const activeRun = useMemo(() => activeChatRunForRoom(chatRunState, model.selectedRoomId), [chatRunState, model.selectedRoomId]);
  const displayedActivity = useMemo(
    () => activityDisplaySnapshot({
      currentActivity: activityQuery.data,
      currentSelection: activitySelection,
      activeSourceMessageId: activeRun?.sourceMessageId,
      isPlaceholderData: activityQuery.isPlaceholderData,
      settled: settledActivityDisplay,
    }),
    [activeRun?.sourceMessageId, activityQuery.data, activityQuery.isPlaceholderData, activitySelection, settledActivityDisplay],
  );
  const activity = displayedActivity.activity;
  const activitySource = useMemo(
    () => activitySourceSummaryForSelection(messagesQuery.data?.messages ?? [], displayedActivity.selection?.sourceMessageId),
    [displayedActivity.selection?.sourceMessageId, messagesQuery.data?.messages],
  );
  const draftReply = useMemo(() => draftReplyForRoom(chatRunState, model.selectedRoomId), [chatRunState, model.selectedRoomId]);
  const roomAccessRequests = useMemo(
    () => accessRequestsForRoom(accessRequestsQuery.data?.requests ?? [], model.selectedRoomId),
    [accessRequestsQuery.data?.requests, model.selectedRoomId],
  );
  const navigationAlerts = useMemo(
    () => navigationAlertState({
      projection: projectionQuery.data,
      accessRequests: accessRequestsQuery.data,
      tasks: tasksQuery.data,
      viewerMemberId: session?.member?.memberId,
    }),
    [projectionQuery.data, accessRequestsQuery.data, tasksQuery.data, session?.member?.memberId],
  );
  useEffect(() => {
    setActivitySelection(undefined);
    setSettledActivityDisplay(undefined);
  }, [companyId, baseModel.selectedRoomId]);

  useEffect(() => {
    if (!activitySelection || activityQuery.isPlaceholderData || !activityQuery.data?.items.length) {
      return;
    }
    setSettledActivityDisplay({
      activity: activityQuery.data,
      selection: activitySelection,
    });
  }, [activityQuery.data, activityQuery.isPlaceholderData, activitySelection]);

  useEffect(() => {
    if (activeRun?.sourceMessageId && activitySelection?.sourceMessageId !== activeRun.sourceMessageId) {
      setActivitySelection({ sourceMessageId: activeRun.sourceMessageId });
    }
  }, [activeRun?.sourceMessageId, activitySelection?.sourceMessageId]);

  useEffect(() => {
    if (activitySelection || activeRun?.sourceMessageId) {
      return;
    }
    const source = latestActivitySourceForMessages(messagesQuery.data?.messages ?? []);
    if (source) {
      setActivitySelection({ sourceMessageId: source.sourceMessageId });
    }
  }, [activeRun?.sourceMessageId, activitySelection, messagesQuery.data]);

  const handleRealtimeEvent = useCallback((event: Parameters<typeof applyChatRunRealtimeEvent>[1]) => {
    setChatRunState((current) => applyChatRunRealtimeEvent(current, event));
    if (event.type === "chat.process_trace.appended") {
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.roomActivityScope(event.companyId, event.roomId) });
    }
  }, [queryClient]);

  useChatRealtime({
    companyId,
    memberId: viewer.memberId,
    onEvent: handleRealtimeEvent,
  });

  useEffect(() => {
    setSelectedSurface(undefined);
    setChatRunState(emptyChatRunState);
    markedReadKey.current = undefined;
  }, [companyId]);

  useEffect(() => {
    if (input.requestedRoomId) {
      setSelectedSurface(undefined);
      setComposerNotice(undefined);
    }
  }, [input.requestedRoomId]);

  const markReadMutation = useMutation({
    mutationFn: markChatRoomRead,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.projectionScope(companyId) });
    },
  });

  useEffect(() => {
    const roomId = model.selectedRoomId;
    const lastReadMessageId = messagesQuery.data?.messages.at(-1)?.messageId;
    if (!companyId || !roomId || !lastReadMessageId || markReadMutation.isPending) {
      return;
    }
    const readKey = `${companyId}:${roomId}:${lastReadMessageId}:${viewer.memberId ?? ""}`;
    if (markedReadKey.current === readKey) {
      return;
    }
    markedReadKey.current = readKey;
    markReadMutation.mutate({
      companyId,
      roomId,
      lastReadMessageId,
      ...viewer,
    });
  }, [companyId, model.selectedRoomId, messagesQuery.data, viewer, markReadMutation]);

  const createEntryMutation = useMutation({
    mutationFn: (value: ComposerSubmitValue) => createEntryFromSelectedContainer(value, model, session),
    onSuccess: async (created) => {
      queryClient.setQueryData(
        chatQueryKeys.projection(companyId, viewer),
        (current: ChatProjectionPage | undefined) => projectionWithCreatedEntry(current, created),
      );
      setSelectedSurface({ kind: "entry-room", entryId: created.entry.entryId });
      await invalidateChatWorkspace(queryClient, companyId, created.openTarget.roomId);
    },
  });

  const sendReplyMutation = useMutation({
    mutationFn: (value: ComposerSubmitValue) => sendReplyToSelectedRoom(value, model, session),
    onSuccess: async () => {
      await invalidateChatWorkspace(queryClient, companyId, model.selectedRoomId);
    },
  });

  const updateTitleMutation = useMutation({
    mutationFn: (title: string) => updateSelectedRoomTitle(title, model, session),
    onSuccess: async () => {
      await invalidateChatWorkspace(queryClient, companyId, model.selectedRoomId);
    },
  });

  const archiveEntryMutation = useMutation({
    mutationFn: (entryId: string) => archiveEntryFromModel(entryId, model, session),
    onSuccess: async (_archived, entryId) => {
      if (model.surface.kind === "entry-room" && model.surface.entryId === entryId) {
        setSelectedSurface(parentSurfaceFor(model));
      }
      await invalidateChatWorkspace(queryClient, companyId, undefined);
    },
  });
  const restoreEntryMutation = useMutation({
    mutationFn: (entryId: string) => restoreEntryFromModel(entryId, model, session),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.projection(companyId, viewer) });
    },
  });
  const retryRunMutation = useMutation({
    mutationFn: () => {
      if (!draftReply || draftReply.status !== "failed") throw new Error("No failed Chat run is available to retry.");
      return retryChatRun({
        companyId,
        runId: draftReply.runId,
        roomId: draftReply.roomId,
        sourceMessageId: draftReply.sourceMessageId,
        targetMemberId: draftReply.targetMemberId,
        actorMemberId: session?.member?.memberId,
      });
    },
  });

  const updateChannelDetailsMutation = useMutation({
    mutationFn: (input: { title: string; summary?: string }) => updateSelectedChannelDetails(input, model, session),
    onSuccess: async () => {
      await invalidateChatWorkspace(queryClient, companyId, undefined);
    },
  });

  const createChannelMutation = useMutation({
    mutationFn: (input: { title: string; summary?: string; members: CompanyDirectoryMemberEntryDto[] }) => createChannelFromDirectory(input, model, session),
    onSuccess: async (created) => {
      setSelectedSurface({ kind: "container-directory", containerId: `chat-container-channel-${created.chatChannelId}` });
      await invalidateChatWorkspace(queryClient, companyId, undefined);
    },
  });

  const addChannelMembersMutation = useMutation({
    mutationFn: (members: CompanyDirectoryMemberEntryDto[]) => addMembersToSelectedChannel(members, model, session),
    onSuccess: async () => {
      await invalidateChatWorkspace(queryClient, companyId, undefined);
    },
  });

  const removeChannelMemberMutation = useMutation({
    mutationFn: (member: ChatChannelMemberDto) => removeMemberFromSelectedChannel(member, model, session),
    onSuccess: async () => {
      await invalidateChatWorkspace(queryClient, companyId, undefined);
    },
  });

  const dissolveChannelMutation = useMutation({
    mutationFn: (confirmation: "DELETE") => dissolveSelectedChannel(confirmation, model, session),
    onSuccess: async () => {
      setSelectedSurface(undefined);
      await invalidateChatWorkspace(queryClient, companyId, undefined);
    },
  });

  const cancelRunMutation = useMutation({
    mutationFn: (run: ChatRunRecord) => cancelSelectedRun(run, model, session),
    onSuccess: async (_result, run) => {
      await invalidateChatWorkspace(queryClient, companyId, run.roomId);
    },
  });

  const resolveAccessRequestMutation = useMutation({
    mutationFn: (input: { request: AccessRequestDto; decision: AccessRequestDecision; note?: string }) =>
      resolveAccessRequest({
        companyId: requiredTinyOfficeValue(companyId, "companyId"),
        approvalId: input.request.id,
        decision: input.decision,
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        ...(session?.member?.memberId ? { resolvedByMemberId: session.member.memberId } : {}),
      }),
    onSuccess: async (_result, input) => {
      await postAccessDecisionContinuation({
        request: input.request,
        decision: input.decision,
        note: input.note,
        model,
        session,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.accessRequests(companyId) }),
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.roomActivityScope(companyId, input.request.contextId) }),
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.roomMessagesScope(companyId, input.request.contextId) }),
      ]);
    },
  });

  const loadWorkspace = useCallback(async (surface?: ChatShellSurface) => {
    if (surface) {
      setSelectedSurface(surface);
    }
    await invalidateChatWorkspace(queryClient, companyId, surface?.kind === "entry-room" ? undefined : model.selectedRoomId);
  }, [queryClient, companyId, model.selectedRoomId]);

  const selectSurface = useCallback((surface: ChatShellSurface) => {
    setComposerNotice(undefined);
    setSelectedSurface(surface);
  }, []);

  const selectEntry = useCallback((entryId: string) => {
    setComposerNotice(undefined);
    setSelectedSurface({ kind: "entry-room", entryId });
  }, []);

  const selectRoom = useCallback((roomId: string) => {
    const entry = model.rooms.find((candidate) => candidate.openTarget.roomId === roomId);
    if (entry) {
      setComposerNotice(undefined);
      setSelectedSurface({ kind: "entry-room", entryId: entry.entryId });
    }
  }, [model.rooms]);

  const startDraftEntry = useCallback(() => {
    const containerId = activeEntryContainerId(model);
    if (!containerId) {
      return;
    }
    const memberId = model.surface.kind === "dm-directory"
      ? model.surface.memberId
      : model.directMessages.find((message) => message.containerId === containerId)?.id;
    setComposerNotice(undefined);
    setSelectedSurface({
      kind: "draft-entry",
      containerId,
      ...(memberId ? { memberId } : {}),
    });
  }, [model]);

  const archiveEntry = useCallback(async (entryId: string) => {
    await archiveEntryMutation.mutateAsync(entryId);
  }, [archiveEntryMutation]);
  const restoreEntry = useCallback(async (entryId: string) => {
    await restoreEntryMutation.mutateAsync(entryId);
  }, [restoreEntryMutation]);
  const retryFailedRun = useCallback(async () => {
    await retryRunMutation.mutateAsync();
  }, [retryRunMutation]);

  const backToList = useCallback(() => {
    setComposerNotice(undefined);
    setSelectedSurface(parentSurfaceFor(model));
  }, [model]);

  const createEntry = useCallback(async (value: ComposerSubmitValue) => {
    await createEntryMutation.mutateAsync(value);
    setComposerNotice(undefined);
  }, [createEntryMutation]);

  const sendReply = useCallback(async (value: ComposerSubmitValue) => {
    await sendReplyMutation.mutateAsync(value);
    setComposerNotice(undefined);
  }, [sendReplyMutation]);

  const clearComposerNotice = useCallback(() => {
    setComposerNotice(undefined);
  }, []);

  const cancelActiveRun = useCallback(async () => {
    if (!activeRun || cancelRunMutation.isPending) {
      return;
    }
    await cancelRunMutation.mutateAsync(activeRun);
  }, [activeRun, cancelRunMutation]);

  const resolveRoomAccessRequest = useCallback(async (input: { request: AccessRequestDto; decision: AccessRequestDecision; note?: string }) => {
    await resolveAccessRequestMutation.mutateAsync(input);
  }, [resolveAccessRequestMutation]);

  const updateTitle = useCallback(async (title: string) => {
    await updateTitleMutation.mutateAsync(title);
  }, [updateTitleMutation]);

  const createChannelFromCurrent = useCallback(async (input: { title: string; summary?: string; members: CompanyDirectoryMemberEntryDto[] }) => {
    await createChannelMutation.mutateAsync(input);
  }, [createChannelMutation]);

  const updateChannel = useCallback(async (input: { title: string; summary?: string }) => {
    await updateChannelDetailsMutation.mutateAsync(input);
  }, [updateChannelDetailsMutation]);

  const addChannelMembersToCurrent = useCallback(async (members: CompanyDirectoryMemberEntryDto[]) => {
    await addChannelMembersMutation.mutateAsync(members);
  }, [addChannelMembersMutation]);

  const removeChannelMemberFromCurrent = useCallback(async (member: ChatChannelMemberDto) => {
    await removeChannelMemberMutation.mutateAsync(member);
  }, [removeChannelMemberMutation]);

  const dissolveChannelFromCurrent = useCallback(async (confirmation: "DELETE") => {
    await dissolveChannelMutation.mutateAsync(confirmation);
  }, [dissolveChannelMutation]);

  const openMessageActivity = useCallback((input: { sourceMessageId: string }) => {
    const sourceMessageId = input.sourceMessageId.trim();
    if (!sourceMessageId) {
      return;
    }
    setActivitySelection({ sourceMessageId });
  }, []);

  const workspaceQueries = !input.sessionOwnedByParent
    ? [sessionQuery, projectionQuery, directoryQuery, employeeRuntimeSummaryQuery, tasksQuery, messagesQuery, activityQuery, accessRequestsQuery]
    : [projectionQuery, directoryQuery, employeeRuntimeSummaryQuery, tasksQuery, messagesQuery, activityQuery, accessRequestsQuery];

  return {
    model,
    currentSession: session,
    status: statusFromQueries(workspaceQueries),
    error: errorFromQueries(workspaceQueries) ?? mutationError(markReadMutation.error) ?? mutationError(createEntryMutation.error) ?? mutationError(sendReplyMutation.error) ?? mutationError(updateTitleMutation.error) ?? mutationError(archiveEntryMutation.error) ?? mutationError(createChannelMutation.error) ?? mutationError(updateChannelDetailsMutation.error) ?? mutationError(addChannelMembersMutation.error) ?? mutationError(removeChannelMemberMutation.error) ?? mutationError(dissolveChannelMutation.error) ?? mutationError(cancelRunMutation.error) ?? mutationError(resolveAccessRequestMutation.error),
    loadWorkspace,
    selectSurface,
    selectEntry,
    selectRoom,
    startDraftEntry,
    archiveEntry,
    restoreEntry,
    backToList,
    createEntry,
    sendReply,
    clearComposerNotice,
    cancelActiveRun,
    retryFailedRun,
    resolveAccessRequest: resolveRoomAccessRequest,
    createChannel: createChannelFromCurrent,
    updateTitle,
    updateChannelDetails: updateChannel,
    addChannelMembers: addChannelMembersToCurrent,
    removeChannelMember: removeChannelMemberFromCurrent,
    dissolveChannel: dissolveChannelFromCurrent,
    openMessageActivity,
    activeRun,
    activity,
    activitySelection: displayedActivity.selection,
    activitySource,
    draftReply,
    isCancelingRun: cancelRunMutation.isPending,
    accessRequests: roomAccessRequests,
    isResolvingAccessRequest: resolveAccessRequestMutation.isPending,
    composerNotice,
    navigationAlerts,
  };
}

function activitySourceSummaryForSelection(
  messages: MessagePage["messages"],
  sourceMessageId: string | undefined,
): ActivitySourceSummary | undefined {
  if (!sourceMessageId) {
    return undefined;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const source = activitySourceForMessage(message);
    if (source?.sourceMessageId === sourceMessageId) {
      return {
        senderName: message.sender.displayName,
        createdAt: message.createdAt,
      };
    }
  }
  return undefined;
}

function viewerFromSession(session: TinyOfficeCurrentSession | undefined): { memberId?: string } {
  return session?.member ? { memberId: session.member.memberId } : {};
}

async function createEntryFromSelectedContainer(
  value: ComposerSubmitValue,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<Awaited<ReturnType<typeof createChatEntry>>> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const containerId = requiredTinyOfficeValue(activeEntryContainerId(model), "containerId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  const mentionedMemberIds = mentionedMemberIdsForChatSubmit(value, model.mentionCandidates);
  const memberDisplayNames = memberDisplayNamesForCreateEntry(model);
  return createChatEntry({
    companyId,
    containerId,
    actorMemberId,
    actorDisplayName: session?.member?.displayName ?? session?.user.displayName,
    ...(memberDisplayNames ? { memberDisplayNames } : {}),
    firstMessage: {
      body: value.body,
      ...(value.attachmentIds?.length ? { attachmentIds: value.attachmentIds } : {}),
      ...(mentionedMemberIds.length ? { mentionedMemberIds } : {}),
    },
  });
}

async function sendReplyToSelectedRoom(
  value: ComposerSubmitValue,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const roomId = requiredTinyOfficeValue(model.selectedRoomId, "roomId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  const mentionedMemberIds = mentionedMemberIdsForChatSubmit(value, model.mentionCandidates);
  return sendChatRoomMessage({
    companyId,
    roomId,
    actorMemberId,
    actorDisplayName: session?.member?.displayName ?? session?.user.displayName,
    body: value.body,
    mentionedMemberIds,
    attachmentIds: value.attachmentIds,
  });
}

async function postAccessDecisionContinuation(input: {
  request: AccessRequestDto;
  decision: AccessRequestDecision;
  note?: string;
  model: ChatShellModel;
  session: TinyOfficeCurrentSession | undefined;
}): Promise<void> {
  const companyId = requiredTinyOfficeValue(input.model.companyId, "companyId");
  const roomId = requiredTinyOfficeValue(
    accessRequestForegroundRoomId(input.request),
    "roomId",
  );
  const actorMemberId = requiredTinyOfficeValue(input.session?.member?.memberId, "actorMemberId");
  const targetMemberId = input.request.requestedByMemberId.trim();
  await sendChatRoomMessage({
    companyId,
    roomId,
    actorMemberId,
    actorDisplayName: input.session?.member?.displayName ?? input.session?.user.displayName,
    body: accessDecisionContinuationMessage({
      request: input.request,
      decision: input.decision,
      note: input.note,
    }),
    mentionedMemberIds: targetMemberId && targetMemberId !== actorMemberId ? [targetMemberId] : [],
  });
}

async function updateSelectedRoomTitle(
  title: string,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const roomId = requiredTinyOfficeValue(model.selectedRoomId, "roomId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return updateChatRoomTitle({
    companyId,
    roomId,
    actorMemberId,
    title,
  });
}

async function archiveEntryFromModel(
  entryId: string,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<Awaited<ReturnType<typeof archiveChatRoomTopic>>> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const entry = model.rooms.find((candidate) => candidate.entryId === entryId);
  const roomId = requiredTinyOfficeValue(entry?.openTarget.roomId, "roomId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return archiveChatRoomTopic({
    companyId,
    roomId,
    actorMemberId,
    confirmation: "ARCHIVE",
  });
}

async function restoreEntryFromModel(
  entryId: string,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<Awaited<ReturnType<typeof restoreChatRoomTopic>>> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const entry = model.archivedDirectoryEntries?.find((candidate) => candidate.entryId === entryId);
  const roomId = requiredTinyOfficeValue(entry?.openTarget.roomId, "roomId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return restoreChatRoomTopic({ companyId, roomId, actorMemberId, confirmation: "RESTORE" });
}

async function updateSelectedChannelDetails(
  input: { title: string; summary?: string },
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const chatChannelId = requiredTinyOfficeValue(model.selectedContainer?.chatChannelId, "chatChannelId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return updateChatChannelDetails({
    companyId,
    chatChannelId,
    actorMemberId,
    title: input.title,
    summary: input.summary,
  });
}

async function createChannelFromDirectory(
  input: { title: string; summary?: string; members: CompanyDirectoryMemberEntryDto[] },
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<Awaited<ReturnType<typeof createChatChannel>>> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return createChatChannel({
    companyId,
    actorMemberId,
    actorDisplayName: session?.member?.displayName ?? session?.user.displayName,
    title: input.title,
    summary: input.summary,
    members: input.members.map((member) => ({
      memberId: requiredTinyOfficeValue(member.memberId, "memberId"),
      displayName: member.displayName,
      hasRuntimeProfile: member.hasRuntimeProfile,
    })),
  });
}

async function addMembersToSelectedChannel(
  members: CompanyDirectoryMemberEntryDto[],
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const chatChannelId = requiredTinyOfficeValue(model.selectedContainer?.chatChannelId, "chatChannelId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return addChatChannelMembers({
    companyId,
    chatChannelId,
    actorMemberId,
    members: members.map((member) => ({
      memberId: requiredTinyOfficeValue(member.memberId, "memberId"),
      displayName: member.displayName,
      hasRuntimeProfile: member.hasRuntimeProfile,
    })),
  });
}

async function removeMemberFromSelectedChannel(
  member: ChatChannelMemberDto,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const chatChannelId = requiredTinyOfficeValue(model.selectedContainer?.chatChannelId, "chatChannelId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return removeChatChannelMember({
    companyId,
    chatChannelId,
    actorMemberId,
    member: { memberId: requiredTinyOfficeValue(member.memberId, "memberId") },
  });
}

async function dissolveSelectedChannel(
  confirmation: "DELETE",
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const chatChannelId = requiredTinyOfficeValue(model.selectedContainer?.chatChannelId, "chatChannelId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return dissolveChatChannel({
    companyId,
    chatChannelId,
    actorMemberId,
    confirmation,
  });
}

async function cancelSelectedRun(
  run: ChatRunRecord,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return cancelChatRun({
    companyId,
    runId: run.runId,
    actorMemberId,
    reason: "User stopped the reply.",
  });
}

async function invalidateChatWorkspace(
  queryClient: ReturnType<typeof useQueryClient>,
  companyId: string | undefined,
  roomId: string | undefined,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: chatQueryKeys.currentSession() }),
    companyId ? queryClient.invalidateQueries({ queryKey: chatQueryKeys.projectionScope(companyId) }) : Promise.resolve(),
    companyId ? queryClient.invalidateQueries({ queryKey: chatQueryKeys.directory(companyId) }) : Promise.resolve(),
    companyId ? queryClient.invalidateQueries({ queryKey: chatQueryKeys.employeeRuntimeSummary(companyId) }) : Promise.resolve(),
    companyId && roomId ? queryClient.invalidateQueries({ queryKey: chatQueryKeys.roomMessagesScope(companyId, roomId) }) : Promise.resolve(),
    companyId && roomId ? queryClient.invalidateQueries({ queryKey: chatQueryKeys.roomActivityScope(companyId, roomId) }) : Promise.resolve(),
  ]);
}

function statusFromQueries(queries: Array<{ isError: boolean; isPending: boolean; fetchStatus: string }>): ChatWorkspaceStatus {
  if (queries.some((query) => query.isError)) {
    return "error";
  }
  if (queries.some((query) => query.isPending && query.fetchStatus !== "idle")) {
    return "loading";
  }
  return "ready";
}

function errorFromQueries(queries: Array<{ error: Error | null }>): string | undefined {
  return queries.map((query) => query.error?.message).find(Boolean);
}

function mutationError(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function requiredTinyOfficeValue(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}
