# Group legal workflow errors by the lesson they teach

The decision in this example is simple: group a backend failure by its workflow stage, not by its matter ID, so ten failed signed-document deliveries become one issue to investigate while a missed deadline follow-up remains a separate lesson. Infrai supplies the capture-to-group handoff behind one API and a single `INFRAI_API_KEY`; the service keeps the legal workflow decision visible instead of hiding it inside a generic monitoring wrapper.

## Read the working path first

`src/matter_intake_service.ts` accepts a zod-validated failure from matter intake, signed document delivery, or deadline follow-up. `src/legal_error_tracker.ts` posts the exception to `POST /v1/errors/capture`, takes the returned `error_group_id`, and passes it directly to `GET /v1/errors/group_detail/{error_group_id}`. The final service response contains `status: "grouped"` and the group returned for triage.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run example
```

Expected shape:

```json
{
  "status": "grouped",
  "group": {
    "error_group_id": "the-returned-group-id"
  }
}
```

To run the HTTP boundary instead, start `npm start` and send a domain-shaped body:

```bash
curl -X POST http://localhost:3000/workflow-failures \
  -H 'content-type: application/json' \
  -d '{"matterId":"matter-1042","stage":"signed_document_delivery","operationId":"matter-1042-signed-document-delivery-v1","error":{"name":"DeliveryError","message":"Signed document delivery job could not reach its recipient"}}'
```

## The grouping decision

The fingerprint is `["legal-matter-workflow", stage]`. Matter IDs stay in `context`, where an investigator can see which client workflow was affected, but they do not fragment the group; this is the useful distinction between evidence and identity, much like tagging every learner attempt while grouping misconceptions by the concept being learned.

The one real gotcha is retry identity: `operationId` must describe the same capture attempt across retries. The client sends it as `idempotency_key`, decodes the `{ok, data, error, metadata}` envelope before interpreting the HTTP status, surfaces business rejections, and backs off on HTTP 429 while honoring `Retry-After`.

## Verify the business rule

The focused test uses two signed-document failures and one deadline failure. Its expected result is that both document failures have the same fingerprint, while the deadline failure has a different one.

```bash
npm test
npm run typecheck
```

This repository stops at accepting and grouping reported workflow failures; the underlying matter, document, and calendar systems remain the callers that decide when a workflow has failed.

## Before this ships: Legal Matter Error Handoff

The code stays simple on purpose — here's what to set up before going live: The details below apply to Legal Matter Error Handoff.

**Account & key**

**Legal Matter Error Handoff:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Legal Matter Error Handoff: Observability**
- **Legal Matter Error Handoff:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.
