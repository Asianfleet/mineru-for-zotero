import { assert } from "chai";
import {
  MinerURequestError,
  MinerUTaskFailedError,
  type MinerUClient,
} from "../src/modules/mineruClient";
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

  it("reports a task MinerU failed as a terminal failure with its message", async function () {
    const client: MinerUClient = {
      ...runningClient,
      pollTask: async () => ({
        status: "failed",
        error: "parsing failed, please try again later (code -60010)",
      }),
    };

    const error = await rejectionOf(
      waitForTask(client, "task-1", async () => {}, 60_000),
    );

    assert.instanceOf(error, MinerUTaskFailedError);
    assert.equal(
      (error as Error).message,
      "parsing failed, please try again later (code -60010)",
    );
  });

  it("polls a running task until the timeout is used up", async function () {
    let polls = 0;
    const client: MinerUClient = {
      ...runningClient,
      pollTask: async () => {
        polls += 1;
        return { status: "running" };
      },
    };

    const error = await rejectionOf(
      waitForTask(client, "task-1", async () => {}, 9_000),
    );

    assert.equal((error as Error).message, "MinerU task timed out");
    assert.equal(polls, 3);
  });

  it("charges reconnect delays in full against the timeout", async function () {
    let polls = 0;
    const waits: number[] = [];
    const client: MinerUClient = {
      ...runningClient,
      pollTask: async () => {
        polls += 1;
        throw new MinerURequestError("poll", 0, "connection reset");
      },
    };

    const error = await rejectionOf(
      waitForTask(
        client,
        "task-1",
        async (ms) => {
          waits.push(ms);
        },
        30_000,
        undefined,
        "online",
      ),
    );

    // 3 s + 6 s + 12 s + 24 s exceeds the 30 s budget after four attempts.
    assert.equal((error as Error).message, "MinerU task timed out");
    assert.deepEqual(waits, [3_000, 6_000, 12_000, 24_000]);
    assert.equal(polls, 4);
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
