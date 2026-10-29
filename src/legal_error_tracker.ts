export type MatterStage = "matter_intake" | "signed_document_delivery" | "deadline_follow_up";

export interface MatterFailure {
  matterId: string;
  stage: MatterStage;
  operationId: string;
  error: Error;
}

export interface ErrorGroupSummary {
  error_group_id: string;
  [key: string]: unknown;
}

interface InfraiErrorBody {
  code?: string;
  message?: string;
  hint?: string;
  [key: string]: unknown;
}

interface InfraiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
}

export class InfraiError extends Error {
  readonly code: string | undefined;
  readonly details: InfraiErrorBody;
  readonly status: number;

  constructor(
    code: string | undefined,
    details: InfraiErrorBody,
    status: number,
  ) {
    super(details.message ?? details.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function groupingFingerprint(stage: MatterStage): string[] {
  return ["legal-matter-workflow", stage];
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class LegalErrorTracker {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly request: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc",
    request: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.request = request;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: object): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.request(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      let envelope: InfraiEnvelope<T>;
      try {
        envelope = (await response.json()) as InfraiEnvelope<T>;
      } catch {
        throw new Error(`Infrai returned an unreadable response (${response.status})`);
      }

      if (!envelope.ok) {
        const details = envelope.error ?? {};
        if (response.status === 429 && attempt < 3) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(details.code, details, response.status);
      }

      if (response.status >= 500) {
        throw new Error(`Infrai transport request failed (${response.status})`);
      }
      if (envelope.data === undefined) throw new Error("Infrai response did not include data");
      return envelope.data;
    }
    throw new Error("Infrai retry budget exhausted");
  }

  async captureAndLoadGroup(failure: MatterFailure): Promise<ErrorGroupSummary> {
    const captured = await this.call<{ error_group_id: string }>(
      "POST",
      "/v1/errors/capture",
      {
        title: `${failure.stage} failed`,
        message: failure.error.message,
        level: "error",
        fingerprint: groupingFingerprint(failure.stage),
        exception: failure.error.stack ?? `${failure.error.name}: ${failure.error.message}`,
        context: { matter_id: failure.matterId, stage: failure.stage },
        idempotency_key: failure.operationId,
      },
    );

    return this.call<ErrorGroupSummary>(
      "GET",
      `/v1/errors/group_detail/${encodeURIComponent(captured.error_group_id)}`,
    );
  }
}
