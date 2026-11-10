/** Client-side account types and helpers. The BFF validates the same rules on the server. */

export type AccountProfile = {
  email: string;
  fullName: string | null;
  jobTitle: string | null;
  timezone: string | null;
  birthDate: string | null;
  gender: string | null;
  avatarDataUrl: string | null;
  preferredSandboxProfile: string | null;
};

export type LoginSession = {
  id: string;
  /** null when the User-Agent is not recognised; the UI shows a localized fallback. */
  label: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

// Time zones offered in the profile. Any valid IANA name is accepted by the server.
export const PROFILE_TIMEZONES = [
  "Asia/Ho_Chi_Minh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
] as const;

export const AVATAR_ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const AVATAR_MAX_BYTES = 200 * 1024;
const AVATAR_SIZE_PX = 256;

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Crops the picture to a centred square, scales it to 256 px and encodes it under the size limit.
 * Throws when the browser cannot decode the file or no encoding fits.
 */
export async function resizeAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE_PX;
    canvas.height = AVATAR_SIZE_PX;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE_PX,
      AVATAR_SIZE_PX,
    );
    const attempts: Array<["image/webp" | "image/jpeg", number]> = [
      ["image/webp", 0.9],
      ["image/webp", 0.7],
      ["image/jpeg", 0.8],
      ["image/jpeg", 0.6],
    ];
    for (const [type, quality] of attempts) {
      const dataUrl = canvas.toDataURL(type, quality);
      if (dataUrlBytes(dataUrl) <= AVATAR_MAX_BYTES) return dataUrl;
    }
    throw new Error("Avatar does not fit the size limit");
  } finally {
    bitmap.close();
  }
}

export function isAcceptedAvatarFile(file: File): boolean {
  return (AVATAR_ACCEPTED_TYPES as readonly string[]).includes(file.type);
}

/** Initials for the avatar fallback: two letters from the name, or from the email. */
export function initialsFor(profile: Pick<AccountProfile, "fullName" | "email">): string {
  const source = profile.fullName?.trim() || profile.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : (parts[0]?.slice(0, 2) ?? "?");
  return letters.toUpperCase();
}
