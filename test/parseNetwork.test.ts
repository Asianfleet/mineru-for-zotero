import { assert } from "chai";
import type { MinerUClient } from "../src/modules/mineruClient";
import {
  downloadTaskResultWithRetry,
  MinerUTaskCancelledError,
  waitForTask,
} from "../src/modules/parseNetwork";

describe("parseNetwork", function () {
  const runningClient: MinerUClient = {
    submitPdf: async () => ({ taskID: "task-1" }),
    pollTask: async () => ({ status: "running" }),
    downloadResult: async () => ({ kind: "lite", markdown: "# Lite" }),
  };

  it("reports a cancelled poll as a cancellation, not a task failure", async function () {
    const error = await rejectionOf(
      waitForTask(
        runningClient,
        "task-1",
        async () => {},
        60_000,
        () => true,
      ),
    );

    assert.instanceOf(error, MinerUTaskCancelledError);
  });

  it("reports a cancelled download as a cancellation, not a task failure", async function () {
    const error = await rejectionOf(
      downloadTaskResultWithRetry(
        runningClient,
        "task-1",
        async () => {},
        60_000,
        "online",
        () => {},
        undefined,
        () => true,
      ),
    );

    assert.instanceOf(error, MinerUTaskCancelledError);
  });
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected the promise to reject");
}
