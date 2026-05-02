export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Many SDK calls don't accept AbortSignal; we still avoid awaiting forever by racing a timer.
    const timeout = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("TIMEOUT")));
    });
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(id);
  }
}

