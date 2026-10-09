/* global URL, process */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(
  new URL("../mineru-for-zotero-cli/scripts/query-source.mjs", import.meta.url),
);

test("help lists command-scoped options without misleading source sections", async () => {
  const result = await runCli(["--help"]);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /--key <key>/);
  assert.match(result.stdout, /markdown table.*--table-format/);
  assert.match(result.stdout, /latex table.*--table-format is unavailable/);
  assert.match(result.stdout, /latex image.*partial failure/i);
  assert.doesNotMatch(result.stdout, /Markdown options:/);
  assert.doesNotMatch(result.stdout, /LaTeX options:/);
  assert.doesNotMatch(result.stdout, /Table options:/);
});

test("latex table rejects Markdown-only table options", async () => {
  const result = await runCli([
    "latex",
    "table",
    "--library-id",
    "1",
    "--key",
    "ABCD1234",
    "--query",
    "Table 2",
    "--table-format",
    "markdown",
  ]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /does not accept --table-format/);
});

test("latex fetch accepts the refresh switch and main-file option", async () => {
  await withServer(
    {
      status: 200,
      body: {
        arxivID: "2401.12345v2",
        mainFile: "paper/main.tex",
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "latex",
        "fetch",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
        "--refresh",
        "--main-file",
        "paper/main.tex",
      ]);

      assert.equal(result.code, 0);
      assert.equal(result.stderr, "");
      assert.equal(requests[0].pathname, "/mineru-for-zotero/latex/fetch");
      assert.equal(requests[0].searchParams.refresh, "true");
      assert.equal(requests[0].searchParams.mainFile, "paper/main.tex");
    },
  );
});

test("formats a LaTeX fetch manifest without unknown fields", async () => {
  await withServer(
    {
      status: 200,
      body: {
        arxivID: "2505.06708",
        resolvedVersion: "latest",
        mainFile: "main.tex",
        files: ["main.tex", "figures/a.png"],
        fileCount: 2,
        status: "ready",
      },
    },
    async ({ port }) => {
      const result = await runCli([
        "latex",
        "fetch",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
      ]);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /arXiv: 2505\.06708/);
      assert.match(result.stdout, /Version: latest/);
      assert.match(result.stdout, /Main file: main\.tex/);
      assert.match(result.stdout, /Files: 2/);
      assert.doesNotMatch(result.stdout, /unknown/);
    },
  );
});

test("rejects LaTeX section numbers and unrelated context options", async () => {
  const numbered = await runCli([
    "latex",
    "read",
    "--library-id",
    "1",
    "--key",
    "ABCD1234",
    "--granularity",
    "section",
    "--section-number",
    "2",
  ]);
  assert.equal(numbered.code, 2);
  assert.match(numbered.stderr, /--section-number/);
  const context = await runCli([
    "latex",
    "read",
    "--library-id",
    "1",
    "--key",
    "ABCD1234",
    "--granularity",
    "headings",
    "--context-paragraphs",
    "2",
  ]);
  assert.equal(context.code, 2);
  assert.match(context.stderr, /--context-paragraphs/);
});

test("formats LaTeX headings, source search, and tables without Markdown fields", async () => {
  const responses = [
    {
      granularity: "headings",
      item: { title: "Paper" },
      headings: [
        {
          command: "section",
          level: 1,
          title: "Results",
          path: ["Results"],
          file: "main.tex",
          line: 10,
        },
      ],
    },
    {
      granularity: "search",
      query: "gating",
      matches: [
        {
          hit: "Gating works.",
          file: "parts/results.tex",
          line: 27,
          before: ["Before."],
          after: ["After."],
        },
      ],
    },
    {
      query: "Gating",
      tables: [
        {
          caption: "Gating variant performance",
          file: "main.tex",
          lineStart: 20,
          lineEnd: 24,
          content: "\\begin{table}...\\end{table}",
        },
      ],
    },
  ];
  for (const [index, operation] of ["read", "read", "table"].entries()) {
    await withServer(
      { status: 200, body: responses[index] },
      async ({ port }) => {
        const args = [
          "latex",
          operation,
          "--port",
          String(port),
          "--library-id",
          "1",
          "--key",
          "ABCD1234",
        ];
        if (index === 0) args.push("--granularity", "headings");
        if (index === 1)
          args.push("--granularity", "search", "--query", "gating");
        if (index === 2) args.push("--query", "Gating");
        const result = await runCli(args);
        assert.equal(result.code, 0);
        assert.doesNotMatch(
          result.stdout,
          /undefined|Paragraph:|Page:|Raw Index:|Match: both/,
        );
        if (index === 0) assert.match(result.stdout, /main\.tex:10/);
        if (index === 1) assert.match(result.stdout, /parts\/results\.tex:27/);
        if (index === 2)
          assert.match(result.stdout, /Gating variant performance/);
      },
    );
  }
});

test("writes LaTeX images under their source paths and reports partial failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "mineru-latex-images-"));
  try {
    await withServer(
      {
        status: 200,
        body: {
          images: [
            {
              path: "imgs/one.pdf",
              status: "ok",
              mime: "application/pdf",
              dataURL: "data:application/pdf;base64,AQID",
            },
            { path: "../bad.pdf", status: "invalid-path" },
            { path: "imgs/one.pdf", status: "duplicate-path" },
            {
              path: "logo/two.pdf",
              status: "ok",
              mime: "application/pdf",
              dataURL: "data:application/pdf;base64,BAUG",
            },
          ],
        },
      },
      async ({ port }) => {
        const result = await runCli([
          "latex",
          "image",
          "--port",
          String(port),
          "--library-id",
          "1",
          "--key",
          "ABCD1234",
          "--path",
          "imgs/one.pdf,../bad.pdf,imgs/one.pdf,logo/two.pdf",
          "--output-dir",
          root,
          "--format",
          "json",
        ]);
        assert.equal(result.code, 1);
        const output = JSON.parse(result.stdout);
        assert.equal(output.ok, false);
        assert.deepEqual(
          output.data.images.map((image) => image.status),
          ["ok", "invalid-path", "duplicate-path", "ok"],
        );
        assert.doesNotMatch(result.stdout, /base64|dataURL/);
        assert.deepEqual(
          await readFile(join(root, "imgs", "one.pdf")),
          Buffer.from([1, 2, 3]),
        );
        assert.deepEqual(
          await readFile(join(root, "logo", "two.pdf")),
          Buffer.from([4, 5, 6]),
        );
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shows ambiguous LaTeX heading paths in text errors", async () => {
  await withServer(
    {
      status: 400,
      body: {
        error: "ambiguous-section",
        message: "ambiguous-section",
        candidates: [
          { path: ["Experiments", "Results"], file: "main.tex", line: 12 },
        ],
      },
    },
    async ({ port }) => {
      const result = await runCli([
        "latex",
        "read",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
        "--granularity",
        "section",
        "--section-path",
        "Results",
      ]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Experiments \/ Results.*main\.tex:12/);
      assert.doesNotMatch(result.stderr, /unknown|undefined/);
    },
  );
});

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
      assert.match(result.stdout, /Source Query Search/);
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
        "read",
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
      assert.equal(output.request.command, "markdown.read");
      assert.equal(output.request.endpoint, "/mineru-for-zotero/markdown/read");
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
        "read",
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

test("passes comma and range section-number expressions", async () => {
  await withServer(
    {
      status: 200,
      body: {
        item: { key: "ABCD1234", title: "Paper" },
        attachment: { key: "PDFKEY01", fileName: "paper.pdf" },
        result: { mode: "precise", source: "preferred" },
        granularity: "section",
        groups: [
          {
            query: "5.1,5.3-5.5",
            kind: "section-number",
            status: "ok",
            matches: [
              {
                heading: {
                  title: "5.1 Setup",
                  path: ["Paper", "5.1 Setup"],
                  line: 10,
                },
                content: "## 5.1 Setup\n\nBody",
                images: [],
              },
            ],
          },
        ],
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "markdown",
        "read",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
        "--granularity",
        "section",
        "--section-number",
        "5.1,5.3-5.5",
      ]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /\[Group 1] 5\.1,5\.3-5\.5/);
      assert.equal(requests[0].searchParams.sectionNumber, "5.1,5.3-5.5");
    },
  );
});

test("passes table match and table-format options", async () => {
  await withServer(
    {
      status: 200,
      body: {
        query: "Table 2",
        match: "content",
        tableFormat: "markdown",
        tables: [
          { caption: "Table 2", page: 3, rawIndex: 7, content: "| A |" },
        ],
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "markdown",
        "table",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
        "--query",
        "Table 2",
        "--table-format",
        "markdown",
        "--match",
        "content",
      ]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /Table 2/);
      assert.equal(requests[0].pathname, "/mineru-for-zotero/markdown/table");
      assert.equal(requests[0].searchParams.tableFormat, "markdown");
      assert.equal(requests[0].searchParams.match, "content");
    },
  );
});

test("passes caption-exact table match option", async () => {
  await withServer(
    {
      status: 200,
      body: {
        query: "Table 1",
        match: "caption-exact",
        tableFormat: "html",
        tables: [{ caption: "Table 1", page: 1, rawIndex: 1, content: "" }],
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "markdown",
        "table",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
        "--query",
        "Table 1",
        "--match",
        "caption-exact",
      ]);

      assert.equal(result.code, 0);
      assert.equal(result.stderr, "");
      assert.equal(requests[0].pathname, "/mineru-for-zotero/markdown/table");
      assert.equal(requests[0].searchParams.match, "caption-exact");
    },
  );
});

test("writes image binary responses to the requested output file", async () => {
  const root = await mkdtemp(join(tmpdir(), "mineru-cli-image-"));
  const outputPath = join(root, "figure.png");
  const imageBytes = Uint8Array.from([137, 80, 78, 71]);

  try {
    await withServer(
      {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
        rawBody: imageBytes,
      },
      async ({ port, requests }) => {
        const result = await runCli([
          "markdown",
          "image",
          "--port",
          String(port),
          "--library-id",
          "1",
          "--key",
          "ABCD1234",
          "--path",
          "images/figure.png",
          "--output",
          outputPath,
        ]);

        assert.equal(result.code, 0);
        assert.match(result.stdout, /Image saved/);
        assert.equal(result.stderr, "");
        assert.equal(requests[0].pathname, "/mineru-for-zotero/markdown/image");
        assert.equal(requests[0].searchParams.path, "images/figure.png");
        assert.deepEqual(
          new Uint8Array(await readFile(outputPath)),
          imageBytes,
        );
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes a single-image JSON response to --output", async () => {
  const root = await mkdtemp(join(tmpdir(), "mineru-cli-image-json-"));
  const outputPath = join(root, "figure.jpg");
  const imageBytes = Uint8Array.from([255, 216, 255, 224, 0, 16]);

  try {
    await withServer(
      {
        status: 200,
        body: {
          images: [
            {
              path: "images/figure.jpg",
              status: "ok",
              mime: "image/jpeg",
              dataURL: `data:image/jpeg;base64,${Buffer.from(imageBytes).toString("base64")}`,
            },
          ],
        },
      },
      async ({ port }) => {
        const result = await runCli([
          "markdown",
          "image",
          "--port",
          String(port),
          "--library-id",
          "1",
          "--key",
          "ABCD1234",
          "--path",
          "images/figure.jpg",
          "--output",
          outputPath,
        ]);

        assert.equal(result.code, 0);
        assert.match(result.stdout, /Image saved/);
        assert.match(result.stdout, /Bytes: 6/);
        assert.deepEqual(
          new Uint8Array(await readFile(outputPath)),
          imageBytes,
        );
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes a single-image JSON response to --output-dir", async () => {
  const root = await mkdtemp(join(tmpdir(), "mineru-cli-image-dir-"));
  const imageBytes = Uint8Array.from([137, 80, 78, 71]);

  try {
    await withServer(
      {
        status: 200,
        body: {
          images: [
            {
              path: "images/figure.png",
              status: "ok",
              mime: "image/png",
              dataURL: `data:image/png;base64,${Buffer.from(imageBytes).toString("base64")}`,
            },
          ],
        },
      },
      async ({ port }) => {
        const result = await runCli([
          "markdown",
          "image",
          "--port",
          String(port),
          "--library-id",
          "1",
          "--key",
          "ABCD1234",
          "--path",
          "images/figure.png",
          "--output-dir",
          root,
        ]);

        assert.equal(result.code, 0);
        assert.match(result.stdout, /Written: 1/);
        assert.deepEqual(
          new Uint8Array(await readFile(join(root, "figure.png"))),
          imageBytes,
        );
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects image requests without an output target", async () => {
  await withServer(
    {
      status: 200,
      headers: {
        "content-type": "image/png",
      },
      rawBody: Uint8Array.from([137, 80, 78, 71]),
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "markdown",
        "image",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
        "--path",
        "images/figure.png",
      ]);

      assert.equal(result.code, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /--output or --output-dir/);
      assert.equal(requests.length, 0);
    },
  );
});

test("writes multi-image json responses under the requested output directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "mineru-cli-images-"));
  const outputDir = join(root, "images-out");
  const firstBytes = Uint8Array.from([1, 2, 3, 4]);
  const secondBytes = Uint8Array.from([5, 6, 7, 8]);

  try {
    await withServer(
      {
        status: 200,
        body: {
          images: [
            {
              path: "images/figures/one.png",
              status: "ok",
              mime: "image/png",
              dataURL: `data:image/png;base64,${Buffer.from(
                firstBytes,
              ).toString("base64")}`,
            },
            {
              path: "images/two.jpg",
              status: "ok",
              mime: "image/jpeg",
              dataURL: `data:image/jpeg;base64,${Buffer.from(
                secondBytes,
              ).toString("base64")}`,
            },
          ],
        },
      },
      async ({ port, requests }) => {
        const result = await runCli([
          "markdown",
          "image",
          "--port",
          String(port),
          "--library-id",
          "1",
          "--key",
          "ABCD1234",
          "--path",
          "images/figures/one.png,images/two.jpg",
          "--output-dir",
          outputDir,
        ]);

        assert.equal(result.code, 0);
        assert.match(result.stdout, /Written: 2/);
        assert.equal(result.stderr, "");
        assert.equal(requests[0].pathname, "/mineru-for-zotero/markdown/image");
        assert.equal(
          requests[0].searchParams.path,
          "images/figures/one.png,images/two.jpg",
        );
        assert.deepEqual(
          new Uint8Array(await readFile(join(outputDir, "figures", "one.png"))),
          firstBytes,
        );
        assert.deepEqual(
          new Uint8Array(await readFile(join(outputDir, "two.jpg"))),
          secondBytes,
        );
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects multi-image requests that use --output without --output-dir", async () => {
  const root = await mkdtemp(join(tmpdir(), "mineru-cli-image-"));
  const outputPath = join(root, "figure.png");

  try {
    await withServer(
      {
        status: 200,
        body: {
          images: [
            {
              path: "images/figures/one.png",
              status: "ok",
              mime: "image/png",
              dataURL: "data:image/png;base64,AQIDBA==",
            },
          ],
        },
      },
      async ({ port, requests }) => {
        const result = await runCli([
          "markdown",
          "image",
          "--port",
          String(port),
          "--library-id",
          "1",
          "--key",
          "ABCD1234",
          "--path",
          "images/figures/one.png,images/two.jpg",
          "--output",
          outputPath,
        ]);

        assert.equal(result.code, 2);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /--output-dir/);
        assert.equal(requests.length, 0);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
        "read",
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
  const result = await runCli(["markdown", "read", "--library-id", "1"]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing required option: --key/);
  assert.match(result.stderr, /Usage:/);
  assert.match(
    result.stderr,
    /node mineru-for-zotero-cli\/scripts\/query-source\.mjs markdown read/,
  );
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
      ...(response.headers ?? {}),
    });
    res.end(response.rawBody ?? JSON.stringify(response.body));
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
