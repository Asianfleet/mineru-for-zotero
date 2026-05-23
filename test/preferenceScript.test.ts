import { assert } from "chai";
import {
  openExternalURL,
  registerPreferenceValueSync,
} from "../src/modules/preferenceScript";
import {
  getLocalApiBaseURL,
  getParseMode,
  getParseSource,
  getSaveImages,
  setLocalApiBaseURL,
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
  });

  it("round-trips parse source, parse mode, and local API URL", function () {
    try {
      setParseSource("local");
      setParseMode("lite");
      setLocalApiBaseURL("http://127.0.0.1:9000/");

      assert.equal(getParseSource(), "local");
      assert.equal(getParseMode(), "lite");
      assert.equal(getLocalApiBaseURL(), "http://127.0.0.1:9000/");
    } finally {
      setParseSource("online");
      setParseMode("precise");
      setLocalApiBaseURL("http://127.0.0.1:8000");
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
});

interface FakePreferenceElement {
  checked: boolean;
  name: string;
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
