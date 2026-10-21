/**
 * [INPUT]: 依赖父级高清原图对比.html中80份已核验原文件引用及独立JS/CSS；仅使用Node内置文件/路径/SHA能力
 * [OUTPUT]: 生成GitHub Pages docs静态站与site-manifest，80图片逐字节复制，公开数据只含查看器必要字段
 * [POS]: 独立静态部署包的本地构建器；不改源查看器/模型产物，不调用外部API、不创建仓库或发布
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url)), sourceDirectory = resolve(directory, '..'), output = join(directory, 'docs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHtml = await readFile(join(sourceDirectory, '高清原图对比.html'), 'utf8');
const sourceData = JSON.parse(sourceHtml.match(/<script type="application\/json" id="viewerData">([\s\S]*?)<\/script>/)[1]);
assert.equal(sourceData.samples.length, 20);
await mkdir(output, { recursive: true });
const files = [], samples = [], keyNames = { original: 'original', jzxz: 'jzxz', ks: 'ks', ksDirect: 'ks-direct' };
const extensions = { jpeg: 'jpg', png: 'png', webp: 'webp' };
async function save(file, bytes, metadata = {}) {
  await writeFile(join(output, file), bytes);
  const actual = await readFile(join(output, file)); assert.equal(digest(actual), digest(bytes));
  files.push({ path: file, bytes: actual.length, sha256: digest(actual), ...metadata });
}
for (const sample of sourceData.samples) {
  assert.match(sample.testId, /^SR\d{2}$/);
  await mkdir(join(output, sample.testId), { recursive: true });
  const images = {};
  for (const [key, fileName] of Object.entries(keyNames)) {
    const source = sample.images[key]; assert.ok(extensions[source.format], '只接受真实JPEG/PNG/WebP');
    const sourceBytes = await readFile(resolve(sourceDirectory, source.file));
    assert.equal(digest(sourceBytes), source.sha256, sample.testId + '源SHA不符'); assert.equal(sourceBytes.length, source.bytes);
    const path = sample.testId + '/' + fileName + '.' + extensions[source.format];
    await copyFile(resolve(sourceDirectory, source.file), join(output, path));
    const copied = await readFile(join(output, path)); assert.equal(digest(copied), source.sha256, path + '复制字节不符');
    files.push({ path, bytes: copied.length, sha256: source.sha256, testId: sample.testId, model: key, width: source.width, height: source.height, format: source.format });
    images[key] = { file: path, width: source.width, height: source.height, format: source.format, bytes: source.bytes, sha256: source.sha256,
      inputLabel: source.inputLabel.replace('本地原件', '本次实测原件') };
  }
  samples.push({ testId: sample.testId, title: sample.title, original: { width: sample.original.width, height: sample.original.height }, images,
    adaptationWarning: sample.adaptationWarning, rois: sample.rois.map(({ id, label, left, top, width, height }) => ({ id, label, left, top, width, height })) });
}
const payload = JSON.stringify({ version: 1, samples }).replace(/</g, '\\u003c');
let html = sourceHtml.replace(/<script type="application\/json" id="viewerData">[\s\S]*?<\/script>/, '<script type="application/json" id="viewerData">' + payload + '</script>');
html = html.replace('<meta name="color-scheme" content="light">', '<meta name="color-scheme" content="light"><meta name="robots" content="noindex,nofollow,noarchive">');
html = html.replace('<a href="三方超分对照.html">返回评测报告</a>', '<a href="#viewerHelp">查看说明</a>');
html = html.replace('<details><summary>查看说明与尺度边界</summary>', '<details id="viewerHelp"><summary>查看说明与尺度边界</summary>');
html = html.replace('移动本HTML时须保留相对目录，或通过4186本地静态服务打开。', '图片均从本静态站的实际原文件读取，可直接打开或下载。');
html = html.replace('build-hd-viewer.mjs生成，依赖同目录CSS/JS', '独立静态查看器，依赖同目录CSS/JS');
await save('index.html', Buffer.from(html), { kind: 'html' });
const js = (await readFile(join(sourceDirectory, 'hd-viewer.js'), 'utf8')).replace('本地文件或4186服务', '网络连接或原文件访问权限')
  .replace("pane.download.download = item.file.split('/').pop();", "pane.download.download = state.sample.testId + '-' + item.file.split('/').pop();");
await save('hd-viewer.js', Buffer.from(js), { kind: 'javascript' });
await save('hd-viewer.css', await readFile(join(sourceDirectory, 'hd-viewer.css')), { kind: 'css' });
await save('robots.txt', Buffer.from('User-agent: *\nDisallow: /\n'), { kind: 'robots' });
await save('.nojekyll', Buffer.alloc(0), { kind: 'pages-control' });
assert.equal(files.length, 85);
for (const text of [html, js, await readFile(join(output, 'hd-viewer.css'), 'utf8')]) {
  assert.ok(!/feishu|larksuite|qunhequnhe|cf\.qunhe|file:\/\/|\/Users\/|127\.0\.0\.1|localhost|4186|app_token|access_token|refresh_token|tenant_access/i.test(text), '公开站残留内部路径或链接');
  assert.ok(!/(?:href|src)="\.\.\//.test(text), '网站依赖站外本机路径');
}
const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
const imageFiles = files.filter(file => file.testId), largestFile = imageFiles.reduce((best, file) => !best || file.bytes > best.bytes ? file : best, null);
const manifest = { schemaVersion: 1, builtAt: new Date().toISOString(), outputDirectory: 'docs', deployment: 'GitHub Pages main:/docs',
  samples: samples.length, actualImages: imageFiles.length, staticFiles: files.length, imagesReencoded: 0,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), imageBytes: imageFiles.reduce((sum, file) => sum + file.bytes, 0), largestFile, files: sorted };
assert.ok(largestFile.bytes < 100 * 1024 * 1024, '存在超过GitHub普通Git文件上限的原件');
await writeFile(join(directory, 'site-manifest.json'), '{\n' + Object.entries(manifest).filter(([key]) => key !== 'files').map(([key, value]) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(value)).join(',\n') + ',\n  "files": [\n' + sorted.map(file => '    ' + JSON.stringify(file)).join(',\n') + '\n  ]\n}\n');
await writeFile(join(directory, 'README.md'), '# 20图高清超分对比\n\n直接查看20张原图与建筑学长、KS、KS直入各20份实际输出。全部80图片按原始字节保存，不截图、不缩图、不转码。\n\n## 使用\n\nGitHub Pages发布源选择 `main` 分支的 `/docs`。进入主页后选择样本，在四路、隐藏原图或任意两路之间切换；鼠标滚轮缩放，拖动平移，或点击100%查看各自原生像素。\n\n- 同视野模式按同一原图坐标同步，各路显示比例不同。\n- 原生像素100%为1个文件像素对应1个CSS像素，仅同步中心位置，各路可见视野不同。\n- 两张边界样本的KS使用尺寸适配副本，页面明确提示。\n- 本次没有独立高清真值，锐度或纹理增多不等于真实恢复。\n- 图片只按当前样本的可见路加载。打开、下载均指向相应实际原文件。\n\n## 文件\n\n`docs/index.html`、独立JS/CSS、80原始图片、robots与.nojekyll，共' + files.length + '个网站文件。总计' + manifest.totalBytes + '字节；最大文件为`' + largestFile.path + '`，' + largestFile.bytes + '字节。详细SHA与尺寸见`site-manifest.json`。\n\n网站只保留查看器需要的样本、尺寸与定位数据，不包含内部系统链接或访问令牌。robots和页面meta请求搜索引擎不索引。\n\n构建与本机验收不代表已发布；线上可访问性由部署后的实际回读确认。\n');
const map = '# online-site/\n> L2 | 父级: ../CLAUDE.md\n\n成员清单\nbuild-site.mjs: 只读80源文件并逐字节复制，构建独立GitHub Pages docs站，不修改源或发布\nverify-site.mjs: 本机HTTP逐份核验85公开文件SHA、80源文件与公开数据边界\nsite-manifest.json: 85相对路径/SHA/字节、20样本/80原件与总量/最大文件，无内部链接或本机绝对路径\nsite-verification.json: 本机85 HTTP响应及原始SHA验收记录，不代表线上发布\nREADME.md: 公开使用、尺度边界、main:/docs与原始文件规模说明\n' + sorted.map(file => 'docs/' + file.path + ': ' + (file.testId ? file.testId + ' ' + file.model + '实际原始字节，' + file.width + '×' + file.height + ' ' + file.format : file.kind + '静态运行文件')).join('\n') + '\n\ndocs为纯部署产物目录，成员清单在此父级维护，不把内部文档发布到网站。\n\n[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md\n';
await writeFile(join(directory, 'CLAUDE.md'), map);
console.log(JSON.stringify({ directory, staticFiles: files.length, actualImages: imageFiles.length, totalBytes: manifest.totalBytes, largestFile, imagesReencoded: 0 }, null, 2));
