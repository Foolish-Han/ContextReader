// Runs only in WeRead's MAIN world. The page owns all data crossing this
// bridge; no extension API, knowledge, settings or credentials is exposed.
(() => {
  if (location.origin !== 'https://weread.qq.com') return;
  const CHANNEL = 'context-reader-weread';
  // reading.ensure may inject again when a popup inspects or enables a tab.
  // This marker carries no captured text or authority; the existing listener
  // answers the isolated bootstrap's next capture request with fresh state.
  const installation = Symbol.for('context-reader-weread-capture-installed');
  if (window[installation]) {
    try { window.postMessage({ channel: CHANNEL, type: 'ready' }, location.origin); } catch {}
    return;
  }
  Object.defineProperty(window, installation, { value: true });
  const MAX_STATES = 16, MAX_GLYPHS = 16000, MAX_VISIBLE = 8;
  const MAX_PARAGRAPHS = 2000, MAX_PARAGRAPH_CHARS = 200000;
  const states = new Map();
  const paragraphs = new Map();
  const post = window.postMessage.bind(window), origin = location.origin;
  let enabled = false, timer = null, poll = null, serial = 0, revision = 0;
  let totalGlyphs = 0, page = location.pathname, lastSignature = '', forceSnapshot = false;
  let paragraphChars = 0, paragraphVersion = 0, paragraphOutput = [];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const readerPage = () => location.pathname.startsWith('/web/reader/');
  const cssText = (value, maximum = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximum) : '';
  const send = payload => { try { post({ channel: CHANNEL, ...payload }, origin); } catch { /* The host page must keep working. */ } };
  function schedule(delay = 60) {
    if (enabled && timer === null) timer = setTimeout(publish, delay);
  }
  function empty(state) {
    totalGlyphs -= state.glyphs.size;
    state.glyphs.clear(); state.output = []; state.dirty = true;
  }
  function reset(state) { empty(state); state.blocked = false; }
  function forgetParagraphs() {
    paragraphs.clear(); paragraphChars = 0; paragraphOutput = []; paragraphVersion++;
  }
  function forgetAll() { states.clear(); totalGlyphs = 0; forgetParagraphs(); }
  function reconcilePage() {
    const next = location.pathname;
    if (page !== next) { page = next; forgetAll(); forceSnapshot = true; }
    return enabled && readerPage();
  }
  function stateFor(canvas) {
    let state = states.get(canvas);
    if (!state) {
      if (states.size >= MAX_STATES) {
        const victim = [...states.keys()].find(c => typeof c.isConnected === 'boolean' && !c.isConnected) || states.keys().next().value;
        empty(states.get(victim)); states.delete(victim);
      }
      state = { id: ++serial, width: canvas.width, height: canvas.height, glyphs: new Map(), dirty: true, blocked: false, version: 0 };
      states.set(canvas, state);
    }
    if (state.width !== canvas.width || state.height !== canvas.height) {
      reset(state); state.width = canvas.width; state.height = canvas.height;
    }
    return state;
  }
  function invalidate(state) { empty(state); state.blocked = true; schedule(); }
  function axisMatrix(ctx) {
    const matrix = ctx.getTransform();
    return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(finite)
      && Math.abs(matrix.b) < .0001 && Math.abs(matrix.c) < .0001
      && matrix.a > 0 && matrix.d > 0 ? matrix : null;
  }
  function put(state, glyph) {
    if (state.blocked) return;
    const key = glyph.x.toFixed(3) + ',' + glyph.baseline.toFixed(3);
    const previous = state.glyphs.get(key);
    if (previous && Object.keys(glyph).every(name => previous[name] === glyph[name])) return;
    if (!state.glyphs.has(key)) {
      if (totalGlyphs >= MAX_GLYPHS) { invalidate(state); return; }
      totalGlyphs++;
    }
    state.glyphs.set(key, glyph); state.dirty = true;
  }
  function record(ctx, text, x, y, maxWidth) {
    if (!reconcilePage() || ctx.globalAlpha === 0) return;
    const state = stateFor(ctx.canvas);
    if (state.blocked) return;
    // Never turn obfuscated glyph codes or an unsupported paint operation into
    // a plausible partial paragraph. A clear/reset starts a fresh generation.
    const matrix = axisMatrix(ctx);
    if (!matrix || ctx.globalCompositeOperation !== 'source-over' || ctx.direction === 'rtl'
      || typeof text !== 'string' || text.length > 1600
      || /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\u0000-\u0008\u000E-\u001F\u007F]/u.test(text)) { invalidate(state); return; }
    if (!text.length || !finite(x) || !finite(y)) return;
    const metric = ctx.measureText(text), size = Number(ctx.font.match(/([\d.]+)px/)?.[1]);
    if (!size || size > 1000 || !finite(metric.width) || metric.width < 0) { invalidate(state); return; }
    const compressed = finite(maxWidth) && maxWidth > 0 && maxWidth < metric.width ? maxWidth / metric.width : 1;
    const ascent = metric.fontBoundingBoxAscent, descent = metric.fontBoundingBoxDescent;
    const top = finite(ascent) && finite(descent) ? y + (descent - ascent - size) / 2
      : y - (ctx.textBaseline === 'middle' ? size / 2 : size * .8);
    let left = x;
    if (ctx.textAlign === 'center') left -= metric.width * compressed / 2;
    else if (ctx.textAlign === 'right' || ctx.textAlign === 'end') left -= metric.width * compressed;
    const glyph = {
      text, x: matrix.a * left + matrix.e, y: matrix.d * top + matrix.f,
      width: metric.width * matrix.a * compressed, height: size * matrix.d,
      scaleX: matrix.a * compressed, scaleY: matrix.d, font: cssText(ctx.font),
      baseline: matrix.d * y + matrix.f,
      fontKerning: cssText(ctx.fontKerning || 'auto', 32),
      letterSpacing: cssText(ctx.letterSpacing || '0px', 64), wordSpacing: cssText(ctx.wordSpacing || '0px', 64)
    };
    if (![glyph.x, glyph.y, glyph.width, glyph.height, glyph.scaleX, glyph.scaleY, glyph.baseline].every(finite)
      || Math.max(Math.abs(glyph.x), Math.abs(glyph.y), glyph.width, glyph.height) > 1e7) { invalidate(state); return; }
    put(state, glyph); schedule();
  }
  function erase(state, left, top, right, bottom) {
    if (left <= 0 && top <= 0 && right >= state.width && bottom >= state.height) { reset(state); return; }
    if (state.blocked) return;
    for (const [key, glyph] of state.glyphs) if (glyph.x < right && glyph.x + glyph.width > left
      && glyph.y < bottom && glyph.y + glyph.height > top) { state.glyphs.delete(key); totalGlyphs--; state.dirty = true; }
  }
  function clear(ctx, x, y, width, height) {
    if (!reconcilePage()) return;
    const state = states.get(ctx.canvas); if (!state) return;
    const m = axisMatrix(ctx);
    if (!m || ![x, y, width, height].every(finite)) { invalidate(state); return; }
    const x1 = m.a * x + m.e, y1 = m.d * y + m.f, x2 = x1 + width * m.a, y2 = y1 + height * m.d;
    erase(state, Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)); schedule();
  }
  function copy(ctx, source, args) {
    if (!reconcilePage()) return;
    const m = axisMatrix(ctx), target = stateFor(ctx.canvas);
    if (!m) { invalidate(target); return; }
    let sx = 0, sy = 0, sw = source?.width, sh = source?.height, dx, dy, dw, dh;
    if (args.length === 2) { [dx, dy] = args; dw = sw; dh = sh; }
    else if (args.length === 4) [dx, dy, dw, dh] = args;
    else if (args.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    else { invalidate(target); return; }
    if (![sx, sy, sw, sh, dx, dy, dw, dh].every(finite) || sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) { invalidate(target); return; }
    const from = states.get(source), glyphs = from && !from.blocked ? [...from.glyphs.values()] : [];
    // Both text and bitmap copies overwrite earlier destination text. Unknown
    // bitmaps contribute no fabricated text of their own.
    erase(target, dx * m.a + m.e, dy * m.d + m.f, (dx + dw) * m.a + m.e, (dy + dh) * m.d + m.f);
    const ax = dw / sw * m.a, ay = dh / sh * m.d;
    for (const g of glyphs) {
      if (g.x < sx || g.y < sy || g.x + g.width > sx + sw || g.y + g.height > sy + sh) continue;
      put(target, { ...g, x: (g.x - sx) * ax + dx * m.a + m.e, y: (g.y - sy) * ay + dy * m.d + m.f,
        width: g.width * ax, height: g.height * ay, scaleX: g.scaleX * ax, scaleY: g.scaleY * ay,
        baseline: (g.baseline - sy) * ay + dy * m.d + m.f });
    }
    schedule();
  }
  function patch(prototype) {
    if (!prototype) return;
    for (const name of ['fillText', 'clearRect', 'fillRect', 'drawImage', 'reset', 'putImageData']) {
      const original = prototype[name]; if (typeof original !== 'function') continue;
      prototype[name] = function (...args) {
        const result = Reflect.apply(original, this, args);
        if (!enabled) return result;
        try {
          if (name === 'fillText') record(this, ...args);
          else if (name === 'clearRect' || name === 'fillRect') clear(this, ...args);
          else if (name === 'drawImage') copy(this, args[0], args.slice(1));
          else if (reconcilePage()) { const state = states.get(this.canvas); if (state) { name === 'reset' ? reset(state) : invalidate(state); schedule(); } }
        } catch { /* Instrumentation must never interrupt the native renderer. */ }
        return result;
      };
    }
  }
  patch(window.CanvasRenderingContext2D?.prototype);
  patch(window.OffscreenCanvasRenderingContext2D?.prototype);
  for (const prototype of [window.HTMLCanvasElement?.prototype, window.OffscreenCanvas?.prototype]) {
    if (!prototype) continue;
    for (const name of ['width', 'height']) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (!descriptor?.set || !descriptor.configurable) continue;
      Object.defineProperty(prototype, name, { ...descriptor, set(value) {
        Reflect.apply(descriptor.set, this, [value]);
        if (!enabled) return;
        const state = states.get(this);
        if (state) { reset(state); state.width = this.width; state.height = this.height; schedule(); }
      } });
    }
  }
  function publish() {
    timer = null; reconcilePage();
    const canvases = [];
    if (enabled && readerPage()) for (const [canvas, state] of states) {
      if (canvases.length >= MAX_VISIBLE) break;
      if (!canvas.isConnected || typeof canvas.getBoundingClientRect !== 'function'
        || !canvas.closest('.readerChapterContent,.renderTargetCanvasContainer')) continue;
      stateFor(canvas);
      if (state.blocked || !state.glyphs.size) continue;
      const r = canvas.getBoundingClientRect(), css = getComputedStyle(canvas);
      if (!r.width || !r.height || ![r.left, r.top, r.width, r.height].every(finite)
        || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight
        || css.visibility !== 'visible' || css.display === 'none' || css.opacity === '0') continue;
      if (state.dirty) {
        state.output = [...state.glyphs.values()].filter(g => g.x >= -.5 && g.y + g.height > 0 && g.x < canvas.width && g.y < canvas.height);
        const signature = JSON.stringify(state.output);
        if (signature !== state.outputSignature) { state.version++; state.outputSignature = signature; }
        state.dirty = false;
      }
      canvases.push({ id: state.id, width: canvas.width, height: canvas.height,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        fontFamily: cssText(css.fontFamily, 500), glyphs: state.output || [], version: state.version });
    }
    const signature = JSON.stringify([enabled, page, paragraphVersion, canvases.map(c => [c.id, c.width, c.height, c.rect, c.fontFamily, c.version])]);
    if (!forceSnapshot && signature === lastSignature) return;
    forceSnapshot = false; lastSignature = signature;
    send({ type: 'snapshot', revision: ++revision, page, canvases, paragraphs: paragraphOutput });
  }
  // WeRead briefly lays out complete chapter paragraphs in this container,
  // then removes their DOM after painting. Mutation records retain those
  // nodes, so context can come from source text rather than guessed line wraps.
  const paragraphSelector = 'p[data-wr-co],h1[data-wr-co],h2[data-wr-co],h3[data-wr-co],blockquote[data-wr-co],li[data-wr-co]';
  function collectParagraphs(root) {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const candidates = root.matches(paragraphSelector) ? [root] : [...root.querySelectorAll(paragraphSelector)];
    let changed = false;
    for (const element of candidates) {
      if (element.closest('.wr-translation') || element.matches('[hidden],[aria-hidden="true"]')) continue;
      const raw = element.getAttribute('data-wr-co');
      if (!/^\d{1,10}$/.test(raw || '')) continue;
      const offset = Number(raw), previous = paragraphs.get(offset), walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const discardPrevious = () => { if (paragraphs.delete(offset)) { paragraphChars -= previous.length; changed = true; } };
      let node, text = '';
      while ((node = walker.nextNode())) {
        const excluded = node.parentElement?.closest('script,style,.wr-translation,[hidden],[aria-hidden="true"]');
        if (excluded && element.contains(excluded)) continue;
        text += node.textContent;
        if (text.length > 20000) break;
      }
      text = text.replace(/\s+/gu, ' ').trim();
      if (!text || text.length > 20000 || /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\u0000-\u0008\u000E-\u001F\u007F]/u.test(text)) { discardPrevious(); continue; }
      if (previous === text || !previous && paragraphs.size >= MAX_PARAGRAPHS) continue;
      const nextSize = paragraphChars - (previous?.length || 0) + text.length;
      if (nextSize > MAX_PARAGRAPH_CHARS) { discardPrevious(); continue; }
      paragraphs.set(offset, text); paragraphChars = nextSize; changed = true;
    }
    if (changed) {
      paragraphOutput = [...paragraphs].sort(([a], [b]) => a - b).map(([offset, text]) => ({ offset, text }));
      paragraphVersion++; schedule();
    }
  }
  const sourceObserver = new MutationObserver(records => {
    if (!reconcilePage()) return;
    // Retain transient removed source, then let every newer/current paragraph
    // win. Processing a replacement's removed nodes last restores stale text.
    for (const record of records) {
      const target=record.target.nodeType===Node.ELEMENT_NODE?record.target:record.target.parentElement;
      if(target?.closest('#preRenderContent'))for(const node of record.removedNodes)collectParagraphs(node);
    }
    for (const record of records) {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      const inSource = target?.closest('#preRenderContent');
      if (inSource) {
        for (const node of record.addedNodes) collectParagraphs(node);
        const paragraph = target?.closest(paragraphSelector);
        if (paragraph) collectParagraphs(paragraph);
      } else for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.id === 'preRenderContent') collectParagraphs(node);
        else for (const source of node.querySelectorAll('#preRenderContent')) collectParagraphs(source);
      }
    }
  });
  sourceObserver.observe(document, { subtree: true, childList: true, characterData: true });
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== origin || event.data?.channel !== CHANNEL
      || event.data.type !== 'capture' || typeof event.data.enabled !== 'boolean') return;
    const next = event.data.enabled;
    if (!next) {
      enabled = false; forgetAll(); clearTimeout(timer); timer = null; clearInterval(poll); poll = null;
      forceSnapshot = true; publish();
    } else {
      enabled = true; forceSnapshot = true; reconcilePage();
      const source = document.getElementById('preRenderContent'); if (source) collectParagraphs(source);
      if (poll === null) poll = setInterval(() => schedule(0), 1000);
      schedule(0);
    }
  });
  for (const type of ['resize', 'scroll', 'popstate', 'hashchange']) window.addEventListener(type, () => schedule(), { passive: true, capture: type === 'scroll' });
  send({ type: 'ready' });
})();
