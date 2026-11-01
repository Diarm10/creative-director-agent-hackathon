// Runs a list of jobs a couple at a time, and stops starting new ones when a job says a limit was hit.
export interface PoolOptions<T> {
  concurrency: number;
  /** Called with a job's result; return a message to stop the batch (nothing new starts, running jobs finish). */
  shouldStop?: (result: T) => string | null;
}

export interface PoolResult<T> {
  results: Array<T | undefined>; // in input order; undefined for a job that never started
  stopped: string | null; // why the batch stopped early, if it did
}

export async function runPool<I, T>(items: readonly I[], worker: (item: I, index: number) => Promise<T>, opts: PoolOptions<T>): Promise<PoolResult<T>> {
  const results: Array<T | undefined> = new Array(items.length).fill(undefined);
  let next = 0;
  let stopped: string | null = null;
  const lane = async () => {
    while (stopped === null && next < items.length) {
      const index = next++;
      const result = await worker(items[index], index);
      results[index] = result;
      const why = opts.shouldStop?.(result) ?? null;
      if (why && stopped === null) stopped = why;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, lane));
  return { results, stopped };
}
