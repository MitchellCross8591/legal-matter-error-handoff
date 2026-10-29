import { createServer, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { InfraiError, LegalErrorTracker } from "./legal_error_tracker.ts";

const FailureBody = z.object({
  matterId: z.string().min(1),
  stage: z.enum(["matter_intake", "signed_document_delivery", "deadline_follow_up"]),
  operationId: z.string().min(1),
  error: z.object({
    name: z.string().min(1),
    message: z.string().min(1),
    stack: z.string().optional(),
  }),
}).strict();

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function createMatterIntakeService(tracker: LegalErrorTracker) {
  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/workflow-failures") {
      json(response, 404, { error: "Route not found" });
      return;
    }

    try {
      const input = FailureBody.parse(await readJson(request));
      const group = await tracker.captureAndLoadGroup({
        matterId: input.matterId,
        stage: input.stage,
        operationId: input.operationId,
        error: Object.assign(new Error(input.error.message), input.error),
      });
      json(response, 202, { status: "grouped", group });
    } catch (error) {
      if (error instanceof z.ZodError) {
        json(response, 400, { error: "Invalid request body", issues: error.issues });
        return;
      }
      if (error instanceof InfraiError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 502;
        json(response, status, { error: error.details, message: error.message });
        return;
      }
      json(response, 502, { error: "Error tracking request failed" });
    }
  });
}

async function main(): Promise<void> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
  const tracker = new LegalErrorTracker(apiKey);

  if (process.argv.includes("--example")) {
    const group = await tracker.captureAndLoadGroup({
      matterId: "matter-1042",
      stage: "signed_document_delivery",
      operationId: "matter-1042-signed-document-delivery-v1",
      error: new Error("Signed document delivery job could not reach its recipient"),
    });
    console.log(JSON.stringify({ status: "grouped", group }, null, 2));
    return;
  }

  const port = Number(process.env.PORT ?? "3000");
  createMatterIntakeService(tracker).listen(port, () => {
    console.log(`Matter workflow error service listening on http://localhost:${port}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
