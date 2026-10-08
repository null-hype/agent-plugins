import type { APIRequestContext, Expect } from '@playwright/test';
import { startDocumentApp } from './fixture-app.mjs';

async function readDocument(request: APIRequestContext, revision: string, actor: string) {
  if (!['baseline', 'patched'].includes(revision)) throw new Error(`Unknown revision: ${revision}`);
  const app = await startDocumentApp({ patched: revision === 'patched' });
  try {
    const response = await request.get(`${app.url}/documents/bob-private`, {
      headers: { cookie: `session=${actor}-fixture-session` },
    });
    return {
      revision: app.revision,
      authorizationPolicy: app.authorizationPolicy,
      fixtureState: app.fixtureState,
      http: { request: { method: 'GET', path: '/documents/bob-private', actor },
        response: { status: response.status(), body: await response.json() } },
    };
  } finally {
    await app.close();
  }
}

// CIT-328: one collector per reader, asked of the revision its Question names.
// `verify` checks the evidence was collected as asked, never what it answers:
// whether the reader got the document is Jev's to judge, and an answer outside
// its range is data. It takes the caller's `expect`: tutorial-app runs these
// collectors under its own Playwright, which refuses a second copy loaded from here.
const reader = (actor: string) => ({
  collect: (request: APIRequestContext, question: { revision: string }) => readDocument(request, question.revision, actor),
  verify: (state: any, expect: Expect<{}>) => {
    expect(state.http.request.actor).toBe(actor);
    expect([200, 403]).toContain(state.http.response.status);
    expect(state.http.response.body).toEqual(state.http.response.status === 200 ? state.fixtureState.document : { error: 'Forbidden' });
    // A later revision is asked the same request, of the same document, as its prerequisite.
    for (const before of Object.values(state.prerequisites ?? {}) as any[]) {
      expect(state.http.request).toEqual(before.http.request);
      expect(state.fixtureState.document).toEqual(before.fixtureState.document);
    }
  },
});

export const collectors = {
  'read-as-alice': reader('alice'),
  'read-as-bob': reader('bob'),
};
