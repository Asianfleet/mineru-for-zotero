import { config } from "../../package.json";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

const PREFS_PREFIX = config.prefsPrefix;
const DEFAULT_LOCAL_API_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_LOCAL_API_TIMEOUT_MINUTES = 30;

export type ParseSource = "online" | "local";
export type ParseMode = "precise" | "lite";

/**
 * Get preference value.
 * Wrapper of `Zotero.Prefs.get`.
 * @param key
 */
export function getPref<K extends keyof PluginPrefsMap>(key: K) {
  return Zotero.Prefs.get(`${PREFS_PREFIX}.${key}`, true) as PluginPrefsMap[K];
}

/**
 * Set preference value.
 * Wrapper of `Zotero.Prefs.set`.
 * @param key
 * @param value
 */
export function setPref<K extends keyof PluginPrefsMap>(
  key: K,
  value: PluginPrefsMap[K],
) {
  return Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

/**
 * Clear preference value.
 * Wrapper of `Zotero.Prefs.clear`.
 * @param key
 */
export function clearPref(key: string) {
  return Zotero.Prefs.clear(`${PREFS_PREFIX}.${key}`, true);
}

export function getApiKey(): string {
  const value = getPref("apiKey");
  return typeof value === "string" ? value : "";
}

export function setApiKey(value: string) {
  return setPref("apiKey", value);
}

/**
 * Read the configured parse source and fall back to the default value.
 */
export function getParseSource(): ParseSource {
  const value = getPref("parseSource");
  return value === "local" ? "local" : "online";
}

/**
 * Persist the parse source preference.
 */
export function setParseSource(value: ParseSource) {
  return setPref("parseSource", value);
}

/**
 * Read the configured parse mode and fall back to the default value.
 */
export function getParseMode(): ParseMode {
  const value = getPref("parseMode");
  return value === "lite" ? "lite" : "precise";
}

/**
 * Persist the parse mode preference.
 */
export function setParseMode(value: ParseMode) {
  return setPref("parseMode", value);
}

/**
 * Read the configured local API base URL with a stable default.
 */
export function getLocalApiBaseURL(): string {
  const value = getPref("localApiBaseURL");
  return typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_LOCAL_API_BASE_URL;
}

/**
 * Persist the local API base URL preference.
 */
export function setLocalApiBaseURL(value: string) {
  return setPref("localApiBaseURL", value);
}

/**
 * Read the configured local API polling timeout in minutes.
 */
export function getLocalApiTimeoutMinutes(): number {
  const value = getPref("localApiTimeoutMinutes");
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : DEFAULT_LOCAL_API_TIMEOUT_MINUTES;
}

/**
 * Persist the local API polling timeout in minutes.
 */
export function setLocalApiTimeoutMinutes(value: number) {
  return setPref("localApiTimeoutMinutes", value);
}

/**
 * 读取 Markdown 查询 API 是否启用。
 */
export function getMarkdownApiEnabled(): boolean {
  return getPref("apiEnabled") === true;
}

/**
 * 持久化 Markdown 查询 API 启用状态。
 */
export function setMarkdownApiEnabled(value: boolean) {
  return setPref("apiEnabled", value);
}

/**
 * 读取 Markdown 查询 API 是否要求 token，默认开启。
 */
export function getMarkdownApiRequireToken(): boolean {
  return getPref("apiRequireToken") !== false;
}

/**
 * 持久化 Markdown 查询 API 的 token 校验开关。
 */
export function setMarkdownApiRequireToken(value: boolean) {
  return setPref("apiRequireToken", value);
}

/**
 * 读取 Markdown 查询 API token。
 */
export function getMarkdownApiToken(): string {
  const value = getPref("apiToken");
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  const token = generateMarkdownApiToken();
  setMarkdownApiToken(token);
  return token;
}

/**
 * 持久化 Markdown 查询 API token。
 */
export function setMarkdownApiToken(value: string) {
  return setPref("apiToken", value);
}

/**
 * 生成适合 URL 传输的随机 token。
 */
export function generateMarkdownApiToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToUrlToken(bytes);
}

export function getSaveImages(): boolean {
  const value = getPref("saveImages");
  return value !== false;
}

export function setSaveImages(value: boolean) {
  return setPref("saveImages", value);
}

/**
 * 将字节数组编码为 URL-safe token。
 */
function bytesToUrlToken(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
