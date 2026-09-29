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

test("formats markdown headings as json envelope without auth headers", async () => {
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
        "--format",
        "json",
      ]);

      assert.equal(result.code, 0);
      assert.equal(result.stderr, "");
      assert.equal(requests[0].headers.authorization, undefined);

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

test("formats creator/year search results as agent-friendly text", async () => {
  await withServer(
    {
      status: 200,
      body: {
        candidates: [
          {
            item: {
              itemID: 29,
              libraryID: 1,
              key: "AGQEUI5S",
              type: "regular",
              title: "Energy-Saving Task Scheduling",
              year: "2022",
              creators: ["Chen, Qingfeng", "Han, Yu"],
            },
            attachments: [],
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
        "--creator",
        "Chen",
        "--year",
        "2022",
        "--limit",
        "5",
        "--format",
        "text",
      ]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /1\. Energy-Saving Task Scheduling/);
      assert.match(result.stdout, /year: 2022/);
      assert.match(result.stdout, /creators: Chen, Qingfeng; Han, Yu/);
      assert.equal(requests[0].searchParams.creator, "Chen");
      assert.equal(requests[0].searchParams.year, "2022");
      assert.equal(requests[0].searchParams.limit, "5");
      assert.equal(requests[0].searchParams.title, undefined);
    },
  );
});

test("requires a title or creator for search", async () => {
  const result = await runCli(["search", "--library-id", "1"]);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /Missing required option: --title or --creator/);
});

test("rejects malformed year values", async () => {
  const result = await runCli([
    "search",
    "--library-id",
    "1",
    "--title",
    "Doc",
    "--year",
    "22",
  ]);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /Invalid --year/);
});

const markdownServerBody = {
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
  result: { mode: "precise", source: "preferred" },
};

test("sends include-subsections switch to the API", async () => {
  await withServer(
    {
      status: 200,
      body: {
        ...markdownServerBody,
        granularity: "section",
        heading: { title: "A", path: ["Doc", "A"], line: 2 },
        content: "## A\n\nAlpha",
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
        "section",
        "--section-path",
        "Doc/A",
        "--include-subsections",
      ]);

      assert.equal(result.code, 0);
      assert.equal(requests[0].searchParams.includeSubsections, "true");
      assert.match(result.stdout, /Granularity: section/);
    },
  );
});

test("formats libraries as agent-friendly text", async () => {
  await withServer(
    {
      status: 200,
      body: {
        libraries: [
          { libraryID: 1, name: "My Library", type: "user" },
          { libraryID: 2, name: "Lab Group", type: "group" },
        ],
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "libraries",
        "--port",
        String(port),
        "--format",
        "text",
      ]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /Zotero Libraries/);
      assert.match(result.stdout, /Count: 2/);
      assert.match(result.stdout, /1\. My Library/);
      assert.match(result.stdout, /2\. Lab Group/);
      assert.equal(requests[0].pathname, "/mineru-for-zotero/libraries");
    },
  );
});

test("formats collections as agent-friendly text", async () => {
  await withServer(
    {
      status: 200,
      body: {
        libraryID: 1,
        collections: [
          { id: 10, key: "COL1", name: "AI", libraryID: 1 },
          { id: 11, key: "COL2", name: "LLM", libraryID: 1, parentKey: "COL1" },
        ],
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "collections",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--parent-key",
        "COL1",
        "--format",
        "text",
      ]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /Zotero Collections/);
      assert.match(result.stdout, /1\. AI/);
      assert.match(result.stdout, /2\. LLM/);
      assert.match(result.stdout, /parentKey: COL1/);
      assert.equal(requests[0].pathname, "/mineru-for-zotero/collections");
      assert.equal(requests[0].searchParams.libraryID, "1");
      assert.equal(requests[0].searchParams.parentKey, "COL1");
    },
  );
});

test("formats tags as agent-friendly text", async () => {
  await withServer(
    {
      status: 200,
      body: {
        libraryID: 1,
        tags: [{ tag: "deep-learning", numItems: 15 }, { tag: "nlp" }],
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "tags",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--limit",
        "20",
        "--format",
        "text",
      ]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /Zotero Tags/);
      assert.match(result.stdout, /- deep-learning \(15 items\)/);
      assert.match(result.stdout, /- nlp/);
      assert.equal(requests[0].pathname, "/mineru-for-zotero/tags");
      assert.equal(requests[0].searchParams.libraryID, "1");
      assert.equal(requests[0].searchParams.limit, "20");
    },
  );
});

test("forwards rich search options to the search endpoint", async () => {
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
              title: "Attention Is All You Need",
              year: "2017",
              creators: ["Vaswani, Ashish"],
              itemType: "conferencePaper",
              publication: "NeurIPS",
              citekey: "vaswani2017attention",
              doi: "10.48550/arXiv.1706.03762",
            },
            attachments: [],
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
        "--collection",
        "AI",
        "--abstract",
        "transformer",
        "--publication",
        "NeurIPS",
        "--citekey",
        "vaswani2017attention",
        "--doi",
        "10.48550",
        "--item-type",
        "conferencePaper",
        "--since",
        "2026-01-01",
        "--has-pdf",
        "--parsed-only",
        "--sort-by",
        "dateAdded",
        "--sort-order",
        "desc",
        "--limit",
        "10",
        "--format",
        "text",
      ]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /1\. Attention Is All You Need/);
      assert.match(result.stdout, /itemType: conferencePaper/);
      assert.match(result.stdout, /publication: NeurIPS/);
      assert.match(result.stdout, /citekey: vaswani2017attention/);
      assert.match(result.stdout, /doi: 10\.48550\/arXiv\.1706\.03762/);

      const params = requests[0].searchParams;
      assert.equal(params.collection, "AI");
      assert.equal(params.abstract, "transformer");
      assert.equal(params.publication, "NeurIPS");
      assert.equal(params.citekey, "vaswani2017attention");
      assert.equal(params.doi, "10.48550");
      assert.equal(params.itemType, "conferencePaper");
      assert.equal(params.since, "2026-01-01");
      assert.equal(params.hasPdf, "true");
      assert.equal(params.parsedOnly, "true");
      assert.equal(params.sortBy, "dateAdded");
      assert.equal(params.sortOrder, "desc");
      assert.equal(params.limit, "10");
    },
  );
});

test("hints at Zotero availability when the API is unreachable", async () => {
  // Nothing listens on port 1, so the connection is refused immediately.
  const result = await runCli([
    "markdown",
    "--port",
    "1",
    "--timeout-ms",
    "2000",
    "--library-id",
    "1",
    "--key",
    "ABCD1234",
  ]);

  assert.equal(result.code, 3);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Error: network-error/);
  assert.match(result.stderr, /Zotero may not be running/);
  // Transport errors must not print the usage block; only argument errors do.
  assert.doesNotMatch(result.stderr, /Usage:/);
});

test("treats non-JSON responses as transport errors with exit code 3", async () => {
  const server = createServer((request, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("not json");
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address();
    const result = await runCli(["libraries", "--port", String(port)]);

    assert.equal(result.code, 3);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Error: network-error/);
    assert.match(result.stderr, /non-JSON response/);
    assert.doesNotMatch(result.stderr, /Usage:/);
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
        ZOTERO_CONFIG_DIR: zoteroRoot,
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
