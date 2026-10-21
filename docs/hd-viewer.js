/**
 * [INPUT]: 依赖高清原图对比.html内嵌80份实际文件元数据、DOM与浏览器原生img/Pointer/Fullscreen/ResizeObserver
 * [OUTPUT]: 提供UpscaleHDGeometry纯几何接口及当前样本的实际原文件四路/两路查看、同步定位、原生100%与缩放拖动
 * [POS]: 三方整合高清主查看器；显示层只变换原img，不使用canvas、不重新编码、不用拼图替代实际输出
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(() => {
  'use strict';
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const centerOf = center => ({ u: clamp(center.u, 0, 1), v: clamp(center.v, 0, 1) });
  const span = ({ original, image, mode, scale }) => ({ width: (mode === 'native' ? image.width : original.width) * scale, height: (mode === 'native' ? image.height : original.height) * scale });
  function projectBox(options) {
    const { image, viewport, center } = options, size = span(options);
    return { width: size.width, height: size.height, left: viewport.width / 2 - center.u * size.width,
      top: viewport.height / 2 - center.v * size.height, scaleX: size.width / image.width, scaleY: size.height / image.height };
  }
  function fitScale(original, viewports) {
    const values = viewports.filter(viewport => viewport.width > 0 && viewport.height > 0).flatMap(viewport => [viewport.width / original.width, viewport.height / original.height]);
    return values.length ? Math.min(...values) : 1;
  }
  function zoomAt(options) {
    const before = span(options), after = span({ ...options, scale: options.nextScale });
    const dx = options.point.x - options.viewport.width / 2, dy = options.point.y - options.viewport.height / 2;
    return { scale: options.nextScale, center: centerOf({ u: options.center.u + dx / before.width - dx / after.width, v: options.center.v + dy / before.height - dy / after.height }) };
  }
  function dragBy(options) {
    const size = span(options);
    return centerOf({ u: options.center.u - options.delta.x / size.width, v: options.center.v - options.delta.y / size.height });
  }
  globalThis.UpscaleHDGeometry = Object.freeze({ projectBox, fitScale, zoomAt, dragBy });
  if (typeof document === 'undefined') return;

  const dataNode = document.getElementById('viewerData');
  if (!dataNode) return;
  const data = JSON.parse(dataNode.textContent), byId = id => document.getElementById(id);
  const keys = ['original', 'jzxz', 'ks', 'ksDirect'];
  const labels = { original: '原图', jzxz: '建筑学长', ks: 'KS', ksDirect: 'KS直入' };
  const nodes = { shell: byId('viewerShell'), panes: byId('panes'), sample: byId('sampleSelect'), layout: byId('layoutSelect'),
    pair: byId('pairControls'), pairA: byId('pairA'), pairB: byId('pairB'), zoom: byId('zoomReadout'), description: byId('modeDescription'),
    warning: byId('inputWarning'), title: byId('sampleTitle'), summary: byId('loadSummary'), restore: byId('restorePanes'), fullscreen: byId('fullscreenToggle') };
  const state = { sample: null, mode: 'common', scale: 1, center: { u: .5, v: .5 }, autoFit: true,
    layout: '4', pair: ['ks', 'ksDirect'], spotlight: null, frame: 0 };
  const panes = new Map();
  const dimension = item => item.width + '×' + item.height;
  const fileSize = bytes => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MiB' : Math.round(bytes / 1024) + ' KiB';
  function visibleKeys() { return state.spotlight ? [state.spotlight] : state.layout === '2' ? state.pair : state.layout === '3' ? keys.slice(1) : keys; }
  function viewportOf(pane) { const rect = pane.stage.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }
  function geometry(key) { return { original: state.sample.original, image: state.sample.images[key], viewport: viewportOf(panes.get(key)), center: state.center, mode: state.mode, scale: state.scale }; }
  function schedule() { if (!state.frame) state.frame = requestAnimationFrame(render); }
  function render() {
    state.frame = 0;
    const visible = visibleKeys();
    if (state.autoFit) state.scale = fitScale(state.sample.original, visible.map(key => viewportOf(panes.get(key))));
    for (const key of visible) {
      const pane = panes.get(key), box = projectBox(geometry(key));
      pane.image.style.transform = 'translate(' + box.left + 'px,' + box.top + 'px) scale(' + box.scaleX + ',' + box.scaleY + ')';
      pane.scale.textContent = '原文件像素显示 ' + (box.scaleX * 100).toFixed(box.scaleX < .1 ? 1 : 0) + '%';
    }
    nodes.zoom.textContent = (state.mode === 'native' ? '各自 ' : '原图基准 ') + Math.round(state.scale * 100) + '%';
    for (const button of document.querySelectorAll('[data-view-mode]')) button.setAttribute('aria-pressed', String(button.dataset.viewMode === state.mode));
    nodes.description.textContent = state.mode === 'common'
      ? '同视野：四路映射同一原图坐标和视野比例。滚轮缩放、拖动平移；显示比例随原文件分辨率不同，不称各路原生100%。'
      : '原生像素：各路同一缩放倍数，100%时1个文件像素对应1个CSS像素。仅同步原图中心位置，各路可见视野不同。';
  }
  function updateSummary() {
    const visible = visibleKeys(), ready = visible.filter(key => panes.get(key).status === 'ready').length, failed = visible.filter(key => panes.get(key).status === 'error').length;
    nodes.summary.textContent = '实际原文件 ' + ready + '/' + visible.length + ' 已加载' + (failed ? ' · ' + failed + ' 路失败' : '');
  }
  function clearImage(pane) {
    pane.file = null; pane.status = 'idle'; pane.image.removeAttribute('src'); pane.image.dataset.ready = 'false';
    pane.feedback.replaceChildren(); pane.feedback.classList.remove('is-error'); pane.feedback.hidden = false;
  }
  function loadImage(key) {
    const pane = panes.get(key), item = state.sample.images[key];
    if (pane.file === item.file) return;
    clearImage(pane); pane.file = item.file; pane.status = 'loading';
    pane.feedback.textContent = '正在加载实际原文件 · ' + fileSize(item.bytes);
    pane.image.width = item.width; pane.image.height = item.height;
    pane.image.style.width = item.width + 'px'; pane.image.style.height = item.height + 'px';
    pane.image.alt = state.sample.testId + ' ' + labels[key] + ' 实际原文件';
    pane.image.onload = () => {
      if (pane.file !== item.file) return;
      if (pane.image.naturalWidth !== item.width || pane.image.naturalHeight !== item.height) {
        failImage(pane, '浏览器解码尺寸与记录不一致：' + pane.image.naturalWidth + '×' + pane.image.naturalHeight + '。请打开原文件核对。'); return;
      }
      pane.status = 'ready'; pane.image.dataset.ready = 'true'; pane.feedback.hidden = true; updateSummary(); schedule();
    };
    pane.image.onerror = () => { if (pane.file === item.file) failImage(pane, '原文件加载失败。请检查网络连接或原文件访问权限，再重试。'); };
    pane.image.src = item.file;
  }
  function failImage(pane, message) {
    pane.status = 'error'; pane.image.dataset.ready = 'false'; pane.feedback.hidden = false; pane.feedback.classList.add('is-error');
    const text = document.createElement('span'), retry = document.createElement('button'); text.textContent = message; retry.type = 'button'; retry.textContent = '重新加载';
    retry.addEventListener('click', () => { pane.file = null; loadImage(pane.key); updateSummary(); });
    pane.feedback.replaceChildren(text, retry); updateSummary();
  }
  function applyLayout() {
    const visible = visibleKeys(); nodes.panes.dataset.count = visible.length; nodes.pair.hidden = state.layout !== '2'; nodes.restore.hidden = !state.spotlight;
    for (const key of keys) {
      const pane = panes.get(key); pane.article.hidden = !visible.includes(key);
      pane.expand.title = pane.expand.getAttribute('aria-label') === '返回多路对比' && state.spotlight ? '返回多路对比' : '单独放大' + labels[key];
      pane.expand.setAttribute('aria-label', state.spotlight ? '返回多路对比' : '单独放大' + labels[key]);
      if (visible.includes(key)) loadImage(key); else if (pane.file) clearImage(pane);
    }
    updateSummary(); schedule();
  }
  function setSample(testId) {
    state.sample = data.samples.find(sample => sample.testId === testId) || data.samples[0]; nodes.sample.value = state.sample.testId;
    state.center = { u: .5, v: .5 }; state.mode = 'common'; state.autoFit = true; state.spotlight = null;
    for (const pane of panes.values()) clearImage(pane);
    nodes.title.textContent = state.sample.testId + ' · ' + state.sample.title;
    nodes.warning.textContent = state.sample.adaptationWarning || '三路上传来源为同一原件；建筑学长平台内部预处理未知，KS工作流前置0.75MP，KS直入移除此步骤。';
    const index = data.samples.indexOf(state.sample); byId('previousSample').disabled = index === 0; byId('nextSample').disabled = index === data.samples.length - 1;
    for (const key of keys) {
      const pane = panes.get(key), item = state.sample.images[key];
      pane.dimensions.textContent = dimension(item) + ' · ' + item.format.toUpperCase() + ' · ' + fileSize(item.bytes);
      pane.input.textContent = item.inputLabel; pane.input.title = item.inputLabel;
      pane.open.href = item.file; pane.download.href = item.file; pane.download.download = state.sample.testId + '-' + item.file.split('/').pop();
    }
    state.sample.rois.forEach((roi, index) => { const button = byId('roi' + (index + 1)); button.title = roi.label; button.textContent = '细节' + roi.id; });
    try { const url = new URL(location.href); url.searchParams.set('sample', state.sample.testId); url.searchParams.delete('roi'); history.replaceState(null, '', url); } catch {}
    applyLayout();
  }
  function setMode(mode) {
    if (mode === 'native') state.scale = 1;
    else if (state.mode === 'native') state.scale *= state.sample.images[visibleKeys()[0]].width / state.sample.original.width;
    state.mode = mode; state.autoFit = false; schedule();
  }
  function fit() { state.mode = 'common'; state.center = { u: .5, v: .5 }; state.autoFit = true; schedule(); }
  function zoom(key, factor, point = null) {
    const options = geometry(key), viewport = options.viewport;
    if (!viewport.width || !viewport.height) return;
    const minimum = state.mode === 'native' ? .03 : fitScale(state.sample.original, [viewport]) * .2;
    const nextScale = clamp(state.scale * factor, minimum, 16);
    const next = zoomAt({ ...options, nextScale, point: point || { x: viewport.width / 2, y: viewport.height / 2 } });
    state.scale = next.scale; state.center = next.center; state.autoFit = false; schedule();
  }
  function drag(key, delta) { state.center = dragBy({ ...geometry(key), delta }); state.autoFit = false; schedule(); }
  function focusRoi(index) {
    const roi = state.sample.rois[index]; if (!roi) return;
    state.mode = 'common'; state.center = { u: (roi.left + roi.width / 2) / state.sample.original.width, v: (roi.top + roi.height / 2) / state.sample.original.height };
    state.scale = fitScale(roi, visibleKeys().map(key => viewportOf(panes.get(key)))); state.autoFit = false; schedule();
  }
  const gesture = { key: null, points: new Map(), midpoint: null, distance: null };
  function resetGesture() { gesture.key = null; gesture.points.clear(); gesture.midpoint = null; gesture.distance = null; for (const pane of panes.values()) pane.stage.classList.remove('is-dragging'); }
  function gestureMeasure() {
    const points = [...gesture.points.values()];
    return points.length > 1 ? { midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) } : { midpoint: points[0] || null, distance: null };
  }
  function addInteractions(pane) {
    const localPoint = event => { const rect = pane.stage.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    pane.stage.addEventListener('wheel', event => { if (pane.status !== 'ready') return; event.preventDefault(); zoom(pane.key, Math.exp(clamp(-event.deltaY * (event.deltaMode === 1 ? .025 : .0015), -.8, .8)), localPoint(event)); }, { passive: false });
    pane.stage.addEventListener('pointerdown', event => {
      if (event.button !== 0 || pane.status !== 'ready') return;
      if (gesture.key && gesture.key !== pane.key) resetGesture();
      gesture.key = pane.key; gesture.points.set(event.pointerId, localPoint(event)); Object.assign(gesture, gestureMeasure());
      pane.stage.setPointerCapture(event.pointerId); pane.stage.classList.add('is-dragging'); pane.stage.focus({ preventScroll: true }); event.preventDefault();
    });
    pane.stage.addEventListener('pointermove', event => {
      if (gesture.key !== pane.key || !gesture.points.has(event.pointerId)) return;
      gesture.points.set(event.pointerId, localPoint(event)); const next = gestureMeasure();
      if (gesture.midpoint && next.midpoint) drag(pane.key, { x: next.midpoint.x - gesture.midpoint.x, y: next.midpoint.y - gesture.midpoint.y });
      if (gesture.distance && next.distance) zoom(pane.key, next.distance / gesture.distance, next.midpoint);
      Object.assign(gesture, next);
    });
    const end = event => { if (!gesture.points.has(event.pointerId)) return; gesture.points.delete(event.pointerId); Object.assign(gesture, gestureMeasure()); if (!gesture.points.size) resetGesture(); };
    pane.stage.addEventListener('pointerup', end); pane.stage.addEventListener('pointercancel', end); pane.stage.addEventListener('lostpointercapture', end);
    pane.stage.addEventListener('keydown', event => {
      const movement = { ArrowLeft: { x: 45, y: 0 }, ArrowRight: { x: -45, y: 0 }, ArrowUp: { x: 0, y: 45 }, ArrowDown: { x: 0, y: -45 } }[event.key];
      if (movement) drag(pane.key, movement); else if (['+', '='].includes(event.key)) zoom(pane.key, 1.25); else if (event.key === '-') zoom(pane.key, .8); else if (event.key === '0') fit(); else if (event.key === '1') setMode('native'); else return;
      event.preventDefault();
    });
    pane.expand.addEventListener('click', () => { state.spotlight = state.spotlight ? null : pane.key; state.autoFit = state.mode === 'common'; applyLayout(); });
  }
  for (const article of nodes.panes.querySelectorAll('[data-model]')) {
    const key = article.dataset.model, pane = { key, article, stage: article.querySelector('.image-stage'), image: article.querySelector('img'), feedback: article.querySelector('.image-feedback'),
      dimensions: article.querySelector('.pane-dimensions'), input: article.querySelector('.pane-input'), scale: article.querySelector('.pixel-scale'), expand: article.querySelector('[data-expand]'),
      open: article.querySelector('[data-open]'), download: article.querySelector('[data-download]'), file: null, status: 'idle' };
    panes.set(key, pane); addInteractions(pane);
  }
  data.samples.forEach(sample => nodes.sample.add(new Option(sample.testId + ' · ' + sample.title, sample.testId)));
  for (const select of [nodes.pairA, nodes.pairB]) for (const key of keys) select.add(new Option(labels[key], key));
  nodes.pairA.value = 'ks'; nodes.pairB.value = 'ksDirect';
  nodes.sample.addEventListener('change', () => { resetGesture(); setSample(nodes.sample.value); });
  byId('previousSample').addEventListener('click', () => setSample(data.samples[Math.max(0, data.samples.indexOf(state.sample) - 1)].testId));
  byId('nextSample').addEventListener('click', () => setSample(data.samples[Math.min(data.samples.length - 1, data.samples.indexOf(state.sample) + 1)].testId));
  nodes.layout.addEventListener('change', () => { resetGesture(); state.layout = nodes.layout.value; state.spotlight = null; state.autoFit = state.mode === 'common'; applyLayout(); });
  for (const [select, other] of [[nodes.pairA, nodes.pairB], [nodes.pairB, nodes.pairA]]) select.addEventListener('change', () => {
    if (select.value === other.value) other.value = keys.find(key => key !== select.value);
    state.pair = [nodes.pairA.value, nodes.pairB.value]; state.spotlight = null; state.autoFit = state.mode === 'common'; applyLayout();
  });
  for (const button of document.querySelectorAll('[data-view-mode]')) button.addEventListener('click', () => setMode(button.dataset.viewMode));
  byId('fitView').addEventListener('click', fit); byId('native100').addEventListener('click', () => setMode('native'));
  byId('zoomIn').addEventListener('click', () => zoom(visibleKeys()[0], 1.25)); byId('zoomOut').addEventListener('click', () => zoom(visibleKeys()[0], .8));
  byId('roi1').addEventListener('click', () => focusRoi(0)); byId('roi2').addEventListener('click', () => focusRoi(1));
  nodes.restore.addEventListener('click', () => { state.spotlight = null; state.autoFit = state.mode === 'common'; applyLayout(); });
  function fullscreenLabel() { nodes.fullscreen.textContent = document.fullscreenElement || document.body.classList.contains('fullscreen-fallback') ? '退出全屏' : '全屏'; schedule(); }
  nodes.fullscreen.addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.body.classList.contains('fullscreen-fallback')) document.body.classList.remove('fullscreen-fallback');
    else try { if (!nodes.shell.requestFullscreen) throw new Error('unsupported'); await nodes.shell.requestFullscreen(); } catch { document.body.classList.add('fullscreen-fallback'); }
    fullscreenLabel();
  });
  document.addEventListener('fullscreenchange', fullscreenLabel);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { document.body.classList.remove('fullscreen-fallback'); if (state.spotlight) { state.spotlight = null; applyLayout(); } fullscreenLabel(); } });
  if (typeof ResizeObserver !== 'undefined') { const observer = new ResizeObserver(schedule); for (const pane of panes.values()) observer.observe(pane.stage); } else window.addEventListener('resize', schedule);
  const parameters = new URLSearchParams(location.search), initialRoi = Number(parameters.get('roi'));
  setSample(parameters.get('sample'));
  if (initialRoi === 1 || initialRoi === 2) requestAnimationFrame(() => focusRoi(initialRoi - 1));
})();
