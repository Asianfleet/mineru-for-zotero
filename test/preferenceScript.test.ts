import { assert } from "chai";
import {
  openExternalURL,
  registerPrefsScripts,
  registerPreferenceValueSync,
} from "../src/modules/preferenceScript";
import {
  generateMarkdownApiToken,
  getMarkdownApiEnabled,
  getMarkdownApiRequireToken,
  getMarkdownApiToken,
  getLocalApiBaseURL,
  getLocalApiTimeoutMinutes,
  getParseMode,
  getParseSource,
  getSaveImages,
  setMarkdownApiEnabled,
  setMarkdownApiRequireToken,
  setMarkdownApiToken,
  setLocalApiBaseURL,
  setLocalApiTimeoutMinutes,
  setParseMode,
  setParseSource,
  setSaveImages,
} from "../src/utils/prefs";

describe("preferenceScript", function () {
  it("groups preferences into API service, data storage, and about sections", async function () {
    const preferences = await fetchPreferencePanelMarkup();

    assertIncreasingIndexes(preferences, [
      'data-l10n-id="mineruForZotero-pref-api-service-title"',
      'id="zotero-prefpane-mineruForZotero-api-key"',
      'id="zotero-prefpane-mineruForZotero-local-api-base-url"',
      'id="zotero-prefpane-mineruForZotero-local-api-timeout-minutes"',
      'id="zotero-prefpane-mineruForZotero-parse-source"',
      'id="zotero-prefpane-mineruForZotero-parse-mode"',
      'data-l10n-id="mineruForZotero-pref-data-storage-title"',
      'id="zotero-prefpane-mineruForZotero-save-images"',
      'id="mineruForZotero-open-data-folder"',
      'data-l10n-id="mineruForZotero-pref-about-title"',
    ]);
    assertAboutSectionInsideMainGroupbox(preferences);
    assertSectionHeadingLevels(preferences);
  });

  it("keeps the local API timeout input compact and left-aligned", async function () {
    const preferences = await fetchPreferencePanelMarkup();

    assert.include(
      preferences,
      'id="zotero-prefpane-mineruForZotero-local-api-timeout-minutes"',
    );
    assert.include(preferences, "width: 72px");
    assert.include(preferences, "text-align: left");
  });

  it("opens about links through Zotero's default browser launcher", function () {
    const opened: string[] = [];
    const launcher = {
      launchURL: (url: string) => {
        opened.push(url);
      },
    };

    openExternalURL("https://mineru.net/", launcher);

    assert.deepEqual(opened, ["https://mineru.net/"]);
  });

  it("enables saving MinerU images by default", function () {
    assert.isTrue(getSaveImages());
  });

  it("persists the save-images preference", function () {
    setSaveImages(false);
    assert.isFalse(getSaveImages());

    setSaveImages(true);
    assert.isTrue(getSaveImages());
  });

  it("initializes and persists save-images changes from a native checkbox", function () {
    const saveImages = fakePreferenceElement("false", "", "checkbox");
    const document = fakePreferenceDocument({
      "zotero-prefpane-mineruForZotero-save-images": saveImages,
    });

    try {
      setSaveImages(true);
      registerPreferenceValueSync(document);

      assert.isTrue(saveImages.checked);

      saveImages.checked = false;
      saveImages.emit("command");

      assert.isFalse(getSaveImages());
    } finally {
      setSaveImages(true);
    }
  });

  it("defaults parse source, parse mode, and local API URL", function () {
    assert.equal(getParseSource(), "online");
    assert.equal(getParseMode(), "precise");
    assert.equal(getLocalApiBaseURL(), "http://127.0.0.1:8000");
    assert.equal(getLocalApiTimeoutMinutes(), 30);
  });

  it("defaults the markdown query API to disabled with token required", function () {
    try {
      setMarkdownApiToken("");

      assert.isFalse(getMarkdownApiEnabled());
      assert.isTrue(getMarkdownApiRequireToken());

      const token = getMarkdownApiToken();
      assert.match(token, /^[A-Za-z0-9_-]{32,}$/);
      assert.equal(getMarkdownApiToken(), token);
    } finally {
      setMarkdownApiToken("");
    }
  });

  it("generates and persists a markdown query API token", function () {
    try {
      const token = generateMarkdownApiToken();
      assert.match(token, /^[A-Za-z0-9_-]{32,}$/);
      setMarkdownApiToken(token);
      assert.equal(getMarkdownApiToken(), token);
    } finally {
      setMarkdownApiToken("");
    }
  });

  it("round-trips parse source, parse mode, and local API URL", function () {
    try {
      setParseSource("local");
      setParseMode("lite");
      setLocalApiBaseURL("http://127.0.0.1:9000/");
      setLocalApiTimeoutMinutes(45);

      assert.equal(getParseSource(), "local");
      assert.equal(getParseMode(), "lite");
      assert.equal(getLocalApiBaseURL(), "http://127.0.0.1:9000/");
      assert.equal(getLocalApiTimeoutMinutes(), 45);
    } finally {
      setParseSource("online");
      setParseMode("precise");
      setLocalApiBaseURL("http://127.0.0.1:8000");
      setLocalApiTimeoutMinutes(30);
    }
  });

  it("falls back to the default local API timeout for invalid values", function () {
    try {
      setLocalApiTimeoutMinutes(0);
      assert.equal(getLocalApiTimeoutMinutes(), 30);

      setLocalApiTimeoutMinutes(Number.NaN);
      assert.equal(getLocalApiTimeoutMinutes(), 30);
    } finally {
      setLocalApiTimeoutMinutes(30);
    }
  });

  it("persists parse mode changes from the preferences UI immediately", function () {
    const parseMode = fakePreferenceElement("lite");
    const document = fakePreferenceDocument({
      "zotero-prefpane-mineruForZotero-parse-mode": parseMode,
    });

    try {
      setParseMode("lite");
      registerPreferenceValueSync(document);

      parseMode.value = "precise";
      parseMode.emit("change");

      assert.equal(getParseMode(), "precise");
    } finally {
      setParseMode("precise");
    }
  });

  it("persists parse source and mode changes from radiogroups immediately", function () {
    const parseSource = fakePreferenceElement("online", "", "radiogroup");
    const parseMode = fakePreferenceElement("precise", "", "radiogroup");
    const document = fakePreferenceDocument({
      "zotero-prefpane-mineruForZotero-parse-source": parseSource,
      "zotero-prefpane-mineruForZotero-parse-mode": parseMode,
    });

    try {
      setParseSource("online");
      setParseMode("precise");
      registerPreferenceValueSync(document);

      parseSource.value = "local";
      parseSource.emit("command");
      parseMode.value = "lite";
      parseMode.emit("command");

      assert.equal(getParseSource(), "local");
      assert.equal(getParseMode(), "lite");
    } finally {
      setParseSource("online");
      setParseMode("precise");
    }
  });

  it("shows local query API controls without a request example", async function () {
    const preferences = await fetchPreferencePanelMarkup();

    assertIncreasingIndexes(preferences, [
      'data-l10n-id="mineruForZotero-pref-query-api-title"',
      'id="zotero-prefpane-mineruForZotero-api-enabled"',
      'id="zotero-prefpane-mineruForZotero-api-require-token"',
      'id="mineruForZotero-api-token"',
      'id="mineruForZotero-api-regenerate-token"',
    ]);
    assert.include(preferences, 'readonly="readonly"');
    assert.notInclude(preferences, "Authorization: Bearer");
  });

  it("persists markdown query API checkbox changes immediately", function () {
    const enabled = fakePreferenceElement("false", "", "checkbox");
    const requireToken = fakePreferenceElement("true", "", "checkbox");
    const document = fakePreferenceDocument({
      "zotero-prefpane-mineruForZotero-api-enabled": enabled,
      "zotero-prefpane-mineruForZotero-api-require-token": requireToken,
    });

    try {
      setMarkdownApiEnabled(false);
      setMarkdownApiRequireToken(true);
      registerPreferenceValueSync(document);

      enabled.checked = true;
      enabled.emit("command");
      requireToken.checked = false;
      requireToken.emit("command");

      assert.isTrue(getMarkdownApiEnabled());
      assert.isFalse(getMarkdownApiRequireToken());
    } finally {
      setMarkdownApiEnabled(false);
      setMarkdownApiRequireToken(true);
    }
  });

  it("regenerates and replaces the markdown query API token from preferences", async function () {
    const regenerate = fakePreferenceElement("", "", "button");
    const status = fakePreferenceElement("", "", "span");
    const tokenInput = fakePreferenceElement("", "", "text");
    const document = fakePreferenceDocument({
      "mineruForZotero-api-regenerate-token": regenerate,
      "mineruForZotero-api-token-status": status,
      "mineruForZotero-api-token": tokenInput,
    });
    const _window = fakePreferenceWindow(document);

    try {
      setMarkdownApiToken("visible-token");
      const originalToken = getMarkdownApiToken();

      await registerPrefsScripts(_window);

      assert.equal(tokenInput.value, originalToken);

      regenerate.emit("click");

      const regeneratedToken = getMarkdownApiToken();
      assert.match(regeneratedToken, /^[A-Za-z0-9_-]{32,}$/);
      assert.notEqual(regeneratedToken, originalToken);
      assert.equal(tokenInput.value, regeneratedToken);
      assert.equal(status.textContent, "Token generated");
    } finally {
      setMarkdownApiToken("");
    }
  });

  it("persists local API timeout changes from the preferences UI immediately", function () {
    const timeout = fakePreferenceElement("45", "", "number");
    const document = fakePreferenceDocument({
      "zotero-prefpane-mineruForZotero-local-api-timeout-minutes": timeout,
    });

    try {
      setLocalApiTimeoutMinutes(30);
      registerPreferenceValueSync(document);

      timeout.value = "45";
      timeout.emit("change");

      assert.equal(getLocalApiTimeoutMinutes(), 45);
    } finally {
      setLocalApiTimeoutMinutes(30);
    }
  });
});

interface FakePreferenceElement {
  checked: boolean;
  name: string;
  textContent: string;
  type: string;
  value: string;
  addEventListener(type: string, listener: EventListener): void;
  emit(type: string): void;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

function fakePreferenceElement(
  value: string,
  name = "",
  type = "text",
): FakePreferenceElement {
  const listeners = new Map<string, EventListener[]>();
  const attributes = new Map<string, string>([
    ["type", type],
    ["value", value],
  ]);
  return {
    checked: value === "true",
    name,
    textContent: "",
    type,
    value,
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    emit(type) {
      for (const listener of listeners.get(type) ?? []) {
        listener({ type } as Event);
      }
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
      if (name === "value") {
        this.value = value;
      }
    },
  };
}

function fakePreferenceDocument(
  elements: Record<string, FakePreferenceElement>,
): Document {
  return {
    getElementById(id: string) {
      return elements[id] ?? null;
    },
    getElementsByName() {
      return [] as unknown as NodeListOf<Element>;
    },
  } as unknown as Document;
}

function fakePreferenceWindow(document: Document): Window {
  return {
    document: Object.assign(document, {
      l10n: {
        formatValue: async (id: string) => {
          if (id === "pref-query-api-token-ready") {
            return "Token generated";
          }
          if (id === "pref-query-api-token-empty") {
            return "No token generated";
          }
          if (id === "pref-data-folder-path") {
            return "Data folder: ProfD/mineru-copy";
          }
          if (id === "pref-parsed-count") {
            return "Parsed PDFs: 0";
          }
          return "Parsed PDFs: failed to read";
        },
      },
    }),
  } as unknown as Window;
}

function assertIncreasingIndexes(source: string, snippets: string[]): void {
  let previousIndex = -1;
  for (const snippet of snippets) {
    const index = source.indexOf(snippet);
    assert.isAtLeast(index, 0, `missing snippet: ${snippet}`);
    assert.isAbove(index, previousIndex, `out-of-order snippet: ${snippet}`);
    previousIndex = index;
  }
}

function assertAboutSectionInsideMainGroupbox(source: string): void {
  const aboutIndex = source.indexOf(
    'data-l10n-id="mineruForZotero-pref-about-title"',
  );
  const groupboxEndIndex = source.lastIndexOf("</groupbox>");
  assert.isAtLeast(aboutIndex, 0, "missing about section heading");
  assert.isAbove(
    groupboxEndIndex,
    aboutIndex,
    "about section is outside groupbox",
  );
}

function assertSectionHeadingLevels(source: string): void {
  for (const id of [
    "mineruForZotero-pref-api-service-title",
    "mineruForZotero-pref-data-storage-title",
    "mineruForZotero-pref-about-title",
  ]) {
    assert.include(source, `<html:h2 data-l10n-id="${id}"></html:h2>`);
  }
}

async function fetchPreferencePanelMarkup(): Promise<string> {
  return fetchText("chrome://mineruForZotero/content/preferences.xhtml");
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}
