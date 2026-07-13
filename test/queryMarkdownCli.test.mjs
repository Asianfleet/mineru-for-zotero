/* global URL, process */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(
  new URL(
    "../mineru-for-zotero-cli/scripts/query-markdown.mjs",
    import.meta.url,
  ),
);

test("formats search results as agent-friendly text", async () => {
  await withServer(
    {
      status: 200,
      body: {
        candidates: [
          {
            item: {
              itemID: 123,
              libraryID: 1,
              key: "ABCD1234",
              type: "regular",
              title: "Example Paper",
            },
            attachments: [
              {
                itemID: 456,
                libraryID: 1,
                key: "PDFKEY01",
                fileName: "paper.pdf",
                preciseReady: true,
                liteReady: false,
              },
            ],
          },
        ],
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "search",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--title",
        "retrieval",
        "--format",
        "text",
      ]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /Markdown Query Search/);
      assert.match(result.stdout, /Candidates: 1/);
      assert.match(result.stdout, /1\. Example Paper/);
      assert.match(result.stdout, /parsed: precise=yes lite=no/);
      assert.equal(result.stderr, "");
      assert.equal(requests[0].pathname, "/mineru-for-zotero/search");
      assert.equal(requests[0].searchParams.libraryID, "1");
      assert.equal(requests[0].searchParams.title, "retrieval");
    },
  );
});

test("formats markdown headings as json envelope without exposing token", async () => {
  await withServer(
    {
      status: 200,
      body: {
        item: {
          itemID: 123,
          libraryID: 1,
          key: "ABCD1234",
          type: "regular",
          title: "Example Paper",
        },
        attachment: {
          itemID: 456,
          libraryID: 1,
          key: "PDFKEY01",
          fileName: "paper.pdf",
        },
        result: {
          mode: "precise",
          source: "preferred",
        },
        granularity: "headings",
        headings: [
          {
            level: 2,
            title: "Introduction",
            path: ["Example Paper", "Introduction"],
            line: 8,
          },
        ],
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "markdown",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
        "--granularity",
        "headings",
        "--token",
        "secret-token",
        "--format",
        "json",
      ]);

      assert.equal(result.code, 0);
      assert.equal(result.stderr, "");
      assert.equal(requests[0].headers.authorization, "Bearer secret-token");
      assert.doesNotMatch(result.stdout, /secret-token/);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, true);
      assert.equal(output.status, 200);
      assert.equal(output.request.command, "markdown");
      assert.equal(output.request.endpoint, "/mineru-for-zotero/markdown");
      assert.deepEqual(output.request.params, {
        libraryID: "1",
        key: "ABCD1234",
        granularity: "headings",
      });
      assert.equal(output.data.headings[0].title, "Introduction");
    },
  );
});

test("formats markdown search matches as text", async () => {
  await withServer(
    {
      status: 200,
      body: {
        item: {
          itemID: 123,
          libraryID: 1,
          key: "ABCD1234",
          type: "regular",
          title: "Example Paper",
        },
        attachment: {
          itemID: 456,
          libraryID: 1,
          key: "PDFKEY01",
          fileName: "paper.pdf",
        },
        result: {
          mode: "lite",
          source: "preferred",
        },
        granularity: "search",
        query: "retrieval",
        matches: [
          {
            paragraphIndex: 3,
            before: ["Previous paragraph."],
            hit: "This paragraph mentions retrieval.",
            after: ["Next paragraph."],
            context:
              "Previous paragraph.\n\nThis paragraph mentions retrieval.\n\nNext paragraph.",
          },
        ],
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "markdown",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
        "--granularity",
        "search",
        "--query",
        "retrieval",
        "--context-paragraphs",
        "2",
      ]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /Granularity: search/);
      assert.match(result.stdout, /Mode: lite/);
      assert.match(result.stdout, /Matches: 1/);
      assert.match(result.stdout, />> This paragraph mentions retrieval\./);
      assert.equal(requests[0].searchParams.q, "retrieval");
      assert.equal(requests[0].searchParams.contextParagraphs, "2");
    },
  );
});

test("formats api errors as json and exits with code 1", async () => {
  await withServer(
    {
      status: 404,
      body: {
        error: "parse-result-not-found",
        message: "Target PDF has no available parse result",
      },
    },
    async ({ port }) => {
      const result = await runCli([
        "markdown",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
        "--format",
        "json",
      ]);

      assert.equal(result.code, 1);
      assert.equal(result.stderr, "");
      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.equal(output.status, 404);
      assert.deepEqual(output.error, {
        code: "parse-result-not-found",
        message: "Target PDF has no available parse result",
        details: {},
      });
    },
  );
});

test("prints parameter errors to stderr and exits with code 2", async () => {
  const result = await runCli(["markdown", "--library-id", "1"]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing required option: --key/);
  assert.match(result.stderr, /Usage:/);
});

test("discovers the listen port from the default Zotero profile", async () => {
  await withServer(
    {
      status: 200,
      body: {
        candidates: [],
      },
    },
    async ({ port, requests }) => {
      await withZoteroProfile(port, async ({ env }) => {
        const result = await runCli(
          [
            "search",
            "--library-id",
            "1",
            "--title",
            "retrieval",
            "--format",
            "json",
          ],
          { env },
        );

        assert.equal(result.code, 0);
        assert.equal(result.stderr, "");
        assert.equal(requests[0].pathname, "/mineru-for-zotero/search");

        const output = JSON.parse(result.stdout);
        assert.equal(output.request.baseUrl, `http://127.0.0.1:${port}`);
      });
    },
  );
});

/**
 * Runs a temporary JSON HTTP server while a CLI test executes.
 */
async function withServer(response, run) {
  const requests = [];
  const server = createServer((request, res) => {
    const url = new URL(request.url, "http://127.0.0.1");
    requests.push({
      pathname: url.pathname,
      searchParams: Object.fromEntries(url.searchParams.entries()),
      headers: request.headers,
    });
    res.writeHead(response.status, {
      "content-type": "application/json",
    });
    res.end(JSON.stringify(response.body));
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address();
    await run({ port, requests });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

/**
 * Creates a temporary Zotero profile tree with the requested local API port.
 */
async function withZoteroProfile(port, run) {
  const root = await mkdtemp(join(tmpdir(), "zotero-profile-"));
  const appDataRoot = join(root, "AppData", "Roaming");
  const zoteroRoot = join(appDataRoot, "Zotero", "Zotero");
  const profilePath = join(zoteroRoot, "Profiles", "test.default");

  await mkdir(profilePath, { recursive: true });
  await writeFile(
    join(zoteroRoot, "profiles.ini"),
    [
      "[Profile0]",
      "Name=default",
      "IsRelative=1",
      "Path=Profiles/test.default",
      "Default=1",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(profilePath, "prefs.js"),
    `user_pref("extensions.zotero.httpServer.port", ${port});\n`,
    "utf8",
  );

  try {
    await run({
      env: {
        APPDATA: appDataRoot,
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Runs the Markdown query CLI and captures process output.
 */
function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}
