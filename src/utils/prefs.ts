import { config } from "../../package.json";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

const PREFS_PREFIX = config.prefsPrefix;
const DEFAULT_LOCAL_API_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_LOCAL_API_TIMEOUT_MINUTES = 30;
const DEFAULT_SYNC_FOLDER = "";
const DEFAULT_AUTO_PARSE_PAGE_LIMIT = 0;

export type ParseSource = "online" | "local";
export type ParseMode = "precise" | "lite";
export type ParseTier = "flash" | "basic" | "standard" | "advanced";

const PARSE_TIERS: ParseTier[] = ["flash", "basic", "standard", "advanced"];

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
 * Read the configured parse tier and fall back to the default value.
 */
export function getParseTier(): ParseTier {
  const value = getPref("parseTier");
  return PARSE_TIERS.includes(value as ParseTier)
    ? (value as ParseTier)
    : "standard";
}

/**
 * Persist the parse tier preference.
 */
export function setParseTier(value: ParseTier) {
  return setPref("parseTier", value);
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
 * Read whether the Markdown query API is enabled.
 */
export function getMarkdownApiEnabled(): boolean {
  return getPref("apiEnabled") === true;
}

/**
 * Persist the enabled state of the Markdown query API.
 */
export function setMarkdownApiEnabled(value: boolean) {
  return setPref("apiEnabled", value);
}

export function getSaveImages(): boolean {
  const value = getPref("saveImages");
  return value !== false;
}

export function setSaveImages(value: boolean) {
  return setPref("saveImages", value);
}

/**
 * Read whether MinerU status tags ("MinerU: Precise ✅", ...) are written to
 * attachments. They sync to zotero.org and into shared group libraries, so
 * users can turn them off; the item tree column shows the status either way.
 */
export function getStatusTagsEnabled(): boolean {
  return getPref("statusTags") !== false;
}

export function setStatusTagsEnabled(value: boolean) {
  return setPref("statusTags", value);
}

export function getSyncFolder(): string {
  const value = getPref("syncFolder" as keyof PluginPrefsMap);
  return typeof value === "string" ? value : DEFAULT_SYNC_FOLDER;
}

export function setSyncFolder(value: string) {
  return setPref("syncFolder" as keyof PluginPrefsMap, value);
}

export function getAutoParsePageLimit(): number {
  const value = getPref("autoParsePageLimit" as keyof PluginPrefsMap);
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_AUTO_PARSE_PAGE_LIMIT;
}

export function setAutoParsePageLimit(value: number) {
  return setPref("autoParsePageLimit" as keyof PluginPrefsMap, value);
}
