/** Bound an operation without letting an obsolete completion continue a cancelled start. */
export function duringAttempt<T>(
  work: Promise<T>,
  signal: AbortSignal,
  timeoutMs = 45000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(new Error('Match start cancelled.'));
    const timer = setTimeout(() => finish(new Error('Race preparation timed out.')), timeoutMs);
    let settled = false;
    function finish(error?: unknown, value?: T) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value as T);
    }
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => finish(undefined, value),
      (error) => finish(error),
    );
    if (signal.aborted) abort();
  });
}
