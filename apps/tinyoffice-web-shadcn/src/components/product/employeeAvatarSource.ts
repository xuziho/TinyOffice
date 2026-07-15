import { Avatar as DiceBearAvatar, Style } from "@dicebear/core";
import adventurerNeutral from "@dicebear/styles/adventurer-neutral.json" with { type: "json" };

const employeeAvatarStyle = new Style(adventurerNeutral);
const avatarDataUriCache = new Map<string, string>();
const maxCachedAvatars = 128;

export function employeeAvatarDataUri(avatarSeed: string): string {
  const seed = avatarSeed.trim();
  if (!seed) {
    throw new Error("EmployeeAvatar requires an authoritative avatarSeed.");
  }
  const cached = avatarDataUriCache.get(seed);
  if (cached) {
    return cached;
  }
  const dataUri = new DiceBearAvatar(employeeAvatarStyle, {
    seed,
    size: 128,
  }).toDataUri();
  if (avatarDataUriCache.size >= maxCachedAvatars) {
    const oldestSeed = avatarDataUriCache.keys().next().value;
    if (oldestSeed) avatarDataUriCache.delete(oldestSeed);
  }
  avatarDataUriCache.set(seed, dataUri);
  return dataUri;
}

export function newAvatarSeed(): string {
  return crypto.randomUUID();
}
