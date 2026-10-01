import { assert } from "chai";
import {
  openExternalURL,
  registerPrefsScripts,
  registerPreferenceValueSync,
} from "../src/modules/preferenceScript";
import {
  getMarkdownApiEnabled,
  getLocalApiBaseURL,
  getLocalApiTimeoutMinutes,
  getParseTier,
  getParseSource,
  getSaveImages,
  getStatusTagsEnabled,
  setMarkdownApiEnabled,
  setLocalApiBaseURL,
  setLocalApiTimeoutMinutes,
  setParseTier,
  setParseSource,
  setSaveImages,
  setStatusTagsEnabled,
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
      'id="zotero-prefpane-mineruForZotero-parse-tier"',
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

  it("initializes and persists the status-tags checkbox", function () {
    const statusTags = fakePreferenceElement("true", "", "checkbox");
    const document = fakePreferenceDocument({
      "zotero-prefpane-mineruForZotero-status-tags": statusTags,
    });

    try {
      setStatusTagsEnabled(true);
      registerPreferenceValueSync(document);

      assert.isTrue(statusTags.checked);

      statusTags.checked = false;
      statusTags.emit("command");

      assert.isFalse(getStatusTagsEnabled());
    } finally {
      setStatusTagsEnabled(true);
    }
  });

  it("defaults parse source, parse tier, and local API URL", function () {
    assert.equal(getParseSource(), "online");
    assert.equal(getParseTier(), "standard");
    assert.equal(getLocalApiBaseURL(), "http://127.0.0.1:8000");
    assert.equal(getLocalApiTimeoutMinutes(), 30);
  });

  it("defaults the markdown query API to disabled", function () {
    assert.isFalse(getMarkdownApiEnabled());
  });

  it("round-trips parse source, parse tier, and local API URL", function () {
    try {
      setParseSource("local");
      setParseTier("advanced");
      setLocalApiBaseURL("http://127.0.0.1:9000/");
      setLocalApiTimeoutMinutes(45);

      assert.equal(getParseSource(), "local");
      assert.equal(getParseTier(), "advanced");
      assert.equal(getLocalApiBaseURL(), "http://127.0.0.1:9000/");
      assert.equal(getLocalApiTimeoutMinutes(), 45);
    } finally {
      setParseSource("online");
      setParseTier("standard");
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

  it("persists parse tier changes from the preferences UI immediately", function () {
    const parseTier = fakePreferenceElement("advanced");
    const document = fakePreferenceDocument({
      "zotero-prefpane-mineruForZotero-parse-tier": parseTier,
    });

    try {
      setParseTier("advanced");
      registerPreferenceValueSync(document);

      parseTier.value = "standard";
      parseTier.emit("change");

      assert.equal(getParseTier(), "standard");
    } finally {
      setParseTier("standard");
    }
  });

  it("persists parse source and tier changes from radiogroups immediately", function () {
    const parseSource = fakePreferenceElement("online", "", "radiogroup");
    const parseTier = fakePreferenceElement("standard", "", "radiogroup");
    const document = fakePreferenceDocument({
      "zotero-prefpane-mineruForZotero-parse-source": parseSource,
      "zotero-prefpane-mineruForZotero-parse-tier": parseTier,
    });

    try {
      setParseSource("online");
      setParseTier("standard");
      registerPreferenceValueSync(document);

      parseSource.value = "local";
      parseSource.emit("command");
      parseTier.value = "advanced";
      parseTier.emit("command");

      assert.equal(getParseSource(), "local");
      assert.equal(getParseTier(), "advanced");
    } finally {
      setParseSource("online");
      setParseTier("standard");
    }
  });

  it("shows local query API controls without a request example", async function () {
    const preferences = await fetchPreferencePanelMarkup();

    assertIncreasingIndexes(preferences, [
      'data-l10n-id="mineruForZotero-pref-query-api-title"',
      'id="zotero-prefpane-mineruForZotero-api-enabled"',
    ]);
    assert.notInclude(preferences, "mineruForZotero-api-require-token");
    assert.notInclude(preferences, "mineruForZotero-api-token");
    assert.notInclude(preferences, "mineruForZotero-api-regenerate-token");
    assert.notInclude(preferences, "Authorization: Bearer");
  });

  it("persists markdown query API checkbox changes immediately", function () {
    const enabled = fakePreferenceElement("false", "", "checkbox");
    const document = fakePreferenceDocument({
      "zotero-prefpane-mineruForZotero-api-enabled": enabled,
    });

    try {
      setMarkdownApiEnabled(false);
      registerPreferenceValueSync(document);

      enabled.checked = true;
      enabled.emit("command");

      assert.isTrue(getMarkdownApiEnabled());
    } finally {
      setMarkdownApiEnabled(false);
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
