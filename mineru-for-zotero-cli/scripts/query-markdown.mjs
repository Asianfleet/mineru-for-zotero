#!/usr/bin/env node
/* global AbortController, URL, clearTimeout, console, fetch, process, setTimeout */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const DEFAULT_LISTEN_PORT = 23119;
const DEFAULT_FORMAT = "text";
const DEFAULT_TIMEOUT_MS = 30000;
const SEARCH_ENDPOINT = "/mineru-for-zotero/search";
const MARKDOWN_ENDPOINT = "/mineru-for-zotero/markdown";
const TABLE_ENDPOINT = "/mineru-for-zotero/tables";
const IMAGE_ENDPOINT = "/mineru-for-zotero/image";
const VALID_COMMANDS = new Set(["search", "markdown", "table", "image"]);
const VALID_FORMATS = new Set(["text", "json"]);
const VALID_GRANULARITIES = new Set(["full", "headings", "section", "search"]);
const VALID_TABLE_FORMATS = new Set([
  "html",
  "markdown",
  "tsv",
  "latex",
  "json",
]);
const VALID_TABLE_MATCHES = new Set(["caption", "content", "both"]);

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
    const data = await prepareSuccessData(options, response);
    const envelope = createSuccessEnvelope(options, data);
    if (options.format === "json") {
      console.log(JSON.stringify(envelope, null, 2));
    } else {
      console.log(formatTextSuccess(options, data));
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
  if (!VALID_COMMANDS.has(command)) {
    throw new CliArgumentError(`Unknown command: ${command}`);
  }

  const flags = parseFlags(rest);
  const format = getFlag(flags, "--format", DEFAULT_FORMAT);
  if (!VALID_FORMATS.has(format)) {
    throw new CliArgumentError("Invalid --format. Expected text or json.");
  }

  const listenPort = resolveListenPort(flags);
  const baseUrl = createBaseUrl(listenPort);
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
      listenPort,
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

  if (command === "table") {
    const key = getRequiredFlag(flags, "--key");
    const query = getRequiredFlag(flags, "--query");
    const tableFormat = getFlag(flags, "--table-format", "html");
    const match = getFlag(flags, "--match", "both");
    if (!VALID_TABLE_FORMATS.has(tableFormat)) {
      throw new CliArgumentError("Invalid --table-format.");
    }
    if (!VALID_TABLE_MATCHES.has(match)) {
      throw new CliArgumentError("Invalid --match.");
    }
    const params = {
      libraryID,
      key,
      q: query,
      match,
      tableFormat,
    };
    addOptionalParam(
      params,
      "attachmentKey",
      getFlag(flags, "--attachment-key"),
    );
    return {
      command,
      endpoint: TABLE_ENDPOINT,
      listenPort,
      baseUrl,
      format,
      timeoutMs,
      token,
      params,
    };
  }

  if (command === "image") {
    const key = getRequiredFlag(flags, "--key");
    const path = getRequiredFlag(flags, "--path");
    const output = getFlag(flags, "--output");
    const outputDir = getFlag(flags, "--output-dir");
    if (!output && !outputDir) {
      throw new CliArgumentError(
        "Image command requires --output or --output-dir.",
      );
    }
    const params = { libraryID, key, path };
    addOptionalParam(
      params,
      "attachmentKey",
      getFlag(flags, "--attachment-key"),
    );
    return {
      command,
      endpoint: IMAGE_ENDPOINT,
      listenPort,
      baseUrl,
      format,
      timeoutMs,
      token,
      output,
      outputDir,
      params,
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
  addOptionalParam(params, "sectionNumber", getFlag(flags, "--section-number"));
  addOptionalParam(params, "q", getFlag(flags, "--query"));

  const contextParagraphs = getFlag(flags, "--context-paragraphs");
  if (contextParagraphs !== undefined) {
    parseInteger(contextParagraphs, "--context-paragraphs");
    params.contextParagraphs = contextParagraphs;
  }

  return {
    command,
    endpoint: MARKDOWN_ENDPOINT,
    listenPort,
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
 * Fetches JSON or image bytes from the local Zotero Markdown query API.
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
    if (
      options.command === "image" &&
      response.ok &&
      !response.headers.get("content-type")?.includes("json")
    ) {
      return {
        imageBytes: new Uint8Array(await response.arrayBuffer()),
        mime:
          response.headers.get("content-type") || "application/octet-stream",
      };
    }
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
 * Writes requested CLI output files and returns JSON-safe success data.
 */
async function prepareSuccessData(options, data) {
  if (options.command !== "image") {
    return data;
  }

  if (data?.imageBytes instanceof Uint8Array) {
    const outputPath = imageOutputPath(options, options.params.path);
    if (outputPath) {
      await writeBinaryOutput(outputPath, data.imageBytes);
    }
    return {
      path: options.params.path,
      mime: data.mime,
      bytes: data.imageBytes.byteLength,
      output: outputPath,
    };
  }

  if (options.outputDir && Array.isArray(data?.images)) {
    const writtenImages = [];
    for (const image of data.images) {
      if (image.status !== "ok" || typeof image.dataURL !== "string") {
        continue;
      }
      const bytes = decodeDataUrl(image.dataURL);
      if (!bytes) {
        continue;
      }
      const outputPath = imageOutputPathForDir(options.outputDir, image.path);
      await writeBinaryOutput(outputPath, bytes);
      writtenImages.push({
        path: image.path,
        output: outputPath,
        bytes: bytes.byteLength,
      });
    }
    return { ...data, writtenImages };
  }

  return data;
}

/**
 * Resolves the target path for a successful single-image response.
 */
function imageOutputPath(options, imagePath) {
  if (options.output) {
    return resolve(options.output);
  }
  if (options.outputDir) {
    return imageOutputPathForDir(options.outputDir, imagePath);
  }
  return undefined;
}

/**
 * Resolves a safe output path for an API image path under an output directory.
 */
function imageOutputPathForDir(outputDir, imagePath) {
  const normalized = String(imagePath ?? "").replaceAll("\\", "/");
  const withoutPrefix = normalized.startsWith("images/")
    ? normalized.slice("images/".length)
    : basename(normalized);
  const safeParts = withoutPrefix
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  const fileParts = safeParts.length > 0 ? safeParts : [basename(normalized)];
  return resolve(outputDir, ...fileParts);
}

/**
 * Writes binary output and creates parent directories when needed.
 */
async function writeBinaryOutput(outputPath, bytes) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
}

/**
 * Decodes a base64 data URL into bytes for multi-image JSON responses.
 */
function decodeDataUrl(dataURL) {
  const match = /^data:[^;,]+;base64,(.+)$/i.exec(dataURL);
  if (!match) {
    return undefined;
  }
  return new Uint8Array(Buffer.from(match[1], "base64"));
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
    listenPort: options.listenPort,
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
  if (options.command === "table") {
    return formatTableText(options, data);
  }
  if (options.command === "image") {
    return formatImageText(options, data);
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
    if (Array.isArray(data.groups)) {
      lines.push(...formatSectionGroups(data.groups));
    } else {
      lines.push(...formatSection(data));
    }
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
 * Formats grouped section query responses from section-number or fuzzy path.
 */
function formatSectionGroups(groups) {
  return groups.flatMap((group, index) => {
    const matches = Array.isArray(group.matches) ? group.matches : [];
    const lines = [
      `[Group ${index + 1}] ${valueOrUnknown(group.query)}`,
      `Kind: ${valueOrUnknown(group.kind)}`,
      `Status: ${valueOrUnknown(group.status)}`,
      `Matches: ${matches.length}`,
    ];
    for (const match of matches) {
      lines.push(
        "",
        `Heading: ${valueOrUnknown(match.heading?.title)}`,
        `Path: ${formatPath(match.heading?.path)}`,
        `Line: ${valueOrUnknown(match.heading?.line)}`,
        "",
        match.content ?? "",
      );
    }
    return lines;
  });
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
 * Formats table query responses as compact, readable text.
 */
function formatTableText(options, data) {
  const tables = Array.isArray(data.tables) ? data.tables : [];
  const lines = [
    "Markdown Table Query Result",
    `Library: ${options.params.libraryID}`,
    `Item: ${valueOrUnknown(options.params.key)}`,
    `Query: ${valueOrUnknown(data.query ?? options.params.q)}`,
    `Match: ${valueOrUnknown(data.match ?? options.params.match)}`,
    `Format: ${valueOrUnknown(data.tableFormat ?? options.params.tableFormat)}`,
    `Tables: ${tables.length}`,
  ];

  tables.forEach((table, index) => {
    lines.push(
      "",
      `[Table ${index + 1}]`,
      `Caption: ${valueOrUnknown(table.caption)}`,
      `Page: ${valueOrUnknown(table.page)}`,
      `Raw Index: ${valueOrUnknown(table.rawIndex)}`,
      "",
      table.content ?? "",
    );
  });

  return lines.join("\n");
}

/**
 * Formats image query responses without writing binary bytes to stdout.
 */
function formatImageText(options, data) {
  if (typeof data.output === "string") {
    return [
      `Image saved: ${data.output}`,
      `Path: ${valueOrUnknown(data.path ?? options.params.path)}`,
      `MIME: ${valueOrUnknown(data.mime)}`,
      `Bytes: ${valueOrUnknown(data.bytes)}`,
    ].join("\n");
  }

  const images = Array.isArray(data.images) ? data.images : [];
  const written = Array.isArray(data.writtenImages) ? data.writtenImages : [];
  const lines = [
    "Markdown Image Query Result",
    `Library: ${options.params.libraryID}`,
    `Item: ${valueOrUnknown(options.params.key)}`,
    `Requested Path: ${valueOrUnknown(options.params.path)}`,
    `Images: ${images.length}`,
    `Written: ${written.length}`,
  ];

  for (const image of images) {
    const saved = written.find((item) => item.path === image.path);
    lines.push(
      "",
      `- ${valueOrUnknown(image.path)}`,
      `  status: ${valueOrUnknown(image.status)}`,
      `  mime: ${valueOrUnknown(image.mime)}`,
    );
    if (saved) {
      lines.push(`  output: ${saved.output}`, `  bytes: ${saved.bytes}`);
    }
  }

  return lines.join("\n");
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
    "  node skill/scripts/query-markdown.mjs table --library-id <id> --key <key> --query <text> [--match caption|content|both] [--table-format html|markdown|tsv|latex|json]",
    "  node skill/scripts/query-markdown.mjs image --library-id <id> --key <key> --path <images/...> (--output <file>|--output-dir <dir>)",
    "",
    "Common options:",
    "  --port <number>              Zotero local server port. Default: auto-detect from Zotero profile, then 23119",
    "  --token <token>              Markdown query API token. Sent as Authorization: Bearer.",
    "  --format <text|json>         Output format. Default: text",
    "  --timeout-ms <number>        Request timeout. Default: 30000",
    "",
    "Markdown options:",
    "  --attachment-key <key>       Select a specific PDF attachment under a regular item.",
    "  --section-path <path>        Section path for granularity=section.",
    "  --section-number <expr>      Section numbers for granularity=section, such as 5.1,5.3-5.5.",
    "  --query <text>               Search query for granularity=search.",
    "  --context-paragraphs <n>     Context paragraphs for granularity=search.",
    "",
    "Table options:",
    "  --query <text>               Required table caption or content query.",
    "  --match <kind>               caption, content, or both. Default: both",
    "  --table-format <format>      html, markdown, tsv, latex, or json. Default: html",
    "",
    "Image options:",
    "  --path <paths>               Required image path or comma-separated paths.",
    "  --output <file>              Save a single image response to a file. Required unless --output-dir is set.",
    "  --output-dir <dir>           Save image responses under a directory. Required unless --output is set.",
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
 * Resolves the local Zotero listen port from CLI flags, profile prefs, or default.
 */
function resolveListenPort(flags) {
  const explicitPort = getFlag(flags, "--port");
  if (explicitPort !== undefined) {
    return parseListenPort(explicitPort, "--port");
  }

  return readZoteroListenPort() ?? DEFAULT_LISTEN_PORT;
}

/**
 * Parses and validates a TCP port value.
 */
function parseListenPort(value, name) {
  const port = parsePositiveInteger(value, name);
  if (port > 65535) {
    throw new CliArgumentError(`Invalid port for option: ${name}`);
  }
  return port;
}

/**
 * Creates the loopback base URL used by the Zotero local API.
 */
function createBaseUrl(port) {
  return `http://127.0.0.1:${port}`;
}

/**
 * Reads Zotero's configured HTTP server port from the default profile prefs.
 */
function readZoteroListenPort() {
  const profileDir = findDefaultZoteroProfileDir();
  if (!profileDir) {
    return undefined;
  }

  const prefsPath = join(profileDir, "prefs.js");
  if (!existsSync(prefsPath)) {
    return undefined;
  }

  try {
    const prefs = readFileSync(prefsPath, "utf8");
    const match = prefs.match(
      /user_pref\("extensions\.zotero\.httpServer\.port",\s*(\d+)\);/,
    );
    if (!match) {
      return undefined;
    }
    return parseListenPort(match[1], "Zotero profile port");
  } catch {
    return undefined;
  }
}

/**
 * Locates the default Zotero profile directory from profiles.ini.
 */
function findDefaultZoteroProfileDir() {
  const configDir = getZoteroConfigDir();
  if (!configDir) {
    return undefined;
  }

  const profilesIniPath = join(configDir, "profiles.ini");
  if (!existsSync(profilesIniPath)) {
    return undefined;
  }

  try {
    const profiles = parseProfilesIni(readFileSync(profilesIniPath, "utf8"));
    const profile =
      profiles.find((item) => item.Default === "1") ?? profiles[0];
    if (!profile?.Path) {
      return undefined;
    }

    return profile.IsRelative === "1"
      ? resolve(configDir, profile.Path)
      : resolve(profile.Path);
  } catch {
    return undefined;
  }
}

/**
 * Returns the platform-specific Zotero configuration directory.
 */
function getZoteroConfigDir() {
  if (process.platform === "win32") {
    return process.env.APPDATA
      ? join(process.env.APPDATA, "Zotero", "Zotero")
      : undefined;
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Zotero");
  }

  return join(homedir(), ".zotero", "zotero");
}

/**
 * Parses Firefox-style profile sections from a profiles.ini file.
 */
function parseProfilesIni(text) {
  const profiles = [];
  let currentProfile;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      currentProfile = sectionMatch[1].startsWith("Profile") ? {} : undefined;
      if (currentProfile) {
        profiles.push(currentProfile);
      }
      continue;
    }

    if (!currentProfile) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    currentProfile[line.slice(0, separatorIndex)] = line.slice(
      separatorIndex + 1,
    );
  }

  return profiles;
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
