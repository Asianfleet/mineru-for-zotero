import { assert } from "chai";
import {
  getTaskStoreFilePath,
  taskStore,
  type TaskRecord,
} from "../src/modules/taskStore";

describe("taskStore", function () {
  afterEach(async function () {
    await taskStore.clearHistory();
  });

  it("keeps notifying and saving when a listener throws", async function () {
    await taskStore.waitUntilLoaded();
    const notified: string[] = [];
    const unsubscribeBroken = taskStore.subscribe(() => {
      throw new Error("listener of a closed window");
    });
    const unsubscribeLive = taskStore.subscribe(() => {
      notified.push("live");
    });

    try {
      await taskStore.upsertTask(taskRecord("7301"));
      await taskStore.updateTaskStatus("7301", "failed", "network error");
      await taskStore.waitForPersistence();
    } finally {
      unsubscribeBroken();
      unsubscribeLive();
    }

    assert.equal(taskStore.getTask("7301")?.status, "failed");
    assert.lengthOf(notified, 2);
    const saved = JSON.parse(
      await IOUtils.readUTF8(getTaskStoreFilePath()),
    ) as TaskRecord[];
    assert.equal(saved.find((task) => task.id === "7301")?.status, "failed");
  });

  it("stops notifying a listener after it unsubscribes", async function () {
    await taskStore.waitUntilLoaded();
    let calls = 0;
    const unsubscribe = taskStore.subscribe(() => {
      calls += 1;
    });

    await taskStore.upsertTask(taskRecord("7302"));
    unsubscribe();
    await taskStore.updateTaskStatus("7302", "succeeded");

    assert.equal(calls, 1);
  });
});

function taskRecord(id: string): TaskRecord {
  return {
    id,
    attachment: {
      id: Number(id),
      key: `TASK${id}`,
      libraryID: 1,
      fileName: "a.pdf",
      filePath: "/tmp/a.pdf",
      mtime: 1,
    },
    title: "Task store test",
    status: "running",
    progress: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
