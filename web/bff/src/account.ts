// Account helpers: profile and avatar validation, and a short label for login sessions.
// Kept free of I/O so the rules can be unit-tested.

export const FULL_NAME_MAX = 120;
export const JOB_TITLE_MAX = 120;
export const AVATAR_MAX_BYTES = 200 * 1024;
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

export type ProfileInput = { fullName: string | null; jobTitle: string | null; timezone: string | null };

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) return undefined;
  return trimmed === "" ? null : trimmed;
}

// Returns null when a field is malformed; empty strings clear the field.
export function parseProfileInput(body: Record<string, unknown> | undefined): ProfileInput | null {
  const fullName = optionalText(body?.fullName, FULL_NAME_MAX);
  const jobTitle = optionalText(body?.jobTitle, JOB_TITLE_MAX);
  if (fullName === undefined || jobTitle === undefined) return null;
  let timezone: string | null = null;
  if (body?.timezone !== undefined && body.timezone !== null && body.timezone !== "") {
    if (typeof body.timezone !== "string" || !isKnownTimezone(body.timezone)) return null;
    timezone = body.timezone;
  }
  return { fullName, jobTitle, timezone };
}

// Accepts any IANA name the runtime understands, including aliases such as Asia/Ho_Chi_Minh.
export function isKnownTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// Avatars are sent as a data URL the browser has already resized. Only PNG, JPEG and WebP are accepted.
export function validateAvatarDataUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = AVATAR_DATA_URL.exec(value);
  if (!match) return null;
  const decodedBytes = Math.floor((match[2].length * 3) / 4);
  if (decodedBytes <= 0 || decodedBytes > AVATAR_MAX_BYTES) return null;
  return value;
}

// "Chrome · Windows" style label from a User-Agent header. Returns null when neither part is recognised:
// the dashboard shows its own localized fallback, so the server does not hard-code one language.
export function describeUserAgent(userAgent: string): string | null {
  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /OPR\/|Opera/.test(userAgent) ? "Opera"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : null;
  const os =
    /Windows/.test(userAgent) ? "Windows"
    : /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iOS/.test(userAgent) ? "iOS"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Linux/.test(userAgent) ? "Linux"
    : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os ?? null;
}
