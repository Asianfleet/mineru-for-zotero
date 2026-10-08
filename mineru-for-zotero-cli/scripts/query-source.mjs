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
const VALID_SOURCES = new Set(["markdown", "latex"]);
const VALID_MARKDOWN_OPERATIONS = new Set(["read", "table", "image"]);
const VALID_LATEX_OPERATIONS = new Set(["fetch", "read", "table", "image"]);
const VALID_FORMATS = new Set(["text", "json"]);
const VALID_GRANULARITIES = new Set(["full", "headings", "section", "search"]);
const VALID_TABLE_FORMATS = new Set([
  "html",
  "markdown",
  "tsv",
  "latex",
  "json",
]);
const VALID_TABLE_MATCHES = new Set([
  "caption",
  "content",
  "both",
  "caption-exact",
]);
const BOOLEAN_FLAGS = new Set(["--help", "--refresh"]);

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
    const response = await requestSourceApi(options);
    const data = await prepareSuccessData(options, response);
    const envelope = createSuccessEnvelope(options, data);
    const partialImageFailure =
      options.command === "latex.image" &&
      data.images?.some(
        (image) => !["ok", "duplicate-path"].includes(image.status),
      );
    if (partialImageFailure) envelope.ok = false;
    if (options.format === "json") {
      console.log(JSON.stringify(envelope, null, 2));
    } else {
      console.log(formatTextSuccess(options, data));
    }
    return partialImageFailure ? 1 : 0;
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

  const [source, operation, ...remaining] = argv;
  if (source !== "search" && !VALID_SOURCES.has(source)) {
    throw new CliArgumentError(`Unknown source: ${source}`);
  }
  if (source !== "search") {
    const valid =
      source === "markdown"
        ? VALID_MARKDOWN_OPERATIONS
        : VALID_LATEX_OPERATIONS;
    if (!valid.has(operation))
      throw new CliArgumentError(`Unknown operation: ${operation}`);
  }
  const command = source === "search" ? "search" : `${source}.${operation}`;
  const rest = source === "search" ? argv.slice(1) : remaining;

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
      source: "shared",
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

  if (command === "latex.fetch") {
    const key = getRequiredFlag(flags, "--key");
    return {
      command,
      source,
      endpoint: "/mineru-for-zotero/latex/fetch",
      listenPort,
      baseUrl,
      format,
      timeoutMs,
      token,
      params: {
        libraryID,
        key,
        refresh: flags.has("--refresh") ? "true" : "false",
        ...(flags.has("--main-file")
          ? { mainFile: flags.get("--main-file") }
          : {}),
      },
      method: "POST",
    };
  }

  if (command.endsWith(".table")) {
    const key = getRequiredFlag(flags, "--key");
    const query = getRequiredFlag(flags, "--query");
    if (
      source === "latex" &&
      (flags.has("--table-format") || flags.has("--match"))
    ) {
      throw new CliArgumentError(
        "latex table always returns LaTeX code and does not accept --table-format or --match.",
      );
    }
    const tableFormat =
      source === "markdown"
        ? getFlag(flags, "--table-format", "html")
        : "latex";
    const match =
      source === "markdown" ? getFlag(flags, "--match", "both") : "both";
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
      source,
      endpoint: `/mineru-for-zotero/${source}/table`,
      listenPort,
      baseUrl,
      format,
      timeoutMs,
      token,
      params,
    };
  }

  if (command.endsWith(".image")) {
    const key = getRequiredFlag(flags, "--key");
    const path = getRequiredFlag(flags, "--path");
    const output = getFlag(flags, "--output");
    const outputDir = getFlag(flags, "--output-dir");
    if (!output && !outputDir) {
      throw new CliArgumentError(
        "Image command requires --output or --output-dir.",
      );
    }
    if (isMultiImagePath(path) && output && !outputDir) {
      throw new CliArgumentError(
        "Multi-image paths require --output-dir. Use --output only for a single image path.",
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
      source,
      endpoint: `/mineru-for-zotero/${source}/image`,
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
  if (source === "latex") {
    if (flags.has("--section-number"))
      throw new CliArgumentError(
        "latex read does not accept --section-number.",
      );
    if (flags.has("--attachment-key"))
      throw new CliArgumentError(
        "latex read does not accept --attachment-key.",
      );
    if (flags.has("--section-path") && granularity !== "section")
      throw new CliArgumentError(
        "--section-path requires section granularity.",
      );
    if (granularity === "section" && !getFlag(flags, "--section-path")?.trim())
      throw new CliArgumentError("latex section requires --section-path.");
    if (flags.has("--context-paragraphs") && granularity !== "search")
      throw new CliArgumentError(
        "--context-paragraphs requires search granularity.",
      );
    if (flags.has("--query") && granularity !== "search")
      throw new CliArgumentError("--query requires search granularity.");
    if (granularity === "search" && !getFlag(flags, "--query")?.trim())
      throw new CliArgumentError("latex search requires --query.");
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
    if (source === "latex" && Number(contextParagraphs) < 0)
      throw new CliArgumentError("--context-paragraphs must be non-negative.");
    params.contextParagraphs = contextParagraphs;
  }

  return {
    command,
    source,
    endpoint: `/mineru-for-zotero/${source}/read`,
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
    if (BOOLEAN_FLAGS.has(name)) {
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
async function requestSourceApi(options) {
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
      method: options.method ?? "GET",
      headers,
      signal: controller.signal,
    });
    if (
      options.command.endsWith(".image") &&
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
  if (!options.command.endsWith(".image")) {
    return data;
  }
  if (options.command === "latex.image") {
    return prepareLatexImages(options, data);
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

  if (options.output && data?.images?.length === 1) {
    const image = data.images[0];
    const bytes =
      image.status === "ok" && typeof image.dataURL === "string"
        ? decodeDataUrl(image.dataURL)
        : undefined;
    if (!bytes) {
      throw new Error("Image response has no valid data URL");
    }
    const outputPath = imageOutputPath(options, image.path);
    await writeBinaryOutput(outputPath, bytes);
    return {
      path: image.path,
      mime: image.mime,
      bytes: bytes.byteLength,
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

/** 保存 LaTeX 图片并仅保留可安全输出的逐项元数据。 */
async function prepareLatexImages(options, data) {
  if (!Array.isArray(data?.images))
    throw new Error("LaTeX image response has no images list");
  const images = [];
  for (const image of data.images) {
    if (image.status !== "ok") {
      images.push({ path: image.path, status: image.status });
      continue;
    }
    const bytes = decodeDataUrl(image.dataURL);
    if (!bytes) throw new Error("Image response has no valid data URL");
    const output =
      options.output && data.images.length === 1
        ? resolve(options.output)
        : latexImageOutputPathForDir(options.outputDir, image.path);
    await writeBinaryOutput(output, bytes);
    images.push({
      path: image.path,
      status: "ok",
      mime: image.mime,
      bytes: bytes.byteLength,
      output,
    });
  }
  return { images };
}

/** 在目标目录内保留 LaTeX 归档文件的完整安全相对路径。 */
function latexImageOutputPathForDir(outputDir, imagePath) {
  const path = String(imagePath ?? "");
  const parts = path.split("/");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[a-z]:/i.test(path) ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid LaTeX image path in API response");
  return resolve(outputDir, ...parts);
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
 * Decodes a base64 data URL into bytes for image JSON responses.
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
  if (options.command.endsWith(".table")) {
    return formatTableText(options, data);
  }
  if (options.command.endsWith(".image")) {
    return formatImageText(options, data);
  }
  return formatSourceText(options, data);
}

/**
 * Formats title search candidates.
 */
function formatSearchText(options, data) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const lines = [
    "Source Query Search",
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
function formatSourceText(options, data) {
  if (options.command === "latex.fetch") {
    return [
      "LaTeX Source Fetch",
      `Library: ${options.params.libraryID}`,
      `Item: ${valueOrUnknown(options.params.key)}`,
      `arXiv: ${valueOrUnknown(data.arxivID)}`,
      `Version: ${valueOrUnknown(data.resolvedVersion)}`,
      `Main file: ${valueOrUnknown(data.mainFile)}`,
      `Files: ${valueOrUnknown(data.fileCount)}`,
    ].join("\n");
  }
  if (options.source === "latex") return formatLatexSourceText(options, data);
  const lines = [
    options.command.startsWith("latex.")
      ? "LaTeX Source Result"
      : "Markdown Query Result",
    `Library: ${options.params.libraryID}`,
    `Item: ${valueOrUnknown(data.item?.key ?? options.params.key)}`,
    ...(data.attachment
      ? [`Attachment: ${formatAttachment(data.attachment)}`]
      : []),
    `Title: ${valueOrUnknown(data.item?.title)}`,
    `Granularity: ${valueOrUnknown(data.granularity ?? options.params.granularity)}`,
    ...(data.result?.mode ? [`Mode: ${valueOrUnknown(data.result.mode)}`] : []),
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

/** 按 LaTeX 响应字段展示标题、章节、搜索和全文。 */
function formatLatexSourceText(options, data) {
  const granularity = data.granularity ?? options.params.granularity;
  const lines = [
    "LaTeX Source Result",
    `Library: ${options.params.libraryID}`,
    `Item: ${options.params.key}`,
    `Granularity: ${granularity}`,
    "",
  ];
  if (granularity === "headings") {
    lines.push("[Headings]");
    for (const heading of data.headings ?? []) {
      lines.push(
        `${"  ".repeat(Math.max(0, Number(heading.level || 1) - 1))}- ${heading.title} (${heading.command})`,
        `  path: ${formatPath(heading.path)}`,
        `  source: ${heading.file}:${heading.line}`,
      );
    }
    if (!data.headings?.length) lines.push("(none)");
  } else if (granularity === "section") {
    lines.push(
      "[Section]",
      `Heading: ${data.heading?.title ?? ""}`,
      `Path: ${formatPath(data.heading?.path)}`,
      `Source: ${data.heading?.file}:${data.heading?.line}`,
      "",
      data.content ?? "",
    );
  } else if (granularity === "search") {
    const matches = data.matches ?? [];
    lines.push(`Query: ${data.query}`, `Matches: ${matches.length}`);
    matches.forEach((match, index) => {
      lines.push("", `[Match ${index + 1}] ${match.file}:${match.line}`);
      for (const paragraph of match.before ?? []) lines.push("", paragraph);
      lines.push("", `>> ${match.hit}`);
      for (const paragraph of match.after ?? []) lines.push("", paragraph);
    });
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
  if (options.source === "latex") {
    const tables = data.tables ?? [];
    const lines = [
      "LaTeX Table Query Result",
      `Library: ${options.params.libraryID}`,
      `Item: ${options.params.key}`,
      `Query: ${data.query ?? options.params.q}`,
      `Tables: ${tables.length}`,
    ];
    tables.forEach((table, index) => {
      lines.push(
        "",
        `[Table ${index + 1}]`,
        `Caption: ${table.caption ?? ""}`,
        `Source: ${table.file}:${table.lineStart}-${table.lineEnd}`,
        "",
        table.content ?? "",
      );
    });
    return lines.join("\n");
  }
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
  if (options.source === "latex") {
    const lines = [
      "LaTeX Image Query Result",
      `Library: ${options.params.libraryID}`,
      `Item: ${options.params.key}`,
      `Images: ${data.images.length}`,
    ];
    for (const image of data.images) {
      lines.push("", `- ${image.path}`, `  status: ${image.status}`);
      if (image.mime) lines.push(`  mime: ${image.mime}`);
      if (image.output)
        lines.push(`  output: ${image.output}`, `  bytes: ${image.bytes}`);
    }
    return lines.join("\n");
  }
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
  const hint = hintForError(envelope.error.code, envelope.request.command);
  if (hint) {
    lines.push("", `Hint: ${hint}`);
  }
  const candidates = envelope.error.details?.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    lines.push("", "Candidates:");
    for (const candidate of candidates) {
      if (envelope.error.code === "ambiguous-section") {
        lines.push(
          `- ${formatPath(candidate.path)} ${candidate.file}:${candidate.line}`,
        );
        continue;
      }
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
function hintForError(code, command) {
  if (code === "invalid-path" && command === "latex.image")
    return "Use a safe relative path listed in the stored LaTeX source.";
  const hints = {
    "api-disabled": "Enable the Markdown query API in Zotero preferences.",
    "invalid-token": "Check the --token value from Zotero preferences.",
    "ambiguous-attachment":
      "Pass --attachment-key with one of the candidate keys.",
    "parse-result-not-found":
      "Parse this PDF in Zotero first, or choose another attachment with --attachment-key.",
    "invalid-main-file":
      "Pass --main-file with a relative .tex path present in the arXiv archive.",
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
    "  node mineru-for-zotero-cli/scripts/query-source.mjs search --library-id <id> --title <text> [--format text|json]",
    "  node mineru-for-zotero-cli/scripts/query-source.mjs markdown read --library-id <id> --key <key> [--granularity full|headings|section|search] [--format text|json]",
    "  node mineru-for-zotero-cli/scripts/query-source.mjs markdown table --library-id <id> --key <key> --query <text> [--match caption|content|both|caption-exact] [--table-format html|markdown|tsv|latex|json]",
    "  node mineru-for-zotero-cli/scripts/query-source.mjs markdown image --library-id <id> --key <key> --path <images/...> (--output <file>|--output-dir <dir>)",
    "  node mineru-for-zotero-cli/scripts/query-source.mjs latex fetch --library-id <id> --key <key> [--refresh] [--main-file <relative-path>]",
    "  node mineru-for-zotero-cli/scripts/query-source.mjs latex read --library-id <id> --key <key> [--granularity full|headings|section|search] [--section-path <path>|--query <text>]",
    "  node mineru-for-zotero-cli/scripts/query-source.mjs latex table --library-id <id> --key <key> --query <text>",
    "  node mineru-for-zotero-cli/scripts/query-source.mjs latex image --library-id <id> --key <key> --path <paths> (--output <file>|--output-dir <dir>)",
    "",
    "Common options:",
    "  --library-id <id>            Zotero library ID. Required for every command.",
    "  --key <key>                  Zotero item key. Required for markdown and latex commands; not used by search.",
    "  --port <number>              Zotero local server port. Default: auto-detect from Zotero profile, then 23119",
    "  --token <token>              Source query API token. Sent as Authorization: Bearer.",
    "  --format <text|json>         Output format. Default: text",
    "  --timeout-ms <number>        Request timeout. Default: 30000",
    "",
    "Command options:",
    "  search --title <text>        Required title search text.",
    "  markdown read                --attachment-key, --granularity, --section-number, --section-path, --query, --context-paragraphs",
    "  markdown table               --query, --match, --table-format",
    "  markdown image               --path, --output, --output-dir",
    "  latex fetch                  --refresh, --main-file",
    "  latex read                   --granularity, --section-path (exact path or unique title), --query, --context-paragraphs (search only)",
    "  latex table                  --query (returns LaTeX code; --table-format is unavailable)",
    "  latex image                  --path, --output, --output-dir (per-path status; partial failure exits 1)",
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
 * Returns true when an image path argument contains multiple comma-separated paths.
 */
function isMultiImagePath(path) {
  return (
    String(path)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean).length > 1
  );
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
