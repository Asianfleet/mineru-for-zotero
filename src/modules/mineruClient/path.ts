import { sanitizeErrorDetail } from "./http";

export function basename(path: string): string {
  return (
    path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || "file.pdf"
  );
}

export function normalizeBaseURL(url: string): string {
  return url.replace(/\/+$/, "");
}

export function toNativePath(path: string): string {
  if (/^[a-z]:\//i.test(path)) {
    return path.replace(/\//g, "\\");
  }
  return path;
}

export function safeURL(url: string | undefined): string {
  if (!url) {
    return "<missing-url>";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

export function summarizeBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "empty response";
  }
  const prefix = bytes.slice(0, 240);
  const text = sanitizeErrorDetail(new TextDecoder().decode(prefix));
  const hex = Array.from(bytes.slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
  return text ? `${text}; hex ${hex}` : `hex ${hex}`;
}

export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path)) {
    return false;
  }
  return path.split("/").every((part) => part && part !== "." && part !== "..");
}
