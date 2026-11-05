// Manual experiment only. This file is not part of the extension build.
// Pass this standalone function to Playwright's addInitScript before navigation.
export function installWeReadPrototype() {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!(local || location.hostname === 'weread.qq.com' && location.pathname.startsWith('/web/reader/')) || window.__crWeReadPrototypeInstalled) return;
  window.__crWeReadPrototypeInstalled = true;

  const ROOT_ID = 'context-reader-weread-prototype';
  const MAX_CANVASES = 16, MAX_GLYPHS = 16000;
  const states = new Map();
  let root, timer, serial = 0, unsupportedCopies = 0, unsupportedTransforms = 0;
  const finite = n => Number.isFinite(n);
  const schedule = () => { if (!timer) timer = setTimeout(render, 80); };

  function stateFor(canvas) {
    let state = states.get(canvas);
    if (!state) {
      if (states.size >= MAX_CANVASES) {
        const candidate = [...states.keys()].find(c => !c.isConnected) || states.keys().next().value;
        states.get(candidate)?.scope?.remove();
        states.delete(candidate);
      }
      state = { id: ++serial, width: canvas.width, height: canvas.height, glyphs: new Map(), scope: null, signature: '' };
      states.set(canvas, state);
    }
    if (state.width !== canvas.width || state.height !== canvas.height) {
      state.width = canvas.width; state.height = canvas.height; state.glyphs.clear(); state.signature = '';
    }
    return state;
  }

  function record(ctx, text, x, y, maxWidth) {
    if (typeof text !== 'string' || !text.length || text.length > 1600 || /[\uE000-\uF8FF\u0000-\u0008\u000E-\u001F]/u.test(text) || !finite(x) || !finite(y)) return;
    const matrix = ctx.getTransform();
    if (Math.abs(matrix.b) > .0001 || Math.abs(matrix.c) > .0001 || matrix.a <= 0 || matrix.d <= 0) { unsupportedTransforms++; return; }
    const metric = ctx.measureText(text), fontSize = Number(ctx.font.match(/([\d.]+)px/)?.[1]);
    if (!fontSize || !finite(metric.width) || metric.width < 0) return;
    const compressed = finite(maxWidth) && maxWidth > 0 && maxWidth < metric.width ? maxWidth / metric.width : 1;
    const ascent = metric.fontBoundingBoxAscent, descent = metric.fontBoundingBoxDescent;
    const top = finite(ascent) && finite(descent)
      ? y + (descent - ascent - fontSize) / 2
      : y - (ctx.textBaseline === 'middle' ? fontSize / 2 : fontSize * .8);
    let left = x;
    if (ctx.textAlign === 'center') left -= metric.width * compressed / 2;
    else if (ctx.textAlign === 'right' || ctx.textAlign === 'end' && ctx.direction !== 'rtl' || ctx.textAlign === 'start' && ctx.direction === 'rtl') left -= metric.width * compressed;
    const glyph = {
      text, x: matrix.a * left + matrix.e, y: matrix.d * top + matrix.f,
      width: metric.width * matrix.a * compressed, height: fontSize * matrix.d,
      scaleX: matrix.a * compressed, scaleY: matrix.d, font: ctx.font,
      fontKerning: ctx.fontKerning || 'auto', letterSpacing: ctx.letterSpacing || '0px', wordSpacing: ctx.wordSpacing || '0px',
      baseline: matrix.d * y + matrix.f
    };
    const state = stateFor(ctx.canvas), key = `${glyph.x.toFixed(2)},${glyph.baseline.toFixed(2)}`;
    if (state.glyphs.size >= MAX_GLYPHS && !state.glyphs.has(key)) return;
    state.glyphs.set(key, glyph); schedule();
  }

  function clear(ctx, x, y, width, height) {
    const state = states.get(ctx.canvas); if (!state) return;
    const matrix = ctx.getTransform();
    const left = matrix.a * x + matrix.e, top = matrix.d * y + matrix.f;
    const right = left + width * matrix.a, bottom = top + height * matrix.d;
    if (left <= 0 && top <= 0 && right >= ctx.canvas.width && bottom >= ctx.canvas.height) state.glyphs.clear();
    else for (const [key, glyph] of state.glyphs) {
      if (glyph.x < right && glyph.x + glyph.width > left && glyph.y < bottom && glyph.y + glyph.height > top) state.glyphs.delete(key);
    }
    schedule();
  }

  function copy(ctx, source, args) {
    const from = states.get(source);
    if (!from || !from.glyphs.size) {
      // Bitmap-only sources cannot supply text. This prototype never guesses it.
      if (source && typeof source.getContext === 'function') unsupportedCopies++;
      return;
    }
    const m = ctx.getTransform();
    if (Math.abs(m.b) > .0001 || Math.abs(m.c) > .0001 || m.a <= 0 || m.d <= 0) { unsupportedTransforms++; return; }
    let sx = 0, sy = 0, sw = source.width, sh = source.height, dx, dy, dw, dh;
    if (args.length === 2) [dx, dy] = args, dw = sw, dh = sh;
    else if (args.length === 4) [dx, dy, dw, dh] = args;
    else if (args.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    else return;
    if (![sx, sy, sw, sh, dx, dy, dw, dh].every(finite) || sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    const target = stateFor(ctx.canvas), ax = dw / sw * m.a, ay = dh / sh * m.d;
    for (const g of [...from.glyphs.values()]) {
      // Only whole glyphs inside the copied source rectangle are represented.
      if (g.x < sx || g.y < sy || g.x + g.width > sx + sw || g.y + g.height > sy + sh) continue;
      const glyph = { ...g, x: (g.x - sx) * ax + dx * m.a + m.e, y: (g.y - sy) * ay + dy * m.d + m.f,
        width: g.width * ax, height: g.height * ay, scaleX: g.scaleX * ax, scaleY: g.scaleY * ay,
        baseline: (g.baseline - sy) * ay + dy * m.d + m.f };
      if (target.glyphs.size >= MAX_GLYPHS) break;
      target.glyphs.set(`${glyph.x.toFixed(2)},${glyph.baseline.toFixed(2)}`, glyph);
    }
    schedule();
  }

  function patch(prototype) {
    if (!prototype) return;
    const fillText = prototype.fillText, clearRect = prototype.clearRect, drawImage = prototype.drawImage, reset = prototype.reset;
    prototype.fillText = function (text, x, y, maxWidth) {
      const result = Reflect.apply(fillText, this, arguments);
      try { record(this, text, x, y, maxWidth); } catch { /* Never interrupt the host renderer. */ }
      return result;
    };
    prototype.clearRect = function (x, y, width, height) {
      const result = Reflect.apply(clearRect, this, arguments);
      try { clear(this, x, y, width, height); } catch {}
      return result;
    };
    prototype.drawImage = function (source, ...args) {
      const result = Reflect.apply(drawImage, this, [source, ...args]);
      try { copy(this, source, args); } catch {}
      return result;
    };
    if (reset) prototype.reset = function () {
      const result = Reflect.apply(reset, this, arguments);
      states.get(this.canvas)?.glyphs.clear(); schedule(); return result;
    };
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
        const state = states.get(this);
        if (state) {
          state.glyphs.clear(); state.signature = '';
          state.width = this.width; state.height = this.height; schedule();
        }
      } });
    }
  }

  function mount() {
    if (root?.isConnected || !document.body) return;
    root = document.createElement('div'); root.id = ROOT_ID;
    root.dataset.status = 'waiting';
    root.style.cssText = 'position:fixed;inset:0;z-index:10;pointer-events:none;overflow:visible;';
    // Only the text receives pointer input. The site keeps its blank-area,
    // navigation and toolbar interactions. Mouseup still reaches ContextReader.
    // WeRead also cancels selectstart on document. Stop that cancellation only
    // for our own experimental text; do not change any host event listener.
    for (const type of ['pointerdown', 'mousedown', 'selectstart', 'contextmenu']) root.addEventListener(type, event => event.stopPropagation());
    document.body.append(root);
  }

  function render() {
    timer = 0; mount(); if (!root) return;
    let canvasCount = 0, glyphCount = 0;
    for (const [canvas, state] of states) {
      if (!canvas.isConnected || typeof canvas.getBoundingClientRect !== 'function') { state.scope?.remove(); state.scope = null; continue; }
      stateFor(canvas); // Dimension assignment clears a canvas without clearRect.
      const rect = canvas.getBoundingClientRect(), css = getComputedStyle(canvas);
      const eligible = local || canvas.closest('.readerChapterContent,.renderTargetCanvasContainer');
      if (!eligible || !rect.width || !rect.height || css.visibility !== 'visible' || css.display === 'none' || !state.glyphs.size) {
        state.scope?.remove(); state.scope = null; continue;
      }
      const glyphs = [...state.glyphs.values()].filter(g => g.x >= -.5 && g.y + g.height > 0 && g.x < canvas.width && g.y < canvas.height)
        .sort((a, b) => Math.abs(a.baseline - b.baseline) > 2 ? a.baseline - b.baseline : a.x - b.x);
      if (!glyphs.length) continue;
      const signature = JSON.stringify(glyphs);
      if (!state.scope) {
        state.scope = document.createElement('p'); state.scope.dataset.crWereadScope = String(state.id);
        state.scope.lang = 'en';
        state.scope.style.cssText = 'position:absolute;margin:0;padding:0;border:0;pointer-events:none;white-space:pre;color:transparent;user-select:text;-webkit-user-select:text;';
        root.append(state.scope); state.signature = '';
      }
      const scope = state.scope, rx = rect.width / canvas.width, ry = rect.height / canvas.height;
      scope.style.left = rect.left + 'px'; scope.style.top = rect.top + 'px';
      scope.style.width = rect.width + 'px'; scope.style.height = rect.height + 'px';
      if (state.signature !== signature || state.ratioX !== rx || state.ratioY !== ry) {
        const fragment = document.createDocumentFragment();
        let line, baseline = -Infinity;
        for (const glyph of glyphs) {
          if (Math.abs(glyph.baseline - baseline) > 2) {
            if (line) fragment.append(document.createTextNode('\n'));
            line = document.createElement('span'); line.dataset.crWereadLine = '';
            fragment.append(line); baseline = glyph.baseline;
          }
          const span = document.createElement('span'); span.dataset.crWereadGlyph = '';
          span.textContent = glyph.text;
          span.style.cssText = 'position:absolute;display:block;pointer-events:auto;color:transparent;white-space:pre;cursor:text;user-select:text;-webkit-user-select:text;transform-origin:0 0;';
          span.style.font = glyph.font;
          // Canvas resolves an unavailable family against the canvas element's
          // inherited font list. DOM text otherwise falls back to default serif.
          span.style.fontFamily += ', ' + css.fontFamily;
          const fontSize = Number(glyph.font.match(/([\d.]+)px/)?.[1]);
          span.style.lineHeight = fontSize + 'px';
          span.style.left = glyph.x * rx + 'px'; span.style.top = glyph.y * ry + 'px';
          span.style.width = glyph.width / glyph.scaleX + 'px'; span.style.height = fontSize + 'px';
          span.style.transform = `scale(${glyph.scaleX * rx},${glyph.scaleY * ry})`;
          span.style.fontKerning = glyph.fontKerning; span.style.letterSpacing = glyph.letterSpacing; span.style.wordSpacing = glyph.wordSpacing;
          line.append(span);
        }
        scope.replaceChildren(fragment); state.signature = signature; state.ratioX = rx; state.ratioY = ry;
      }
      canvasCount++; glyphCount += glyphs.length;
    }
    root.dataset.status = canvasCount ? 'ready' : 'waiting';
    root.dataset.canvasCount = String(canvasCount); root.dataset.glyphCount = String(glyphCount);
    root.dataset.unsupportedCopies = String(unsupportedCopies); root.dataset.unsupportedTransforms = String(unsupportedTransforms);
  }
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true, capture: true });
  // CSS visibility and width/height property changes do not necessarily draw.
  setInterval(schedule, 1000);
  schedule();
}
