import assert from "node:assert/strict";
import test from "node:test";
import { groupingFingerprint } from "../src/legal_error_tracker.ts";

test("groups the same workflow lesson across matters but separates stages", () => {
  const firstMatter = groupingFingerprint("signed_document_delivery");
  const secondMatter = groupingFingerprint("signed_document_delivery");
  const deadline = groupingFingerprint("deadline_follow_up");

  assert.deepEqual(firstMatter, secondMatter);
  assert.notDeepEqual(firstMatter, deadline);
  assert.deepEqual(firstMatter, ["legal-matter-workflow", "signed_document_delivery"]);
});
