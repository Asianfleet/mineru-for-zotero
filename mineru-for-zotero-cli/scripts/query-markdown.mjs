#!/usr/bin/env node
/* global AbortController, URL, clearTimeout, console, fetch, process, setTimeout */

const DEFAULT_BASE_URL = "http://127.0.0.1:23124";
const DEFAULT_FORMAT = "text";
const DEFAULT_TIMEOUT_MS = 30000;
const SEARCH_ENDPOINT = "/mineru-for-zotero/search";
const MARKDOWN_ENDPOINT = "/mineru-for-zotero/markdown";
const VALID_FORMATS = new Set(["text", "json"]);
const VALID_GRANULARITIES = new Set(["full", "headings", "section", "search"]);

/**
 * Runs the CLI entry point and maps failures to stable process output.
 */
async function main(argv) {
  let options;
  try {
    options = parseCommand(argv);
    if (options.help) {
      console.log(helpText());
      return 0;
    }
  } catch (error) {
    writeArgumentError(error);
    return 2;
  }

  try {
    const response = await requestMarkdownApi(options);
    const envelope = createSuccessEnvelope(options, response);
    if (options.format === "json") {
      console.log(JSON.stringify(envelope, null, 2));
    } else {
      console.log(formatTextSuccess(options, response));
    }
    return 0;
  } catch (error) {
    const envelope = createErrorEnvelope(options, error);
    if (options.format === "json") {
      console.log(JSON.stringify(envelope, null, 2));
    } else {
      console.error(formatTextError(envelope));
    }
    return envelope.status >= 400 && envelope.status < 600 ? 1 : 2;
  }
}

/**
 * Parses subcommands and flag values into a normalized request description.
 */
function parseCommand(argv) {
  if (argv.length === 0 || argv.includes("--help")) {
    return { help: true };
  }

  const [command, ...rest] = argv;
  if (command !== "search" && command !== "markdown") {
    throw new CliArgumentError(`Unknown command: ${command}`);
  }

  const flags = parseFlags(rest);
  const format = getFlag(flags, "--format", DEFAULT_FORMAT);
  if (!VALID_FORMATS.has(format)) {
    throw new CliArgumentError("Invalid --format. Expected text or json.");
  }

  const baseUrl = normalizeBaseUrl(
    getFlag(flags, "--base-url", DEFAULT_BASE_URL),
  );
  const timeoutMs = parsePositiveInteger(
    getFlag(flags, "--timeout-ms", String(DEFAULT_TIMEOUT_MS)),
    "--timeout-ms",
  );
  const token = getFlag(flags, "--token");
  const libraryID = getRequiredFlag(flags, "--library-id");
  parseInteger(libraryID, "--library-id");

  if (command === "search") {
    const title = getRequiredFlag(flags, "--title");
    return {
      command,
      endpoint: SEARCH_ENDPOINT,
      baseUrl,
      format,
      timeoutMs,
      token,
      params: {
        libraryID,
        title,
      },
    };
  }

  const key = getRequiredFlag(flags, "--key");
  const granularity = getFlag(flags, "--granularity", "full");
  if (!VALID_GRANULARITIES.has(granularity)) {
    throw new CliArgumentError(
      "Invalid --granularity. Expected full, headings, section, or search.",
    );
  }

  const params = {
    libraryID,
    key,
    granularity,
  };
  addOptionalParam(params, "attachmentKey", getFlag(flags, "--attachment-key"));
  addOptionalParam(params, "sectionPath", getFlag(flags, "--section-path"));
  addOptionalParam(params, "q", getFlag(flags, "--query"));

  const contextParagraphs = getFlag(flags, "--context-paragraphs");
  if (contextParagraphs !== undefined) {
    parseInteger(contextParagraphs, "--context-paragraphs");
    params.contextParagraphs = contextParagraphs;
  }

  return {
    command,
    endpoint: MARKDOWN_ENDPOINT,
    baseUrl,
    format,
    timeoutMs,
    token,
    params,
  };
}

/**
 * Parses command-line flags that use the `--flag value` shape.
 */
function parseFlags(args) {
  const flags = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name.startsWith("--")) {
      throw new CliArgumentError(`Unexpected argument: ${name}`);
    }
    if (name === "--help") {
      flags.set(name, "true");
      continue;
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliArgumentError(`Missing value for option: ${name}`);
    }
    flags.set(name, value);
    index += 1;
  }
  return flags;
}

/**
 * Fetches JSON from the local Zotero Markdown query API.
 */
async function requestMarkdownApi(options) {
  const url = new URL(options.endpoint, options.baseUrl);
  for (const [key, value] of Object.entries(options.params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const headers = {};
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new ApiError(response.status, payload);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new NetworkError(`Request timed out after ${options.timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parses an HTTP response body as JSON and reports malformed responses clearly.
 */
async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new NetworkError(
      `API returned non-JSON response with status ${response.status}`,
    );
  }
}

/**
 * Creates the stable JSON envelope for successful API responses.
 */
function createSuccessEnvelope(options, data) {
  return {
    ok: true,
    request: createRequestSummary(options),
    status: 200,
    data,
  };
}

/**
 * Creates the stable JSON envelope for API, network, and argument errors.
 */
function createErrorEnvelope(options, error) {
  if (error instanceof ApiError) {
    const { error: code, message, ...details } = error.payload;
    return {
      ok: false,
      request: createRequestSummary(options),
      status: error.status,
      error: {
        code: code || "api-error",
        message: message || "API request failed",
        details,
      },
    };
  }

  return {
    ok: false,
    request: createRequestSummary(options),
    status: 0,
    error: {
      code: "network-error",
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  };
}

/**
 * Builds a request summary without sensitive token values.
 */
function createRequestSummary(options) {
  return {
    command: options.command,
    baseUrl: options.baseUrl,
    endpoint: options.endpoint,
    params: options.params,
  };
}

/**
 * Formats successful API payloads as direct agent-readable text.
 */
function formatTextSuccess(options, data) {
  if (options.command === "search") {
    return formatSearchText(options, data);
  }
  return formatMarkdownText(options, data);
}

/**
 * Formats title search candidates.
 */
function formatSearchText(options, data) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const lines = [
    "Markdown Query Search",
    `Library: ${options.params.libraryID}`,
    `Title: ${options.params.title}`,
    `Candidates: ${candidates.length}`,
  ];

  candidates.forEach((candidate, index) => {
    const item = candidate.item ?? {};
    const attachments = Array.isArray(candidate.attachments)
      ? candidate.attachments
      : [];
    lines.push(
      "",
      `${index + 1}. ${valueOrUnknown(item.title)}`,
      `   itemID: ${valueOrUnknown(item.itemID)}`,
      `   key: ${valueOrUnknown(item.key)}`,
      `   type: ${valueOrUnknown(item.type)}`,
      "   attachments:",
    );

    if (attachments.length === 0) {
      lines.push("   - none");
      return;
    }

    for (const attachment of attachments) {
      lines.push(
        `   - ${valueOrUnknown(attachment.fileName)}`,
        `     itemID: ${valueOrUnknown(attachment.itemID)}`,
        `     key: ${valueOrUnknown(attachment.key)}`,
        `     parsed: precise=${yesNo(attachment.preciseReady)} lite=${yesNo(
          attachment.liteReady,
        )}`,
      );
    }
  });

  return lines.join("\n");
}

/**
 * Formats Markdown query responses according to their granularity.
 */
function formatMarkdownText(options, data) {
  const lines = [
    "Markdown Query Result",
    `Library: ${options.params.libraryID}`,
    `Item: ${valueOrUnknown(data.item?.key ?? options.params.key)}`,
    `Attachment: ${formatAttachment(data.attachment)}`,
    `Title: ${valueOrUnknown(data.item?.title)}`,
    `Granularity: ${valueOrUnknown(data.granularity ?? options.params.granularity)}`,
    `Mode: ${valueOrUnknown(data.result?.mode)}`,
    "",
  ];

  const granularity = data.granularity ?? options.params.granularity;
  if (granularity === "headings") {
    lines.push("[Headings]", ...formatHeadings(data.headings));
  } else if (granularity === "section") {
    lines.push(...formatSection(data));
  } else if (granularity === "search") {
    lines.push(...formatSearchMatches(data));
  } else {
    lines.push("[Content]", data.content ?? "");
  }

  return lines.join("\n");
}

/**
 * Formats heading records as a compact path list.
 */
function formatHeadings(headings) {
  if (!Array.isArray(headings) || headings.length === 0) {
    return ["(none)"];
  }

  return headings.flatMap((heading) => [
    `- ${"#".repeat(Number(heading.level) || 1)} ${valueOrUnknown(
      heading.title,
    )}`,
    `  path: ${formatPath(heading.path)}`,
    `  line: ${valueOrUnknown(heading.line)}`,
  ]);
}

/**
 * Formats a single Markdown section response.
 */
function formatSection(data) {
  return [
    "[Section]",
    `Heading: ${valueOrUnknown(data.heading?.title)}`,
    `Path: ${formatPath(data.heading?.path)}`,
    `Line: ${valueOrUnknown(data.heading?.line)}`,
    "",
    data.content ?? "",
  ];
}

/**
 * Formats paragraph search matches with highlighted hit paragraphs.
 */
function formatSearchMatches(data) {
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const lines = [
    `Query: ${valueOrUnknown(data.query)}`,
    `Matches: ${matches.length}`,
  ];

  matches.forEach((match, index) => {
    lines.push(
      "",
      `[Match ${index + 1}]`,
      `Paragraph: ${match.paragraphIndex}`,
    );
    const before = Array.isArray(match.before) ? match.before : [];
    const after = Array.isArray(match.after) ? match.after : [];
    for (const paragraph of before) {
      lines.push("", paragraph);
    }
    lines.push("", `>> ${valueOrUnknown(match.hit)}`);
    for (const paragraph of after) {
      lines.push("", paragraph);
    }
  });

  return lines;
}

/**
 * Formats API and network errors for direct agent reading.
 */
function formatTextError(envelope) {
  const lines = [
    `Error: ${envelope.error.code}`,
    `Message: ${envelope.error.message}`,
    `HTTP Status: ${envelope.status}`,
  ];
  const hint = hintForError(envelope.error.code);
  if (hint) {
    lines.push("", `Hint: ${hint}`);
  }
  const candidates = envelope.error.details?.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    lines.push("", "Candidates:");
    for (const candidate of candidates) {
      lines.push(
        `- ${valueOrUnknown(candidate.fileName)} key=${valueOrUnknown(
          candidate.key,
        )} score=${valueOrUnknown(candidate.score)}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Returns a short next-step hint for common API errors.
 */
function hintForError(code) {
  const hints = {
    "api-disabled": "Enable the Markdown query API in Zotero preferences.",
    "invalid-token": "Check the --token value from Zotero preferences.",
    "ambiguous-attachment":
      "Pass --attachment-key with one of the candidate keys.",
    "parse-result-not-found":
      "Parse this PDF in Zotero first, or choose another attachment with --attachment-key.",
    "section-not-found":
      "Run with --granularity headings first and use an exact heading path.",
    "missing-query": "Pass a non-empty --query value.",
  };
  return hints[code];
}

/**
 * Writes argument errors together with concise usage guidance.
 */
function writeArgumentError(error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  console.error(helpText());
}

/**
 * Returns CLI usage text.
 */
function helpText() {
  return [
    "Usage:",
    "  node skill/scripts/query-markdown.mjs search --library-id <id> --title <text> [--format text|json]",
    "  node skill/scripts/query-markdown.mjs markdown --library-id <id> --key <key> [--granularity full|headings|section|search] [--format text|json]",
    "",
    "Common options:",
    "  --base-url <url>             Zotero local server URL. Default: http://127.0.0.1:23119",
    "  --token <token>              Markdown query API token. Sent as Authorization: Bearer.",
    "  --format <text|json>         Output format. Default: text",
    "  --timeout-ms <number>        Request timeout. Default: 30000",
    "",
    "Markdown options:",
    "  --attachment-key <key>       Select a specific PDF attachment under a regular item.",
    "  --section-path <path>        Section path for granularity=section.",
    "  --query <text>               Search query for granularity=search.",
    "  --context-paragraphs <n>     Context paragraphs for granularity=search.",
  ].join("\n");
}

/**
 * Adds an optional API query parameter when a flag is present.
 */
function addOptionalParam(params, name, value) {
  if (value !== undefined) {
    params[name] = value;
  }
}

/**
 * Reads an optional parsed flag value.
 */
function getFlag(flags, name, defaultValue) {
  return flags.has(name) ? flags.get(name) : defaultValue;
}

/**
 * Reads a required parsed flag value.
 */
function getRequiredFlag(flags, name) {
  const value = getFlag(flags, name);
  if (value === undefined || value.trim() === "") {
    throw new CliArgumentError(`Missing required option: ${name}`);
  }
  return value;
}

/**
 * Parses an integer option for validation without changing API string output.
 */
function parseInteger(value, name) {
  if (!Number.isInteger(Number(value))) {
    throw new CliArgumentError(`Invalid integer for option: ${name}`);
  }
}

/**
 * Parses a positive integer option.
 */
function parsePositiveInteger(value, name) {
  parseInteger(value, name);
  const parsed = Number(value);
  if (parsed <= 0) {
    throw new CliArgumentError(`Invalid positive integer for option: ${name}`);
  }
  return parsed;
}

/**
 * Normalizes a URL string while preserving the user-selected origin.
 */
function normalizeBaseUrl(value) {
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new CliArgumentError(`Invalid URL for option: --base-url`);
  }
}

/**
 * Formats an attachment summary.
 */
function formatAttachment(attachment) {
  if (!attachment) {
    return "unknown";
  }
  return `${valueOrUnknown(attachment.key)} ${valueOrUnknown(attachment.fileName)}`;
}

/**
 * Formats a heading path.
 */
function formatPath(path) {
  if (Array.isArray(path)) {
    return path.join(" / ");
  }
  return valueOrUnknown(path);
}

/**
 * Formats booleans as yes/no strings.
 */
function yesNo(value) {
  return value ? "yes" : "no";
}

/**
 * Returns a readable fallback for missing response fields.
 */
function valueOrUnknown(value) {
  return value === undefined || value === null || value === ""
    ? "unknown"
    : String(value);
}

/**
 * Represents invalid command-line arguments.
 */
class CliArgumentError extends Error {}

/**
 * Represents an HTTP API error response.
 */
class ApiError extends Error {
  /**
   * Stores an HTTP API error status and parsed JSON payload.
   */
  constructor(status, payload) {
    super(payload?.message || `API request failed with status ${status}`);
    this.status = status;
    this.payload = payload && typeof payload === "object" ? payload : {};
  }
}

/**
 * Represents transport or response decoding failures.
 */
class NetworkError extends Error {}

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
