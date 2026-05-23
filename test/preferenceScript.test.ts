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
