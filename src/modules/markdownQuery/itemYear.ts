import type { ZoteroItemLike } from "./types";

/**
 * Read the publication year of an item as a four-digit string.
 *
 * Prefers Zotero's derived `year` field, which understands the date formats
 * users actually enter ("March 4, 2021", "Spring 2021", "2021-01-03"). Only
 * when that field is unavailable does it fall back to scanning the raw date
 * string for the first four-digit group.
 */
export function extractItemYear(item: ZoteroItemLike): string | undefined {
  const derived = (item.getField("year") ?? "").trim();
  if (/^\d{4}$/.test(derived)) {
    return derived;
  }

  const match = /(\d{4})/.exec(item.getField("date") ?? "");
  return match?.[1];
}
