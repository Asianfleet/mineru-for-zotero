import { config } from "../../package.json";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

const PREFS_PREFIX = config.prefsPrefix;
const DEFAULT_LOCAL_API_BASE_URL = "http://127.0.0.1:8000";

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

export function getSaveImages(): boolean {
  const value = getPref("saveImages");
  return value !== false;
}

export function setSaveImages(value: boolean) {
  return setPref("saveImages", value);
}
