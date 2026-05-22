import { assert } from "chai";
import { openExternalURL } from "../src/modules/preferenceScript";
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
});
