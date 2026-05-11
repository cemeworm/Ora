const fileMutationQueues = new Map<string, Promise<unknown>>();

export async function withWorkspaceFileMutationQueue<T>(absolutePath: string, fn: () => T | Promise<T>): Promise<T> {
  const previous = fileMutationQueues.get(absolutePath);
  const running = previous
    ? previous.catch(() => undefined).then(fn)
    : Promise.resolve(fn());
  const queued = running.catch(() => undefined);
  fileMutationQueues.set(absolutePath, queued);
  try {
    return await running;
  } finally {
    if (fileMutationQueues.get(absolutePath) === queued) {
      fileMutationQueues.delete(absolutePath);
    }
  }
}
