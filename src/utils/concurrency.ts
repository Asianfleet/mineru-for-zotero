/**
 * Bounded FIFO gate for async work that is requested from many places.
 */
export interface ConcurrencyLimiter {
  /**
   * Wait until fewer than `limit` tasks hold a slot, run `task`, and free the
   * slot once it settles (fulfilled or rejected).
   */
  run<T>(task: () => Promise<T>, limit: number): Promise<T>;
}

/**
 * Create a limiter whose waiting tasks start in request order.
 *
 * The limit is passed on every call, so a changed setting applies to work
 * requested afterwards. A limit below one (or not a number) counts as one, so a
 * bad setting can never block every task.
 */
export function createConcurrencyLimiter(): ConcurrencyLimiter {
  let active = 0;
  const waiting: Array<{ limit: number; start: () => void }> = [];

  const startWaitingTasks = () => {
    while (waiting.length > 0 && active < waiting[0].limit) {
      const next = waiting.shift()!;
      active += 1;
      next.start();
    }
  };

  return {
    async run<T>(task: () => Promise<T>, limit: number): Promise<T> {
      await new Promise<void>((resolve) => {
        waiting.push({ limit: normalizeLimit(limit), start: resolve });
        startWaitingTasks();
      });
      try {
        return await task();
      } finally {
        active -= 1;
        startWaitingTasks();
      }
    },
  };
}

function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
}
