export function employeeIdSlugFromDisplayName(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "employee";
}

export function deriveUniqueEmployeeId(input: {
  displayName: string;
  existingIds: Iterable<string>;
}): string {
  const baseEmployeeId = employeeIdSlugFromDisplayName(input.displayName);
  const existingIds = new Set(Array.from(input.existingIds, (id) => id.toLowerCase()));
  if (!existingIds.has(baseEmployeeId.toLowerCase())) {
    return baseEmployeeId;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${baseEmployeeId}-${suffix}`;
    if (!existingIds.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  throw new Error(`Unable to derive a unique employeeId from ${input.displayName}.`);
}
