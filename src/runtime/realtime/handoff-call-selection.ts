export interface SelectableHandoffCall {
  timestamp: string;
}

export function selectSingleHandoffCall<T extends SelectableHandoffCall>(
  calls: T[],
): { selected?: T; suppressed: T[] } {
  const ordered = [...calls].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const [selected, ...suppressed] = ordered;
  return {
    selected,
    suppressed,
  };
}
