import { sanitizeErrorDetail } from "./http";

/**
 * 从本地路径中提取文件名，缺失时回退到默认 PDF 文件名。
 */
export function basename(path: string): string {
  return (
    path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || "file.pdf"
  );
}

/**
 * 标准化 MinerU base URL，移除末尾多余斜杠。
 */
export function normalizeBaseURL(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * 把 Windows 盘符形式的斜杠路径转换为 Zotero 原生路径。
 */
export function toNativePath(path: string): string {
  if (/^[a-z]:\//i.test(path)) {
    return path.replace(/\//g, "\\");
  }
  return path;
}

/**
 * 返回去除查询参数的安全 URL 摘要，避免日志暴露签名信息。
 */
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

/**
 * 生成响应字节摘要，用于诊断空响应或 ZIP 解析失败。
 */
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

/**
 * 判断 ZIP 内路径是否为安全的相对路径。
 */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path)) {
    return false;
  }
  return path.split("/").every((part) => part && part !== "." && part !== "..");
}
