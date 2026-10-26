// ローカル動作確認用: 静的配信 + API(Blobsはメモリ上のダミー)。 node test/serve.mjs
import { register } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
register('./hooks.mjs', import.meta.url);
process.env.APP_PASSWORD ||= 'pw';
const { default: handler } = await import('../netlify/functions/api.mjs');
const root = path.resolve(import.meta.dirname, '../public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const port = process.env.PORT || 8890;
http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handler(new Request('http://localhost:' + port + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const f = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('http://localhost:' + port));
