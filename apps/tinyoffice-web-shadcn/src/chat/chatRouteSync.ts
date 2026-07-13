export type ChatRouteFocus = {
  roomId?: string;
  surface?: "direct" | "channel";
};

export function chatRouteFocusFromSearch(search: string): ChatRouteFocus {
  const params = new URLSearchParams(search);
  const roomId = params.get("roomId")?.trim();
  const surface = params.get("surface");
  return {
    ...(roomId ? { roomId } : {}),
    ...(surface === "direct" || surface === "channel" ? { surface } : {}),
  };
}

export function chatRouteForSelectedRoom(input: {
  selectedRoomId: string | undefined;
  selectedContainerKind: string | undefined;
}): string | undefined {
  if (!input.selectedRoomId) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("roomId", input.selectedRoomId);
  params.set("surface", input.selectedContainerKind === "member_dm" ? "direct" : "channel");
  return `/chat?${params.toString()}`;
}
