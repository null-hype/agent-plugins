import { expect, type APIRequestContext } from '@playwright/test';
import { startDocumentApp } from './fixture-app.mjs';

async function readDocument(request: APIRequestContext, patched: boolean, actor: string) {
  const app = await startDocumentApp({ patched });
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

// Capture before assertions so a deterministic failure still leaves evidence.
export const collectors = {
  'reproduce-unauthorized-read': {
    collect: (request: APIRequestContext) => readDocument(request, false, 'alice'),
    verify: (state: any) => {
      expect(state.http.response.status).toBe(200);
      expect(state.http.request.actor).not.toBe(state.fixtureState.document.owner);
      expect(state.http.response.body).toEqual(state.fixtureState.document);
    },
  },
  'verify-unauthorized-read-denied': {
    collect: (request: APIRequestContext) => readDocument(request, true, 'alice'),
    verify: (state: any) => {
      expect(state.http.response.status).toBe(403);
      expect(state.http.response.body).toEqual({ error: 'Forbidden' });
      const before = Object.values(state.prerequisites)[0] as any;
      expect(state.http.request).toEqual(before.http.request);
      expect(state.fixtureState.document).toEqual(before.fixtureState.document);
    },
  },
  'verify-owner-read': {
    collect: (request: APIRequestContext) => readDocument(request, true, 'bob'),
    verify: (state: any) => {
      expect(state.http.response.status).toBe(200);
      expect(state.http.request.actor).toBe(state.fixtureState.document.owner);
      expect(state.http.response.body).toEqual(state.fixtureState.document);
      const denied = Object.values(state.prerequisites)[0] as any;
      expect(denied.http.response.status).toBe(403);
      expect(state.authorizationPolicy).toBe(denied.authorizationPolicy);
    },
  },
};
