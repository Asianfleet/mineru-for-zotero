import { assert } from "chai";
import { createConcurrencyLimiter } from "../src/utils/concurrency";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("concurrency", function () {
  it("runs a task right away while below the limit", async function () {
    const limiter = createConcurrencyLimiter();

    assert.equal(await limiter.run(async () => "done", 2), "done");
  });

  it("limits active tasks and starts waiting tasks in request order", async function () {
    const limiter = createConcurrencyLimiter();
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    const deferreds: Array<() => void> = [];
    const runs = [0, 1, 2, 3, 4].map((index) =>
      limiter.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        events.push(`start-${index}`);
        await new Promise<void>((resolve) => deferreds.push(resolve));
        events.push(`end-${index}`);
        active -= 1;
      }, 2),
    );
    await flush();

    assert.equal(maxActive, 2);
    assert.deepEqual(events, ["start-0", "start-1"]);

    deferreds.shift()?.();
    await flush();
    assert.deepEqual(events, ["start-0", "start-1", "end-0", "start-2"]);

    while (deferreds.length > 0) {
      deferreds.shift()?.();
      await flush();
    }
    await Promise.all(runs);

    assert.equal(active, 0);
    assert.equal(maxActive, 2);
    assert.equal(events.filter((event) => event.startsWith("end-")).length, 5);
  });

  it("shares one limit between independent callers", async function () {
    const limiter = createConcurrencyLimiter();
    let active = 0;
    let maxActive = 0;
    const work = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await flush();
      active -= 1;
    };

    // Two unrelated entry points, as when a batch and a retry overlap.
    await Promise.all([
      limiter.run(work, 1),
      limiter.run(work, 1),
      limiter.run(work, 1),
    ]);

    assert.equal(maxActive, 1);
  });

  it("frees the slot when a task fails", async function () {
    const limiter = createConcurrencyLimiter();
    const failing = limiter.run(async () => {
      throw new Error("boom");
    }, 1);
    const next = limiter.run(async () => "next", 1);

    let error: unknown;
    try {
      await failing;
    } catch (caught) {
      error = caught;
    }
    assert.instanceOf(error, Error);
    assert.equal((error as Error).message, "boom");
    assert.equal(await next, "next");
  });

  it("treats a limit below one as one instead of blocking", async function () {
    const limiter = createConcurrencyLimiter();

    assert.equal(await limiter.run(async () => "zero", 0), "zero");
    assert.equal(await limiter.run(async () => "nan", Number.NaN), "nan");
  });
});
