export const MAX_REQUEST_BYTES = 32 * 1024;

export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) {
    super(message);
  }
}

export function createLocalLimiter(now: () => number = Date.now) {
  let count = 0;
  let resetAt = 0;
  return (limit: number, windowMs: number) => {
    const time = now();
    if (time >= resetAt) {
      count = 0;
      resetAt = time + windowMs;
    }
    if (count >= limit) {
      throw new RequestError("Too many requests; try again shortly", 429, Math.max(1, Math.ceil((resetAt - time) / 1000)));
    }
    count++;
  };
}

const localLimiter = createLocalLimiter();

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RequestError("The assistant request protection is not configured correctly", 503);
  }
  return parsed;
}

export function enforceRequestLimit(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === "production") {
    if (env.ASK_EXTERNAL_RATE_LIMIT_ENABLED !== "true") {
      throw new RequestError("The assistant is unavailable until request protection is configured", 503);
    }
    return;
  }
  localLimiter(
    positiveInteger(env.ASK_LOCAL_RATE_LIMIT, 10),
    positiveInteger(env.ASK_LOCAL_RATE_WINDOW_MS, 60000)
  );
}

export async function readRequestJSON(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    throw new RequestError("Request body is too large", 413);
  }
  if (!request.body) throw new RequestError("Request body must be valid JSON", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        throw new RequestError("Request body is too large", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("Request body must be valid JSON", 400);
  } finally {
    reader.releaseLock();
  }
}
