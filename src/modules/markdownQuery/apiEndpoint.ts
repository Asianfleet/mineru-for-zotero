import { getMarkdownApiEnabled } from "../../utils/prefs";
import { getMinerUStorageRoot } from "../preferenceScript";
import { createStorage } from "../storage";
import { extractItemYear } from "./itemYear";
import {
  createMarkdownQueryService,
  MarkdownQueryService,
} from "./queryService";
import { MarkdownQueryError, ZoteroItemLike } from "./types";
import type { ItemSearchInput } from "./types";

interface MarkdownEndpointRequest {
  method: "GET" | "POST";
  pathname: string;
  searchParams?: URLSearchParams;
  query: Record<string, string>;
  headers: Record<string, string>;
  data: unknown;
}

export const MARKDOWN_ENDPOINT_PATHS = [
  "/mineru-for-zotero/search",
  "/mineru-for-zotero/markdown",
  "/mineru-for-zotero/parse",
  "/mineru-for-zotero/tasks",
  "/mineru-for-zotero/libraries",
  "/mineru-for-zotero/collections",
  "/mineru-for-zotero/tags",
] as const;

/**
 * Register the Markdown query HTTP endpoint for external local clients.
 *
 * Safety note: this endpoint does not add its own authentication. It relies on
 * Zotero's HTTP server, which binds to 127.0.0.1, rejects non-local `Host`
 * headers (DNS rebinding) and drops browser-originated requests unless an
 * endpoint opts in with `allowRequestsFromUnsafeWebContent`. The practical
 * exposure is therefore another local process running as the same user, which
 * could already read the Zotero data directory. The API stays opt-in through
 * the `apiEnabled` preference.
 */
export function registerMarkdownQueryApiEndpoint(): void {
  const service = createMarkdownQueryService({
    items: Zotero.Items,
    storage: createStorage(getMinerUStorageRoot()),
    searchItems,
  });
  const EndpointClass = createMarkdownQueryEndpointClass(service);

  for (const path of MARKDOWN_ENDPOINT_PATHS) {
    Zotero.Server.Endpoints[path] = toZoteroEndpoint(EndpointClass);
  }
}

/**
 * Unregister the Markdown query HTTP endpoint to avoid residual routes when the plugin is disabled.
 */
export function unregisterMarkdownQueryApiEndpoint(): void {
  for (const path of MARKDOWN_ENDPOINT_PATHS) {
    delete Zotero.Server.Endpoints[path];
  }
}

/**
 * Create an endpoint instance handling both title search and Markdown retrieval.
 */
export function createMarkdownQueryEndpoint(service: MarkdownQueryService) {
  return {
    supportedMethods: ["GET", "POST"],
    async init(options: MarkdownEndpointRequest) {
      try {
        const query = getQuery(options);
        authorize();
        let payload;
        if (options.pathname === "/mineru-for-zotero/search") {
          payload = await service.searchByTitle({
            libraryID: requireInteger(query.libraryID, "libraryID"),
            ...pickDefined({
              title: optionalString(query.title),
              creator: optionalString(query.creator),
              year: parseYearParam(query.year),
              tag: optionalString(query.tag),
              collection: optionalString(query.collection),
              abstract: optionalString(query.abstract),
              publication: optionalString(query.publication),
              citekey: optionalString(query.citekey),
              doi: optionalString(query.doi),
              itemType: optionalString(query.itemType),
              since: optionalString(query.since),
              hasPdf: parseOptionalBoolean(query.hasPdf),
              parsedOnly: parseOptionalBoolean(query.parsedOnly),
              sortBy: parseSortBy(query.sortBy),
              sortOrder: parseSortOrder(query.sortOrder),
              limit: parseOptionalLimit(query.limit),
            }),
          });
        } else if (options.pathname === "/mineru-for-zotero/libraries") {
          payload = await service.getLibraries();
        } else if (options.pathname === "/mineru-for-zotero/collections") {
          payload = await service.getCollections({
            libraryID: requireInteger(query.libraryID, "libraryID"),
            parentKey: optionalString(
              query.parentKey || query.parentCollectionKey,
            ),
          });
        } else if (options.pathname === "/mineru-for-zotero/tags") {
          payload = await service.getTags({
            libraryID: requireInteger(query.libraryID, "libraryID"),
            limit: parseOptionalLimit(query.limit),
          });
        } else if (options.pathname === "/mineru-for-zotero/parse") {
          if (options.method !== "POST")
            throw new MarkdownQueryError(
              "invalid-request",
              405,
              "Method not allowed",
            );
          payload = await service.triggerParse({
            libraryID: requireInteger(query.libraryID, "libraryID"),
            key: requireString(query.key, "key"),
            attachmentKey: optionalString(query.attachmentKey),
          });
        } else if (options.pathname === "/mineru-for-zotero/tasks") {
          payload = await service.getTasks();
        } else {
          payload = await service.queryMarkdown({
            libraryID: requireInteger(query.libraryID, "libraryID"),
            key: requireString(query.key, "key"),
            attachmentKey: optionalString(query.attachmentKey),
            granularity: optionalString(query.granularity) as
              | "full"
              | "headings"
              | "section"
              | "search"
              | undefined,
            sectionPath: parseSectionPath(query.sectionPath),
            includeSubsections: parseOptionalBoolean(query.includeSubsections),
            q: optionalString(query.q),
            contextParagraphs: parseOptionalInteger(query.contextParagraphs),
          });
        }

        return json(200, payload);
      } catch (error) {
        return jsonError(error);
      }
    },
  };
}

/**
 * Create constructible endpoint class required by Zotero.Server.Endpoints.
 */
export function createMarkdownQueryEndpointClass(
  service: MarkdownQueryService,
) {
  const endpoint = createMarkdownQueryEndpoint(service);

  return class MarkdownQueryEndpoint {
    supportedMethods = endpoint.supportedMethods;

    /**
     * Delegate to shared endpoint logic to maintain consistent behavior across tests and runtime.
     */
    init(options: MarkdownEndpointRequest) {
      return endpoint.init(options);
    }
  };
}

/**
 * Adapt promise-style endpoint object to zotero-types current endpoint registration type.
 */
function toZoteroEndpoint(
  EndpointClass: ReturnType<typeof createMarkdownQueryEndpointClass>,
) {
  return EndpointClass as unknown as typeof _ZoteroTypes.Server.Endpoint;
}

/**
 * Fuzzy search items in the library via Zotero.Search by title, creator, tag, etc.
 */
async function searchItems(input: ItemSearchInput): Promise<ZoteroItemLike[]> {
  const search = new Zotero.Search({ libraryID: input.libraryID });
  if (input.title) {
    search.addCondition("title", "contains", input.title);
  }
  if (input.creator) {
    search.addCondition("creator", "contains", input.creator);
  }
  if (input.tag) {
    search.addCondition("tag", "is", input.tag);
  }
  if (input.abstract) {
    search.addCondition("abstractNote", "contains", input.abstract);
  }
  if (input.publication) {
    search.addCondition("publicationTitle", "contains", input.publication);
  }
  if (input.doi) {
    search.addCondition("DOI", "contains", input.doi);
  }
  if (input.itemType) {
    search.addCondition("itemType", "is", input.itemType);
  }
  if (input.collection) {
    const col = resolveSearchCollection(input.libraryID, input.collection);
    search.addCondition("collectionID", "is", col.id);
  }

  const ids = await search.search();
  let items = await Zotero.Items.getAsync(ids);

  if (input.year) {
    items = items.filter((item) => itemMatchesYear(item, input.year!));
  }
  if (input.citekey) {
    const targetKey = input.citekey.toLowerCase();
    items = items.filter((item) => {
      const extra = item.getField("extra") || "";
      const match = /Citation Key:\s*([^\s\n]+)/i.exec(extra);
      if (match && match[1].toLowerCase().includes(targetKey)) {
        return true;
      }
      try {
        const fieldKey = item.getField("citationKey");
        if (fieldKey && fieldKey.toLowerCase().includes(targetKey)) {
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    });
  }
  if (input.since) {
    const sinceDate = input.since.trim();
    items = items.filter((item) => {
      const added = item.dateAdded || item.getField("dateAdded") || "";
      return added.startsWith(sinceDate) || added >= sinceDate;
    });
  }
  if (input.hasPdf) {
    const itemAttachments = await Promise.all(
      items.map(async (item) => {
        if (item.isPDFAttachment()) return { item, hasPdf: true };
        const attIds = item.getAttachments(false);
        if (!attIds || attIds.length === 0) return { item, hasPdf: false };
        const atts = await Zotero.Items.getAsync(attIds);
        return { item, hasPdf: atts.some((a) => a.isPDFAttachment()) };
      }),
    );
    items = itemAttachments.filter((x) => x.hasPdf).map((x) => x.item);
  }

  if (input.sortBy) {
    const order = input.sortOrder === "asc" ? 1 : -1;
    items.sort((a, b) => {
      let valA = "";
      let valB = "";
      if (input.sortBy === "dateAdded") {
        valA = a.dateAdded || a.getField("dateAdded") || "";
        valB = b.dateAdded || b.getField("dateAdded") || "";
      } else if (input.sortBy === "dateModified") {
        valA = a.dateModified || a.getField("dateModified") || "";
        valB = b.dateModified || b.getField("dateModified") || "";
      } else if (input.sortBy === "year") {
        valA = extractItemYear(a) ?? "";
        valB = extractItemYear(b) ?? "";
      } else if (input.sortBy === "title") {
        valA = a.getDisplayTitle() || a.getField("title") || "";
        valB = b.getDisplayTitle() || b.getField("title") || "";
      }
      return valA.localeCompare(valB) * order;
    });
  }

  if (input.limit !== undefined) {
    items = items.slice(0, input.limit);
  }
  return items;
}

interface SearchCollection {
  id: number;
  key: string;
  name?: string;
}

/** The parts of `Zotero.Collections` used to resolve a collection filter. */
export interface SearchCollectionLookup {
  getByLibraryAndKey?(
    libraryID: number,
    key: string,
  ): SearchCollection | false | undefined;
  getByLibrary?(libraryID: number): SearchCollection[];
}

/**
 * Resolve the `collection` search filter by key or case-insensitive name.
 *
 * An unknown collection is an error: dropping the filter would silently
 * search the whole library and present those items as the folder's contents.
 * Exported for tests.
 */
export function resolveSearchCollection(
  libraryID: number,
  collectionParam: string,
  collections: SearchCollectionLookup | undefined = typeof Zotero ===
  "undefined"
    ? undefined
    : (Zotero as unknown as { Collections?: SearchCollectionLookup })
        .Collections,
): { id: number; key: string } {
  const byKey = collections?.getByLibraryAndKey?.(libraryID, collectionParam);
  if (byKey) {
    return byKey;
  }
  const all = collections?.getByLibrary?.(libraryID);
  const target = collectionParam.toLowerCase();
  const byName = (Array.isArray(all) ? all : []).find(
    (collection) =>
      String(collection.key).toLowerCase() === target ||
      String(collection.name).toLowerCase() === target,
  );
  if (byName) {
    return byName;
  }
  throw new MarkdownQueryError(
    "collection-not-found",
    404,
    `Collection was not found: ${collectionParam}`,
  );
}

/**
 * Check whether the item's publication year matches the requested year.
 *
 * Uses Zotero's derived `year` field so that non-ISO dates ("March 4, 2021")
 * match, instead of comparing the raw date string. Exported for tests.
 */
export function itemMatchesYear(item: ZoteroItemLike, year: string): boolean {
  const target = year.trim();
  if (!target) {
    return false;
  }
  return extractItemYear(item) === target;
}

/**
 * Verify that the local query API is enabled. The endpoint has no token: the
 * feature was removed from the settings UI, so it must not be enforced here.
 */
function authorize(): void {
  if (!getMarkdownApiEnabled()) {
    throw new MarkdownQueryError(
      "api-disabled",
      403,
      "Markdown query API is disabled",
    );
  }
}

/**
 * Support both query dictionary in unit tests and searchParams passed by Zotero runtime.
 */
function getQuery(options: MarkdownEndpointRequest): Record<string, string> {
  if (options.searchParams) {
    return Object.fromEntries(options.searchParams.entries());
  }
  return options.query;
}

/**
 * Read a required string parameter, throwing standard request error if missing.
 */
function requireString(value: string | undefined, name: string): string {
  const text = optionalString(value);
  if (!text) {
    throw new MarkdownQueryError(
      "invalid-request",
      400,
      `Missing required parameter: ${name}`,
    );
  }
  return text;
}

/**
 * Read a required integer parameter, rejecting non-integer values.
 */
function requireInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new MarkdownQueryError(
      "invalid-request",
      400,
      `Invalid integer parameter: ${name}`,
    );
  }
  return parsed;
}

/**
 * Sanitize optional string parameter, treating whitespace as absent.
 */
function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Strip undefined fields to keep injected parameter shapes clean.
 */
function pickDefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * Parse optional year parameter, requiring an exact four-digit numeric string.
 */
function parseYearParam(value: string | undefined): string | undefined {
  const text = optionalString(value);
  if (text === undefined) {
    return undefined;
  }
  if (!/^\d{4}$/.test(text)) {
    throw new MarkdownQueryError(
      "invalid-request",
      400,
      `Invalid year parameter: ${text}`,
    );
  }
  return text;
}

/**
 * Parse optional positive integer limit parameter, rejecting invalid values.
 */
function parseOptionalLimit(value: string | undefined): number | undefined {
  const parsed = parseOptionalInteger(value);
  if (parsed !== undefined && parsed <= 0) {
    throw new MarkdownQueryError(
      "invalid-request",
      400,
      `Invalid positive integer parameter: ${value}`,
    );
  }
  return parsed;
}

/**
 * Parse optional sort field.
 */
function parseSortBy(
  value: string | undefined,
): "dateAdded" | "dateModified" | "title" | "year" | undefined {
  const text = optionalString(value);
  if (!text) {
    return undefined;
  }
  if (["dateAdded", "dateModified", "title", "year"].includes(text)) {
    return text as "dateAdded" | "dateModified" | "title" | "year";
  }
  throw new MarkdownQueryError(
    "invalid-request",
    400,
    `Invalid sortBy parameter: ${text}`,
  );
}

/**
 * Parse optional sort direction.
 */
function parseSortOrder(value: string | undefined): "asc" | "desc" | undefined {
  const text = optionalString(value);
  if (!text) {
    return undefined;
  }
  const lower = text.toLowerCase();
  if (lower === "asc" || lower === "desc") {
    return lower;
  }
  throw new MarkdownQueryError(
    "invalid-request",
    400,
    `Invalid sortOrder parameter: ${text}`,
  );
}

/**
 * Parse optional boolean parameter, accepting only true/1 as truthy.
 */
function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  const text = optionalString(value);
  if (text === undefined) {
    return undefined;
  }
  return text === "true" || text === "1";
}

/**
 * Parse optional integer parameter, letting downstream defaults handle invalid values.
 */
function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

/**
 * Allow sectionPath as JSON array, slash-delimited path, or single string.
 */
function parseSectionPath(
  value: string | undefined,
): string[] | string | undefined {
  const text = optionalString(value);
  if (!text) {
    return undefined;
  }
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (
        Array.isArray(parsed) &&
        parsed.every((part) => typeof part === "string")
      ) {
        return parsed;
      }
    } catch {
      // Fall back to string path parsing.
    }
  }

  const parts = text
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : text;
}

/**
 * Generate a standard JSON HTTP response tuple.
 */
function json(code: number, payload: unknown) {
  return [code, "application/json", JSON.stringify(payload)] as const;
}

/**
 * Map domain errors to a stable JSON error response.
 */
function jsonError(error: unknown) {
  if (error instanceof MarkdownQueryError) {
    return json(error.status, {
      error: error.code,
      message: error.message,
      ...(typeof error.details === "object" && error.details
        ? (error.details as Record<string, unknown>)
        : {}),
    });
  }

  logUnexpectedError(error);
  return json(500, {
    error: "internal-error",
    message: "Unexpected internal error",
  });
}

/**
 * Log unexpected internal errors to Zotero debug without impacting test environment or HTTP response.
 */
function logUnexpectedError(error: unknown): void {
  const debug = (
    globalThis as unknown as {
      Zotero?: { debug?: (message: string) => void };
    }
  ).Zotero?.debug;
  if (typeof debug !== "function") {
    return;
  }

  const detail =
    error instanceof Error
      ? (error.stack ?? error.message)
      : String(error ?? "Unknown error");
  debug(`[MinerU] Markdown query API internal error: ${detail}`);
}
