import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// What the editor shows on a file: starts witness (on PATH) as an editor would,
// opens the file, and prints the diagnostics witness publishes for it, as JSON.
//
//   node delivery/diagnostics.mjs delivery/feature.spec.ts
const file = path.resolve(process.argv[2]);
const uri = pathToFileURL(file).href;
const lsp = spawn('witness', [], { stdio: ['pipe', 'pipe', 'inherit'] });
const send = (m) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...m });
  lsp.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};

let buf = Buffer.alloc(0);
lsp.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const head = buf.indexOf('\r\n\r\n');
    if (head < 0) return;
    const n = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, head).toString())[1]);
    if (buf.length < head + 4 + n) return;
    const m = JSON.parse(buf.subarray(head + 4, head + 4 + n).toString());
    buf = buf.subarray(head + 4 + n);
    if (m.id === 1) {
      send({ method: 'initialized', params: {} });
      send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescript', version: 1, text: readFileSync(file, 'utf8') } } });
    } else if (m.method === 'textDocument/publishDiagnostics' && m.params.uri === uri) {
      console.log(JSON.stringify(m.params.diagnostics, null, 2));
      lsp.kill();
      process.exit(0);
    }
  }
});
lsp.on('exit', (code) => { console.error(`witness exited (${code}) before publishing ${file}`); process.exit(1); });
send({ id: 1, method: 'initialize', params: { processId: process.pid, rootUri: null, capabilities: {} } });
setTimeout(() => { console.error(`witness published nothing for ${file}`); process.exit(1); }, 10_000);
