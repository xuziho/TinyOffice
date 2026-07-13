import { Avatar as DiceBearAvatar, Style } from "@dicebear/core";
import adventurerNeutral from "@dicebear/styles/adventurer-neutral.json" with { type: "json" };

const employeeAvatarStyle = new Style(adventurerNeutral);

export function employeeAvatarDataUri(avatarSeed: string): string {
  const seed = avatarSeed.trim();
  if (!seed) {
    throw new Error("EmployeeAvatar requires an authoritative avatarSeed.");
  }
  return new DiceBearAvatar(employeeAvatarStyle, {
    seed,
    size: 128,
  }).toDataUri();
}

export function newAvatarSeed(): string {
  return crypto.randomUUID();
}
