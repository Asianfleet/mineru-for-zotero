import { assert } from "chai";
import { joinNativePath, toNativePath } from "../src/modules/mineruClient/path";
import { getTaskResumeDirectory } from "../src/modules/taskResumeDirectory";
import { getTaskStoreFilePath } from "../src/modules/taskStore";

describe("native paths", function () {
  it("rewrites forward slashes appended to a native Windows path", function () {
    // Gecko's IOUtils rejects any Windows path that contains a "/".
    assert.equal(
      toNativePath("C:\\Users\\me\\Zotero/mineru-resume/42"),
      "C:\\Users\\me\\Zotero\\mineru-resume\\42",
    );
  });

  it("converts forward-slash drive paths", function () {
    assert.equal(toNativePath("C:/tmp/a.pdf"), "C:\\tmp\\a.pdf");
  });

  it("normalizes UNC paths with mixed separators", function () {
    assert.equal(
      toNativePath("\\\\server\\share\\Zotero/mineru_tasks.json"),
      "\\\\server\\share\\Zotero\\mineru_tasks.json",
    );
  });

  it("leaves POSIX paths unchanged", function () {
    assert.equal(
      toNativePath("/home/me/Zotero/mineru-resume/42"),
      "/home/me/Zotero/mineru-resume/42",
    );
  });

  it("decodes file URLs into native Windows paths", function () {
    assert.equal(
      toNativePath("file:///D:/Workspace/zotero%20plugin/a.pdf"),
      "D:\\Workspace\\zotero plugin\\a.pdf",
    );
  });

  it("joins segments onto a native Windows base without forward slashes", function () {
    assert.equal(
      joinNativePath("C:\\Users\\me\\Zotero", "mineru-resume", "42"),
      "C:\\Users\\me\\Zotero\\mineru-resume\\42",
    );
  });

  it("drops trailing separators from a user-entered base folder", function () {
    assert.equal(
      joinNativePath("D:\\Sync\\", "[2020] - Title"),
      "D:\\Sync\\[2020] - Title",
    );
    assert.equal(
      joinNativePath("/home/me/Sync/", "_index.json"),
      "/home/me/Sync/_index.json",
    );
    assert.equal(joinNativePath("D:\\Sync\\"), "D:\\Sync");
  });

  it("joins onto a POSIX root without doubling the separator", function () {
    assert.equal(joinNativePath("/", "Sync"), "/Sync");
  });

  it("places the resume cache under a Windows data directory", function () {
    assert.equal(
      getTaskResumeDirectory(42, "C:\\Users\\me\\Zotero"),
      "C:\\Users\\me\\Zotero\\mineru-resume\\42",
    );
  });

  it("places the task list under a Windows data directory", function () {
    assert.equal(
      getTaskStoreFilePath("C:\\Users\\me\\Zotero"),
      "C:\\Users\\me\\Zotero\\mineru_tasks.json",
    );
  });

  it("keeps POSIX data directory paths", function () {
    assert.equal(
      getTaskResumeDirectory(7, "/home/me/Zotero"),
      "/home/me/Zotero/mineru-resume/7",
    );
    assert.equal(
      getTaskStoreFilePath("/home/me/Zotero/"),
      "/home/me/Zotero/mineru_tasks.json",
    );
  });
});
