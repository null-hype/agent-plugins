const { createServer } = require('node:http');
const { readFile, writeFile } = require('node:fs/promises');
const { resolve, extname, sep } = require('node:path');
const root = process.cwd();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf' };
createServer(async (request, response) => {
 try {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/state') {
   const file = resolve(root, 'workbench.json');
   if (request.method === 'PUT') {
    let body = '';
    for await (const chunk of request) { body += chunk; if (body.length > 1000000) throw new Error('State too large'); }
    const state = JSON.parse(body);
    if (!state.lesson || typeof state.lesson.text !== 'string') throw new Error('Invalid workbench state');
    await writeFile(file, body);
   }
   response.setHeader('Content-Type', 'application/json');
   response.end(await readFile(file));
   return;
  }
  const base = resolve(root, url.pathname.startsWith('/monaco/') ? 'node_modules/monaco-editor/min' : 'public');
  const relative = url.pathname.startsWith('/monaco/') ? url.pathname.slice('/monaco/'.length) : url.pathname.slice(1) || 'index.html';
  const file = resolve(base, relative);
  if (!file.startsWith(base + sep)) { response.writeHead(403); response.end(); return; }
  response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  response.end(await readFile(file));
 } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 400); response.end(String(error.message)); }
}).listen(4173, '0.0.0.0', () => console.log('Follower Maze listening on 4173'));
