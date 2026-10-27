import { test, expect } from '../ask';
import { readDocument, verifyRead } from '../collectors';

// Each test is a Question, asked of every revision that report-expected.pcf
// names it for. The test gathers the evidence; `ask` records it and puts the
// Question to Jev. The expected range is in the contract, never here.

test("Can Alice read Bob's private document?", async ({ request, revision, prerequisites, ask }) => {
  const state = { ...(await readDocument(request, revision, 'alice')), prerequisites };
  verifyRead(state, 'alice', expect);
  await ask(state);
});

test('Can Bob read it?', async ({ request, revision, prerequisites, ask }) => {
  const state = { ...(await readDocument(request, revision, 'bob')), prerequisites };
  verifyRead(state, 'bob', expect);
  await ask(state);
});
