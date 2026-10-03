import { createServer } from 'node:http';

// Synthetic accounts and data, served only on an ephemeral loopback port.
const document = { id: 'bob-private', owner: 'bob', content: "Bob's synthetic private notes" };
const sessions = new Map([['alice-fixture-session', 'alice'], ['bob-fixture-session', 'bob']]);
const allowAnySignedIn = (_user, _document) => true;
const ownerOnly = (user, document) => document.owner === user;

export async function startDocumentApp({ patched }) {
  const authorize = patched ? ownerOnly : allowAnySignedIn;
  const server = createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET' || req.url !== '/documents/bob-private') {
      return send(404, { error: 'Not found' });
    }
    // Pre-authenticated synthetic sessions; authentication is not under test.
    const token = req.headers.cookie?.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
    const user = sessions.get(token);
    if (!user) return send(401, { error: 'Unauthenticated' });
    if (!authorize(user, document)) return send(403, { error: 'Forbidden' });
    send(200, document);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    revision: patched ? 'patched' : 'baseline',
    authorizationPolicy: authorize.toString(),
    fixtureState: { document, accounts: ['alice', 'bob'] },
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
