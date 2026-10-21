/**
 * [INPUT]: 依赖site-manifest、docs的85静态文件及父级高清页80原文件元数据；使用Node本机HTTP与流式SHA
 * [OUTPUT]: 生成site-verification.json，核验85个HTTP响应/原字节SHA、站内引用、公开字段和GitHub Pages项目子路径
 * [POS]: 独立静态包的发布前验收器，只监听临时loopback端口并自动关闭，不发起外部发布或模型调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url)), output = join(directory, 'docs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(join(directory, 'site-manifest.json')));
assert.equal(manifest.samples, 20); assert.equal(manifest.actualImages, 80); assert.equal(manifest.staticFiles, 85); assert.equal(manifest.imagesReencoded, 0);
const fileMap = new Map(manifest.files.map(file => [file.path, file]));
async function walk(base, prefix = '') {
  const entries = await readdir(join(base, prefix), { withFileTypes: true }); let files = [];
  for (const entry of entries) { const path = prefix ? prefix + '/' + entry.name : entry.name; files.push(...(entry.isDirectory() ? await walk(base, path) : [path])); }
  return files;
}
assert.deepEqual((await walk(output)).sort(), [...fileMap.keys()].sort(), '部署目录文件与清单不一致');
const html = await readFile(join(output, 'index.html'), 'utf8'), js = await readFile(join(output, 'hd-viewer.js'), 'utf8'), css = await readFile(join(output, 'hd-viewer.css'), 'utf8');
const payload = JSON.parse(html.match(/<script type="application\/json" id="viewerData">([\s\S]*?)<\/script>/)[1]);
assert.deepEqual(Object.keys(payload).sort(), ['samples', 'version']);
const sourceHtml = await readFile(resolve(directory, '../高清原图对比.html'), 'utf8');
const source = JSON.parse(sourceHtml.match(/<script type="application\/json" id="viewerData">([\s\S]*?)<\/script>/)[1]);
let actualSourceCopiesVerified = 0;
for (const sample of payload.samples) {
  const original = source.samples.find(item => item.testId === sample.testId); assert.ok(original);
  assert.deepEqual(Object.keys(sample.original).sort(), ['height', 'width']);
  for (const [key, image] of Object.entries(sample.images)) {
    const file = fileMap.get(image.file); assert.ok(file);
    assert.equal(file.sha256, original.images[key].sha256); assert.equal(image.sha256, file.sha256);
    assert.deepEqual([image.width, image.height, image.format, image.bytes], [file.width, file.height, file.format, file.bytes]);
    const bytes = await readFile(resolve(directory, '..', original.images[key].file));
    assert.equal(digest(bytes), file.sha256, '源文件发生变化'); actualSourceCopiesVerified++;
    assert.deepEqual(Object.keys(image).sort(), ['bytes', 'file', 'format', 'height', 'inputLabel', 'sha256', 'width']);
    assert.match(image.file, /^SR\d{2}\/(?:original|jzxz|ks|ks-direct)\.(?:jpg|png|webp)$/);
  }
}
assert.equal(actualSourceCopiesVerified, 80);
for (const text of [html, js, css, await readFile(join(directory, 'README.md'), 'utf8')]) {
  assert.ok(!/feishu|larksuite|qunhequnhe|cf\.qunhe|file:\/\/|\/Users\/|127\.0\.0\.1|localhost|4186|app_token|access_token|refresh_token|tenant_access/i.test(text), '公开内容含内部路径或链接');
  assert.ok(!/(?:href|src)="(?:\.\.\/|https?:|\/)/.test(text), '网站有绝对或站外依赖');
}
assert.ok(html.includes('noindex,nofollow,noarchive')); assert.equal(await readFile(join(output, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
assert.equal((await stat(join(output, '.nojekyll'))).size, 0); new Function(js);
for (const match of html.matchAll(/(?:href|src)="([^\"]+)"/g)) if (!match[1].startsWith('#')) assert.ok(fileMap.has(match[1]), 'HTML依赖不存在');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };
const prefix = '/github-pages-project/';
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://test.invalid').pathname);
  const path = pathname.startsWith(prefix) ? pathname.slice(prefix.length) || 'index.html' : '';
  const file = fileMap.get(path);
  if (!file) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Length': file.bytes });
  createReadStream(join(output, path)).pipe(response);
});
let staticRequestsVerified = 0, transferredBytes = 0;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port + prefix, queue = [...manifest.files];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (;;) {
      const file = queue.pop(); if (!file) return;
      const response = await fetch(new URL(file.path, base)); assert.equal(response.status, 200, file.path + 'HTTP状态');
      assert.equal(Number(response.headers.get('content-length')), file.bytes);
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of response.body) { hash.update(chunk); bytes += chunk.length; }
      assert.equal(bytes, file.bytes); assert.equal(hash.digest('hex'), file.sha256, file.path + 'HTTP字节SHA');
      staticRequestsVerified++; transferredBytes += bytes;
    }
  }));
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
assert.equal(staticRequestsVerified, 85); assert.equal(transferredBytes, manifest.totalBytes);
const map = await readFile(join(directory, 'CLAUDE.md'), 'utf8');
for (const file of manifest.files) assert.ok(map.includes('docs/' + file.path), 'L2遗漏网站文件');
const verification = { checkedAt: new Date().toISOString(), published: false, staticRequestsVerified, actualSourceCopiesVerified,
  transferredBytes, projectBasePathVerified: true, publicPayloadWhitelistVerified: true, noInternalLinksOrTokensFound: true,
  imageReencoding: false, largestFile: manifest.largestFile, manifestSha256: digest(await readFile(join(directory, 'site-manifest.json'))),
  scope: '独立静态目录与本机HTTP验收；线上URL及GitHub Pages部署由发布后回读证明' };
await writeFile(join(directory, 'site-verification.json'), JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify(verification, null, 2));
