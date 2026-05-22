import { assert } from "chai";
import {
  createMinerUClientForSettings,
  createMinerUClient,
  MinerUFileAccessError,
  MinerURequestError,
  MinerUTaskError,
} from "../src/modules/mineruClient";

describe("mineruClient", function () {
  it("creates the online precise client for explicit settings", async function () {
    const calls: string[] = [];
    const client = createMinerUClientForSettings({
      source: "online",
      mode: "precise",
      apiKey: "secret-token",
      readBinary: async () => new Uint8Array([1]),
      fetch: async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${String(url)}`);
        if (String(url).endsWith("/api/v4/file-urls/batch")) {
          return jsonResponse({
            code: 0,
            data: {
              batch_id: "batch-1",
              file_urls: ["https://upload.example/a"],
            },
          });
        }
        return new Response("", { status: 200 });
      },
    });

    await client.submitPdf("C:/tmp/a.pdf");

    assert.equal(calls[0], "POST https://mineru.net/api/v4/file-urls/batch");
  });

  it("checks local health before submitting a local task", async function () {
    const calls: string[] = [];
    const client = createMinerUClientForSettings({
      source: "local",
      mode: "lite",
      apiKey: "",
      localApiBaseURL: "http://127.0.0.1:8000",
      readBinary: async () => new Uint8Array([1, 2, 3]),
      fetch: async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${String(url)}`);
        if (String(url).endsWith("/health")) {
          return jsonResponse({ status: "healthy" });
        }
        return jsonResponse({ task_id: "local-task" }, 202);
      },
    });

    const result = await client.submitPdf("C:/tmp/a.pdf");

    assert.deepEqual(result, { taskID: "local-task" });
    assert.equal(calls[0], "GET http://127.0.0.1:8000/health");
    assert.equal(calls[1], "POST http://127.0.0.1:8000/tasks");
  });

  it("submits local lite tasks with markdown-only result flags", async function () {
    let submittedBody: FormData | undefined;
    const client = createMinerUClientForSettings({
      source: "local",
      mode: "lite",
      apiKey: "",
      localApiBaseURL: "http://127.0.0.1:8000",
      readBinary: async () => new Uint8Array([1, 2, 3]),
      fetch: async (url, init) => {
        if (String(url).endsWith("/health")) {
          return jsonResponse({ status: "healthy" });
        }
        submittedBody = init?.body as FormData;
        return jsonResponse({ task_id: "local-task" }, 202);
      },
    });

    await client.submitPdf("C:/tmp/a.pdf");

    assert.equal(submittedBody?.get("return_md"), "true");
    assert.equal(submittedBody?.get("return_middle_json"), "false");
    assert.equal(submittedBody?.get("return_images"), "false");
    assert.equal(submittedBody?.get("response_format_zip"), "false");
  });

  it("submits local precise tasks through the default fetch path", async function () {
    const globals = globalThis as typeof globalThis & {
      fetch?: typeof fetch;
    };
    const originalFetch = globals.fetch;
    const originalRequest = Zotero.HTTP.request;
    const calls: string[] = [];
    let submittedBody: FormData | undefined;
    globals.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).endsWith("/health")) {
        return jsonResponse({ status: "healthy" });
      }
      submittedBody = init?.body as FormData;
      return jsonResponse({ task_id: "local-task" }, 202);
    }) as typeof fetch;
    (
      Zotero.HTTP as typeof Zotero.HTTP & {
        request: typeof Zotero.HTTP.request;
      }
    ).request = async () => {
      throw new Error("Zotero.HTTP should not submit local FormData");
    };

    try {
      const client = createMinerUClientForSettings({
        source: "local",
        mode: "precise",
        apiKey: "",
        localApiBaseURL: "http://127.0.0.1:8000",
        saveImages: false,
        readBinary: async () => new Uint8Array([1, 2, 3]),
      });

      const result = await client.submitPdf("C:/tmp/a.pdf");

      assert.deepEqual(result, { taskID: "local-task" });
      assert.deepEqual(calls, [
        "GET http://127.0.0.1:8000/health",
        "POST http://127.0.0.1:8000/tasks",
      ]);
      assert.equal(submittedBody?.get("return_middle_json"), "true");
      assert.equal(submittedBody?.get("return_content_list"), "true");
      assert.equal(submittedBody?.get("return_images"), "false");
      assert.equal(submittedBody?.get("response_format_zip"), "true");
    } finally {
      globals.fetch = originalFetch;
      (
        Zotero.HTTP as typeof Zotero.HTTP & {
          request: typeof Zotero.HTTP.request;
        }
      ).request = originalRequest;
    }
  });

  it("maps local task polling states to MinerU task status", async function () {
    const calls: string[] = [];
    const client = createMinerUClientForSettings({
      source: "local",
      mode: "precise",
      apiKey: "",
      localApiBaseURL: "http://127.0.0.1:8000/",
      fetch: async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${String(url)}`);
        return jsonResponse({ status: "completed" });
      },
    });

    const result = await client.pollTask("local-task");

    assert.deepEqual(result, { status: "succeeded" });
    assert.deepEqual(calls, ["GET http://127.0.0.1:8000/tasks/local-task"]);
  });

  it("throws task errors when local submit response misses task id", async function () {
    const client = createMinerUClientForSettings({
      source: "local",
      mode: "lite",
      apiKey: "",
      localApiBaseURL: "http://127.0.0.1:8000",
      readBinary: async () => new Uint8Array([1, 2, 3]),
      fetch: async (url) =>
        String(url).endsWith("/health")
          ? jsonResponse({ status: "healthy" })
          : jsonResponse({}),
    });

    try {
      await client.submitPdf("C:/tmp/a.pdf");
      assert.fail("Expected submitPdf to throw");
    } catch (error) {
      assert.instanceOf(error, MinerUTaskError);
      assert.include((error as Error).message, "missing task_id");
    }
  });

  it("downloads local lite markdown from JSON results", async function () {
    const client = createMinerUClientForSettings({
      source: "local",
      mode: "lite",
      apiKey: "",
      localApiBaseURL: "http://127.0.0.1:8000",
      fetch: async () =>
        jsonResponse({
          results: {
            "a.pdf": { md_content: "# Lite" },
          },
        }),
    });

    const result = await client.downloadResult("local-task");

    assert.deepEqual(result, { kind: "lite", markdown: "# Lite" });
  });

  it("downloads local precise markdown and raw result from JSON results", async function () {
    const raw = {
      pdf_info: [{ page_idx: 0, page_size: [100, 200], para_blocks: [] }],
    };
    const client = createMinerUClientForSettings({
      source: "local",
      mode: "precise",
      apiKey: "",
      localApiBaseURL: "http://127.0.0.1:8000",
      fetch: async () =>
        jsonResponse({
          results: {
            "a.pdf": {
              md_content: "# Precise",
              middle_json: JSON.stringify(raw),
              content_list: JSON.stringify([{ type: "text" }]),
            },
          },
        }),
    });

    const result = await client.downloadResult("local-task");

    assert.equal(result.kind, "precise");
    if (result.kind !== "precise") {
      assert.fail("Expected precise result");
    }
    assert.equal(result.markdown, "# Precise");
    assert.deepEqual(result.rawResult, raw);
  });

  it("downloads local precise results from zip responses", async function () {
    const raw = {
      pdf_info: [{ page_idx: 0, page_size: [100, 200], para_blocks: [] }],
    };
    const client = createMinerUClientForSettings({
      source: "local",
      mode: "precise",
      apiKey: "",
      localApiBaseURL: "http://127.0.0.1:8000",
      fetch: async () =>
        new Response(
          createStoredZipBytes({
            "a.md": "# Precise Zip",
            "a_middle.json": JSON.stringify(raw),
          }),
          { headers: { "Content-Type": "application/octet-stream" } },
        ),
    });

    const result = await client.downloadResult("local-task");

    assert.equal(result.kind, "precise");
    if (result.kind !== "precise") {
      assert.fail("Expected precise result");
    }
    assert.equal(result.markdown, "# Precise Zip");
    assert.deepEqual(result.rawResult, raw);
  });

  it("falls back to nsIZipReader for compressed local zip results", async function () {
    const raw = {
      pdf_info: [{ page_idx: 0, page_size: [100, 200], para_blocks: [] }],
    };
    const runtime = globalThis as typeof globalThis & {
      DecompressionStream?: typeof DecompressionStream;
    };
    const originalDecompressionStream = runtime.DecompressionStream;
    runtime.DecompressionStream = undefined;

    try {
      const client = createMinerUClientForSettings({
        source: "local",
        mode: "precise",
        apiKey: "",
        localApiBaseURL: "http://127.0.0.1:8000",
        fetch: async () =>
          new Response(
            createDeflatedZipBytes({
              "a.md": "# Precise Zip",
              "a_middle.json": JSON.stringify(raw),
            }),
            { headers: { "Content-Type": "application/zip" } },
          ),
      });

      let result: Awaited<ReturnType<typeof client.downloadResult>>;
      try {
        result = await client.downloadResult("local-task");
      } catch (error) {
        assert.fail(
          error instanceof Error
            ? `${error.message}\n${error.stack ?? ""}`
            : String(error),
        );
      }

      assert.equal(result.kind, "precise");
      if (result.kind !== "precise") {
        assert.fail("Expected precise result");
      }
      assert.equal(result.markdown, "# Precise Zip");
      assert.deepEqual(result.rawResult, raw);
    } finally {
      runtime.DecompressionStream = originalDecompressionStream;
    }
  });

  it("submits online lite tasks without authorization", async function () {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    let uploadBody: Uint8Array | undefined;
    const client = createMinerUClientForSettings({
      source: "online",
      mode: "lite",
      apiKey: "",
      readBinary: async () => new Uint8Array([1, 2, 3]),
      uploadBinary: async (url, body) => {
        uploadBody = body;
        calls.push({ url, init: { method: "PUT", body } });
        return new Response("", { status: 200 });
      },
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/api/v1/agent/parse/file")) {
          return jsonResponse({
            task_id: "agent-task",
            file_url: "https://upload.example/lite",
          });
        }
        return new Response("", { status: 200 });
      },
    });

    const result = await client.submitPdf("C:/tmp/a.pdf");

    assert.deepEqual(result, { taskID: "agent-task" });
    assert.equal(calls[0].url, "https://mineru.net/api/v1/agent/parse/file");
    assert.isUndefined(
      (calls[0].init?.headers as Record<string, string> | undefined)
        ?.Authorization,
    );
    assert.equal(calls[1].url, "https://upload.example/lite");
    assert.equal(calls[1].init?.method, "PUT");
    assert.deepEqual(uploadBody, new Uint8Array([1, 2, 3]));
  });

  it("downloads online lite markdown from markdown_url", async function () {
    const client = createMinerUClientForSettings({
      source: "online",
      mode: "lite",
      apiKey: "",
      fetch: async (url) => {
        if (String(url).includes("/api/v1/agent/parse/")) {
          return jsonResponse({
            state: "done",
            markdown_url: "https://download.example/lite.md",
          });
        }
        throw new Error("Markdown URL should use downloadBinary");
      },
      downloadBinary: async (url) =>
        String(url) === "https://download.example/lite.md"
          ? new Response("# Lite")
          : new Response("bad", { status: 404 }),
    });

    const result = await client.downloadResult("agent-task");

    assert.deepEqual(result, { kind: "lite", markdown: "# Lite" });
  });

  it("submits a local PDF through the official batch upload flow", async function () {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = createMinerUClient({
      apiKey: "secret-token",
      readBinary: async () => new Uint8Array([1, 2, 3]),
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/api/v4/file-urls/batch")) {
          return jsonResponse({
            code: 0,
            data: {
              batch_id: "batch-1",
              file_urls: ["https://upload.example/a"],
            },
          });
        }
        return new Response("", { status: 200 });
      },
    });

    const result = await client.submitPdf("C:/tmp/a.pdf");

    assert.deepEqual(result, { taskID: "batch-1" });
    assert.equal(calls[0].url, "https://mineru.net/api/v4/file-urls/batch");
    assert.equal(calls[0].init?.method, "POST");
    assert.deepInclude(JSON.parse(String(calls[0].init?.body)), {
      enable_formula: true,
      enable_table: true,
      language: "auto",
      model_version: "vlm",
    });
    assert.equal(
      (calls[0].init?.headers as Record<string, string>).Authorization,
      "Bearer secret-token",
    );
    assert.equal(calls[1].url, "https://upload.example/a");
    assert.equal(calls[1].init?.method, "PUT");
  });

  it("uploads binary views through direct XHR without request headers", async function () {
    const originalRequest = Zotero.HTTP.request;
    const originalXMLHttpRequest = globalThis.XMLHttpRequest;
    const calls: Array<{
      method: string;
      url: string;
      body: string | Uint8Array | undefined;
      headers: Record<string, string> | undefined;
    }> = [];
    const uploadCalls: Array<{
      method: string;
      url: string;
      body: ArrayBuffer | ArrayBufferView | null;
      headers: Record<string, string>;
    }> = [];
    (
      Zotero.HTTP as typeof Zotero.HTTP & {
        request: typeof Zotero.HTTP.request;
      }
    ).request = async (method, url, options) => {
      if (method === "PUT") {
        throw new Error("PUT upload should bypass Zotero.HTTP.request");
      }
      calls.push({
        method,
        url,
        body: options?.body,
        headers: options?.headers,
      });
      return xhrResponse(
        method === "POST"
          ? {
              code: 0,
              data: {
                batch_id: "batch-1",
                file_urls: ["https://upload.example/a"],
              },
            }
          : "",
      );
    };
    globalThis.XMLHttpRequest = class {
      status = 200;
      statusText = "OK";
      response = new ArrayBuffer(0);
      responseType = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private method = "";
      private url = "";
      private headers: Record<string, string> = {};

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }

      setRequestHeader(name: string, value: string) {
        this.headers[name] = value;
      }

      getAllResponseHeaders() {
        return "";
      }

      send(body?: Document | XMLHttpRequestBodyInit | null) {
        uploadCalls.push({
          method: this.method,
          url: this.url,
          body: body as ArrayBuffer | ArrayBufferView | null,
          headers: this.headers,
        });
        this.onload?.();
      }
    } as unknown as typeof XMLHttpRequest;

    try {
      const client = createMinerUClient({
        apiKey: "secret-token",
        readBinary: async () =>
          new DataView(
            new Uint8Array([1, 2, 3]).buffer,
          ) as unknown as Uint8Array,
      });

      const result = await client.submitPdf("C:/tmp/a.pdf");

      assert.deepEqual(result, { taskID: "batch-1" });
      assert.equal(uploadCalls[0].method, "PUT");
      assert.equal(uploadCalls[0].url, "https://upload.example/a");
      assert.deepEqual(uploadCalls[0].headers, {});
      assert.deepEqual(
        Array.from(new Uint8Array(uploadCalls[0].body as ArrayBuffer)),
        [1, 2, 3],
      );
    } finally {
      (
        Zotero.HTTP as typeof Zotero.HTTP & {
          request: typeof Zotero.HTTP.request;
        }
      ).request = originalRequest;
      globalThis.XMLHttpRequest = originalXMLHttpRequest;
    }
  });

  it("throws request errors without leaking the API key", async function () {
    const client = createMinerUClient({
      apiKey: "secret-token",
      readBinary: async () => new Uint8Array([1]),
      fetch: async () => new Response("bad", { status: 500 }),
    });

    try {
      await client.submitPdf("C:/tmp/a.pdf");
      assert.fail("Expected submitPdf to throw");
    } catch (error) {
      assert.instanceOf(error, MinerURequestError);
      assert.include((error as Error).message, "submit");
      assert.include((error as Error).message, "500");
      assert.notInclude((error as Error).message, "secret-token");
    }
  });

  it("includes response body summaries in request errors", async function () {
    const client = createMinerUClient({
      apiKey: "secret-token",
      readBinary: async () => new Uint8Array([1]),
      fetch: async () =>
        new Response(
          "<Error><Code>SignatureDoesNotMatch</Code><Message>bad signature</Message></Error>",
          { status: 403 },
        ),
    });

    try {
      await client.submitPdf("C:/tmp/a.pdf");
      assert.fail("Expected submitPdf to throw");
    } catch (error) {
      assert.instanceOf(error, MinerURequestError);
      assert.include((error as Error).message, "submit");
      assert.include((error as Error).message, "403");
      assert.include((error as Error).message, "SignatureDoesNotMatch");
      assert.include((error as Error).message, "bad signature");
      assert.notInclude((error as Error).message, "secret-token");
    }
  });

  it("wraps network errors with request stage without leaking the API key", async function () {
    const client = createMinerUClient({
      apiKey: "secret-token",
      readBinary: async () => new Uint8Array([1]),
      fetch: async () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      },
    });

    try {
      await client.submitPdf("C:/tmp/a.pdf");
      assert.fail("Expected submitPdf to throw");
    } catch (error) {
      assert.instanceOf(error, MinerURequestError);
      assert.include((error as Error).message, "submit");
      assert.include(
        (error as Error).message,
        "NetworkError when attempting to fetch resource.",
      );
      assert.notInclude((error as Error).message, "secret-token");
    }
  });

  it("wraps PDF read failures as file access errors", async function () {
    const client = createMinerUClient({
      apiKey: "secret-token",
      readBinary: async () => {
        throw new Error("EACCES: permission denied");
      },
      fetch: async () =>
        jsonResponse({
          code: 0,
          data: {
            batch_id: "batch-1",
            file_urls: ["https://upload.example/a"],
          },
        }),
    });

    try {
      await client.submitPdf("C:/tmp/a.pdf");
      assert.fail("Expected submitPdf to throw");
    } catch (error) {
      assert.instanceOf(error, MinerUFileAccessError);
      assert.include((error as Error).message, "C:/tmp/a.pdf");
      assert.include((error as Error).message, "EACCES");
    }
  });

  it("polls batch results and reports terminal failure", async function () {
    const client = createMinerUClient({
      apiKey: "secret-token",
      fetch: async () =>
        jsonResponse({
          code: 0,
          data: {
            extract_result: [{ state: "failed", err_msg: "quota exceeded" }],
          },
        }),
    });

    const result = await client.pollTask("batch-1");

    assert.deepEqual(result, {
      status: "failed",
      error: "quota exceeded",
    });
  });

  it("downloads markdown and raw json from full_zip_url", async function () {
    const client = createMinerUClient({
      apiKey: "secret-token",
      fetch: async (url) => {
        if (String(url).includes("/extract-results/")) {
          return jsonResponse({
            code: 0,
            data: {
              extract_result: [
                {
                  state: "done",
                  full_zip_url: "https://download.example/full.zip",
                },
              ],
            },
          });
        }
        return new Response(
          createStoredZipBytes({
            "full.md": "# Title",
            "layout.json": JSON.stringify({ pages: [{ pageNo: 1 }] }),
          }),
        );
      },
    });

    const result = await client.downloadResult("batch-1");

    assert.equal(result.kind, "precise");
    if (result.kind !== "precise") {
      assert.fail("Expected precise result");
    }
    assert.equal(result.markdown, "# Title");
    assert.deepEqual(result.rawResult, { pages: [{ pageNo: 1 }] });
  });

  it("extracts files from the zip images directory", async function () {
    const client = createMinerUClient({
      apiKey: "secret-token",
      fetch: async (url) => {
        if (String(url).includes("/extract-results/")) {
          return jsonResponse({
            code: 0,
            data: {
              extract_result: [
                {
                  state: "done",
                  full_zip_url: "https://download.example/full.zip",
                },
              ],
            },
          });
        }
        return new Response(
          createStoredZipBytes({
            "full.md": "# Title\n![A](images/a.png)",
            "layout.json": JSON.stringify({ pages: [{ pageNo: 1 }] }),
            "images/a.png": new Uint8Array([137, 80, 78, 71]),
            "not-images/b.png": new Uint8Array([1, 2, 3]),
          }),
        );
      },
    });

    const result = await client.downloadResult("batch-1");

    assert.equal(result.kind, "precise");
    if (result.kind !== "precise") {
      assert.fail("Expected precise result");
    }
    assert.deepEqual(result.images, [
      { path: "a.png", bytes: new Uint8Array([137, 80, 78, 71]) },
    ]);
  });

  it("prefers the zip json that contains page box data", async function () {
    const client = createMinerUClient({
      apiKey: "secret-token",
      fetch: async (url) => {
        if (String(url).includes("/extract-results/")) {
          return jsonResponse({
            code: 0,
            data: {
              extract_result: [
                {
                  state: "done",
                  full_zip_url: "https://download.example/full.zip",
                },
              ],
            },
          });
        }
        return new Response(
          createStoredZipBytes({
            "full.md": "# Title",
            "content_list.json": JSON.stringify([{ type: "text" }]),
            "middle.json": JSON.stringify({
              pdf_info: [
                {
                  page_idx: 0,
                  page_size: [1000, 2000],
                  para_blocks: [{ type: "text", bbox: [100, 400, 400, 500] }],
                },
              ],
            }),
          }),
        );
      },
    });

    const result = await client.downloadResult("batch-1");

    assert.equal(result.kind, "precise");
    if (result.kind !== "precise") {
      assert.fail("Expected precise result");
    }
    assert.deepEqual(result.rawResult, {
      pdf_info: [
        {
          page_idx: 0,
          page_size: [1000, 2000],
          para_blocks: [{ type: "text", bbox: [100, 400, 400, 500] }],
        },
      ],
    });
  });

  it("downloads signed result URLs through direct XHR", async function () {
    const originalRequest = Zotero.HTTP.request;
    const originalXMLHttpRequest = globalThis.XMLHttpRequest;
    const downloadCalls: Array<{
      method: string;
      url: string;
      headers: Record<string, string>;
    }> = [];
    (
      Zotero.HTTP as typeof Zotero.HTTP & {
        request: typeof Zotero.HTTP.request;
      }
    ).request = async (method, url) => {
      if (String(url).includes("/extract-results/")) {
        return xhrResponse({
          code: 0,
          data: {
            extract_result: [
              {
                state: "done",
                full_zip_url: "https://download.example/full.zip",
              },
            ],
          },
        });
      }
      throw new Error(
        "Signed result download should bypass Zotero.HTTP.request",
      );
    };
    globalThis.XMLHttpRequest = class {
      status = 0;
      statusText = "OK";
      response = createStoredZipBytes({
        "full.md": "# Title",
        "layout.json": JSON.stringify({ pages: [{ pageNo: 1 }] }),
      }).buffer;
      responseType = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private method = "";
      private url = "";
      private headers: Record<string, string> = {};

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }

      setRequestHeader(name: string, value: string) {
        this.headers[name] = value;
      }

      getAllResponseHeaders() {
        return "";
      }

      send() {
        downloadCalls.push({
          method: this.method,
          url: this.url,
          headers: this.headers,
        });
        this.onload?.();
      }
    } as unknown as typeof XMLHttpRequest;

    try {
      const client = createMinerUClient({ apiKey: "secret-token" });
      const result = await client.downloadResult("batch-1");

      assert.equal(result.kind, "precise");
      if (result.kind !== "precise") {
        assert.fail("Expected precise result");
      }
      assert.equal(result.markdown, "# Title");
      assert.deepEqual(result.rawResult, { pages: [{ pageNo: 1 }] });
      assert.deepEqual(downloadCalls, [
        {
          method: "GET",
          url: "https://download.example/full.zip",
          headers: {},
        },
      ]);
    } finally {
      (
        Zotero.HTTP as typeof Zotero.HTTP & {
          request: typeof Zotero.HTTP.request;
        }
      ).request = originalRequest;
      globalThis.XMLHttpRequest = originalXMLHttpRequest;
    }
  });

  it("falls back to Zotero HTTP when direct XHR download fails", async function () {
    const originalRequest = Zotero.HTTP.request;
    const originalXMLHttpRequest = globalThis.XMLHttpRequest;
    (
      Zotero.HTTP as typeof Zotero.HTTP & {
        request: typeof Zotero.HTTP.request;
      }
    ).request = async (method, url) => {
      if (String(url).includes("/extract-results/")) {
        return xhrResponse({
          code: 0,
          data: {
            extract_result: [
              {
                state: "done",
                full_zip_url: "https://download.example/full.zip",
              },
            ],
          },
        });
      }
      return xhrResponse(
        createStoredZipBytes({
          "full.md": "# Title",
          "layout.json": JSON.stringify({ pages: [{ pageNo: 1 }] }),
        }),
      );
    };
    globalThis.XMLHttpRequest = class {
      responseType = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      send() {
        this.onerror?.();
      }
    } as unknown as typeof XMLHttpRequest;

    try {
      const client = createMinerUClient({ apiKey: "secret-token" });
      const result = await client.downloadResult("batch-1");

      assert.equal(result.kind, "precise");
      if (result.kind !== "precise") {
        assert.fail("Expected precise result");
      }
      assert.equal(result.markdown, "# Title");
      assert.deepEqual(result.rawResult, { pages: [{ pageNo: 1 }] });
    } finally {
      (
        Zotero.HTTP as typeof Zotero.HTTP & {
          request: typeof Zotero.HTTP.request;
        }
      ).request = originalRequest;
      globalThis.XMLHttpRequest = originalXMLHttpRequest;
    }
  });

  it("reports invalid zip response summaries", async function () {
    const client = createMinerUClient({
      apiKey: "secret-token",
      fetch: async (url) => {
        if (String(url).includes("/extract-results/")) {
          return jsonResponse({
            code: 0,
            data: {
              extract_result: [
                {
                  state: "done",
                  full_zip_url: "https://download.example/full.zip",
                },
              ],
            },
          });
        }
        return new Response("<Error><Code>AccessDenied</Code></Error>");
      },
    });

    try {
      await client.downloadResult("batch-1");
      assert.fail("Expected downloadResult to throw");
    } catch (error) {
      assert.instanceOf(error, MinerUTaskError);
      assert.include((error as Error).message, "missing central directory");
      assert.include((error as Error).message, "AccessDenied");
      assert.include((error as Error).message, "attempts:");
    }
  });

  it("falls back to md_url when full_zip_url is empty", async function () {
    const client = createMinerUClient({
      apiKey: "secret-token",
      fetch: async (url) => {
        if (String(url).includes("/extract-results/")) {
          return jsonResponse({
            code: 0,
            data: {
              extract_result: [
                {
                  state: "done",
                  full_zip_url: "https://download.example/full.zip",
                  md_url: "https://download.example/full.md",
                },
              ],
            },
          });
        }
        if (String(url).endsWith("/full.zip")) {
          return new Response(new ArrayBuffer(0));
        }
        return new Response("# Title");
      },
    });

    const result = await client.downloadResult("batch-1");

    assert.equal(result.kind, "precise");
    if (result.kind !== "precise") {
      assert.fail("Expected precise result");
    }
    assert.equal(result.markdown, "# Title");
    assert.deepEqual(result.rawResult, {
      code: 0,
      data: {
        extract_result: [
          {
            state: "done",
            full_zip_url: "https://download.example/full.zip",
            md_url: "https://download.example/full.md",
          },
        ],
      },
    });
  });

  it("falls back to file download when network response is empty", async function () {
    const client = createMinerUClient({
      apiKey: "secret-token",
      fetch: async (url) => {
        if (String(url).includes("/extract-results/")) {
          return jsonResponse({
            code: 0,
            data: {
              extract_result: [
                {
                  state: "done",
                  full_zip_url: "https://download.example/full.zip",
                },
              ],
            },
          });
        }
        return new Response(new ArrayBuffer(0));
      },
      downloadFileBytes: async () =>
        createStoredZipBytes({
          "full.md": "# Title",
          "layout.json": JSON.stringify({ pages: [{ pageNo: 1 }] }),
        }),
    });

    const result = await client.downloadResult("batch-1");

    assert.equal(result.kind, "precise");
    if (result.kind !== "precise") {
      assert.fail("Expected precise result");
    }
    assert.equal(result.markdown, "# Title");
    assert.deepEqual(result.rawResult, { pages: [{ pageNo: 1 }] });
  });

  it("retries empty full_zip_url downloads after refetching task results", async function () {
    let extractCalls = 0;
    let downloadCalls = 0;
    const client = createMinerUClient({
      apiKey: "secret-token",
      maxDownloadAttempts: 2,
      downloadRetryDelayMs: 0,
      fetch: async (url) => {
        if (String(url).includes("/extract-results/")) {
          extractCalls += 1;
          return jsonResponse({
            code: 0,
            data: {
              extract_result: [
                {
                  state: "done",
                  full_zip_url: `https://download.example/full-${extractCalls}.zip`,
                },
              ],
            },
          });
        }
        downloadCalls += 1;
        if (downloadCalls === 1) {
          return new Response(new ArrayBuffer(0));
        }
        return new Response(
          createStoredZipBytes({
            "full.md": "# Title",
            "layout.json": JSON.stringify({ pages: [{ pageNo: 1 }] }),
          }),
        );
      },
      downloadFileBytes: async () => new Uint8Array(),
    });

    const result = await client.downloadResult("batch-1");

    assert.equal(result.kind, "precise");
    if (result.kind !== "precise") {
      assert.fail("Expected precise result");
    }
    assert.equal(result.markdown, "# Title");
    assert.equal(extractCalls, 2);
    assert.equal(downloadCalls, 2);
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function xhrResponse(value: unknown, status = 200): XMLHttpRequest {
  const response =
    value instanceof Uint8Array
      ? value.buffer
      : new TextEncoder().encode(
          typeof value === "string" ? value : JSON.stringify(value),
        ).buffer;
  return {
    status,
    statusText: "OK",
    response,
    getAllResponseHeaders: () => "Content-Type: application/json\r\n",
  } as XMLHttpRequest;
}

function createStoredZipBytes(
  files: Record<string, string | Uint8Array>,
): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const contentBytes =
      typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(contentBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, contentBytes.length, true);
    local.setUint32(22, contentBytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(10, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, contentBytes.length, true);
    central.setUint32(24, contentBytes.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, contentBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + contentBytes.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, Object.keys(files).length, true);
  endView.setUint16(10, Object.keys(files).length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  return concatBytes([...localParts, ...centralParts, end]);
}

function createDeflatedZipBytes(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const contentBytes = encoder.encode(content);
    const compressedBytes = deflateRawStoredBlock(contentBytes);
    const crc = crc32(contentBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, compressedBytes.length, true);
    local.setUint32(22, contentBytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(10, 8, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, compressedBytes.length, true);
    central.setUint32(24, contentBytes.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, compressedBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + compressedBytes.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, Object.keys(files).length, true);
  endView.setUint16(10, Object.keys(files).length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  return concatBytes([...localParts, ...centralParts, end]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function deflateRawStoredBlock(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 0xffff) {
    throw new Error("Test ZIP entry is too large for one stored deflate block");
  }
  const result = new Uint8Array(5 + bytes.length);
  result[0] = 0x01;
  result[1] = bytes.length & 0xff;
  result[2] = (bytes.length >>> 8) & 0xff;
  const inverted = (~bytes.length) & 0xffff;
  result[3] = inverted & 0xff;
  result[4] = (inverted >>> 8) & 0xff;
  result.set(bytes, 5);
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
