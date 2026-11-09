// Non-destructive screenshot editor: the composed image stays untouched and edits are a list of
// operations rendered on demand. Tools: select/move, crop, blur (pixelate), rectangle, arrow, text,
// numbered step. Undo/redo via snapshots. Operations are plain JSON so they can be saved and restored.

const EDITOR_SIZES = {
  S: { stroke: 2, text: 14, step: 10 },
  M: { stroke: 4, text: 18, step: 13 },
  L: { stroke: 6, text: 26, step: 17 },
};
const EDITOR_FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

// Dark outline for light colours, white outline for dark ones, so text stays readable on any page.
function contrastOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 160 ? '#0a0e17' : '#ffffff';
}

function pixelate(ctx, r, block) {
  const sw = Math.max(1, Math.round(r.w / block));
  const sh = Math.max(1, Math.round(r.h / block));
  const tmp = document.createElement('canvas');
  tmp.width = sw;
  tmp.height = sh;
  tmp.getContext('2d').drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
}

function drawOp(ctx, op) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (op.type) {
    case 'rect':
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.strokeRect(op.x, op.y, op.w, op.h);
      break;
    case 'arrow': {
      const ang = Math.atan2(op.y2 - op.y1, op.x2 - op.x1);
      const head = Math.max(op.width * 4, op.minHead);
      const bx = op.x2 - Math.cos(ang) * head * 0.8;
      const by = op.y2 - Math.sin(ang) * head * 0.8;
      ctx.strokeStyle = op.color;
      ctx.fillStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(op.x2, op.y2);
      ctx.lineTo(op.x2 - head * Math.cos(ang - 0.4), op.y2 - head * Math.sin(ang - 0.4));
      ctx.lineTo(op.x2 - head * Math.cos(ang + 0.4), op.y2 - head * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'text':
      ctx.font = `600 ${op.size}px ${EDITOR_FONT}`;
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, op.size / 5);
      ctx.strokeStyle = contrastOf(op.color);
      ctx.strokeText(op.text, op.x, op.y);
      ctx.fillStyle = op.color;
      ctx.fillText(op.text, op.x, op.y);
      break;
    case 'step':
      ctx.beginPath();
      ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
      ctx.fillStyle = op.color;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, op.r * 0.15);
      ctx.strokeStyle = contrastOf(op.color);
      ctx.stroke();
      ctx.fillStyle = contrastOf(op.color);
      ctx.font = `700 ${op.r * 1.1}px ${EDITOR_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(op.n), op.x, op.y + op.r * 0.05);
      break;
    case 'blur':
      pixelate(ctx, op, op.block);
      break;
  }
  ctx.restore();
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// base: the composed canvas. stage: shows base + edits. overlay: crop dimming, selection, the shape being drawn.
// unit: device pixels per CSS pixel of the captured page, so sizes feel the same on retina and non-retina.
function createEditor({ base, stage, overlay, textInput, unit }) {
  const W = base.width;
  const H = base.height;
  stage.width = W;
  stage.height = H;
  // The overlay is drawn on every pointer move, so keep it small even for very tall captures.
  const oScale = Math.min(1, 2000 / Math.max(W, H));
  overlay.width = Math.max(1, Math.round(W * oScale));
  overlay.height = Math.max(1, Math.round(H * oScale));
  const sctx = stage.getContext('2d');
  const octx = overlay.getContext('2d');
  const measure = document.createElement('canvas').getContext('2d');

  const MIN = Math.max(4, 3 * unit); // ignore accidental clicks
  let tool = null;
  let color = '#ef4444';
  let size = 'M';
  let ops = [];
  let crop = null;
  let selected = null; // index into ops while the select tool is active
  let undoStack = [];
  let redoStack = [];
  let drag = null;
  let textDraft = null;
  let raf = 0;
  const listeners = [];

  const sizes = () => EDITOR_SIZES[size];
  const outSize = () => (crop ? { width: crop.w, height: crop.h } : { width: W, height: H });
  const notify = () =>
    listeners.forEach((fn) =>
      fn({
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        dirty: ops.length > 0 || !!crop,
        hasSelection: selected !== null,
        ...outSize(),
      }),
    );

  const norm = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const clampRect = (r) => {
    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    return { x, y, w: Math.min(W, Math.round(r.x + r.w)) - x, h: Math.min(H, Math.round(r.y + r.h)) - y };
  };
  const toPoint = (e) => {
    const rect = overlay.getBoundingClientRect();
    const f = W / rect.width;
    return { x: (e.clientX - rect.left) * f, y: (e.clientY - rect.top) * f };
  };

  // ---- hit testing for the select tool ----
  function bounds(op) {
    switch (op.type) {
      case 'arrow':
        return { x: Math.min(op.x1, op.x2), y: Math.min(op.y1, op.y2), w: Math.abs(op.x1 - op.x2), h: Math.abs(op.y1 - op.y2) };
      case 'text':
        measure.font = `600 ${op.size}px ${EDITOR_FONT}`;
        return { x: op.x, y: op.y, w: measure.measureText(op.text).width, h: op.size * 1.2 };
      case 'step':
        return { x: op.x - op.r, y: op.y - op.r, w: op.r * 2, h: op.r * 2 };
      default:
        return { x: op.x, y: op.y, w: op.w, h: op.h };
    }
  }
  function hit(op, p) {
    const t = 6 * unit;
    if (op.type === 'arrow') {
      return distToSegment(p, { x: op.x1, y: op.y1 }, { x: op.x2, y: op.y2 }) <= Math.max(t, op.width / 2 + 3 * unit);
    }
    const b = bounds(op);
    const inOuter = p.x >= b.x - t && p.x <= b.x + b.w + t && p.y >= b.y - t && p.y <= b.y + b.h + t;
    if (op.type !== 'rect') return inOuter;
    // A rectangle is outline-only, so clicking inside it still reaches the things underneath.
    const inInner = b.w > 2 * t && b.h > 2 * t && p.x > b.x + t && p.x < b.x + b.w - t && p.y > b.y + t && p.y < b.y + b.h - t;
    return inOuter && !inInner;
  }
  const hitIndex = (p) => {
    for (let i = ops.length - 1; i >= 0; i--) if (hit(ops[i], p)) return i;
    return -1;
  };
  function moved(op, dx, dy) {
    if (op.type === 'arrow') return { ...op, x1: op.x1 + dx, y1: op.y1 + dy, x2: op.x2 + dx, y2: op.y2 + dy };
    const next = { ...op, x: op.x + dx, y: op.y + dy };
    if (op.type === 'blur') {
      next.x = Math.min(Math.max(0, next.x), W - op.w);
      next.y = Math.min(Math.max(0, next.y), H - op.h);
    }
    return next;
  }

  // ---- rendering ----
  function renderStage() {
    sctx.clearRect(0, 0, W, H);
    sctx.drawImage(base, 0, 0);
    let step = 0; // numbers follow the order on the page, so deleting one renumbers the rest
    ops.forEach((op) => drawOp(sctx, op.type === 'step' ? { ...op, n: ++step } : op));
  }
  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      renderStage();
    });
  }

  const arrowOp = (a, b) => ({
    type: 'arrow',
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    color,
    width: sizes().stroke * unit,
    minHead: 14 * unit,
  });

  function drawOverlay() {
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.setTransform(oScale, 0, 0, oScale, 0, 0);
    const px = 1 / oScale; // one overlay pixel in image pixels

    if (crop && !(drag && tool === 'crop')) {
      octx.fillStyle = 'rgba(10, 14, 23, 0.55)';
      octx.fillRect(0, 0, W, H);
      octx.clearRect(crop.x, crop.y, crop.w, crop.h);
      octx.strokeStyle = '#ffffff';
      octx.lineWidth = 1.5 * px;
      octx.setLineDash([6 * px, 4 * px]);
      octx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      octx.setLineDash([]);
    }

    if (tool === 'select' && selected !== null && ops[selected]) {
      const b = bounds(ops[selected]);
      const pad = 4 * unit;
      octx.strokeStyle = '#4f46e5';
      octx.lineWidth = 1.5 * px;
      octx.setLineDash([5 * px, 3 * px]);
      octx.strokeRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad);
      octx.setLineDash([]);
    }

    if (!drag || drag.mode === 'move') return;
    const r = norm(drag.start, drag.cur);
    if (tool === 'rect') {
      drawOp(octx, { type: 'rect', ...r, color, width: sizes().stroke * unit });
    } else if (tool === 'arrow') {
      drawOp(octx, arrowOp(drag.start, drag.cur));
    } else if (tool === 'blur' || tool === 'crop') {
      octx.fillStyle = tool === 'blur' ? 'rgba(79, 70, 229, 0.3)' : 'rgba(255, 255, 255, 0.12)';
      octx.fillRect(r.x, r.y, r.w, r.h);
      octx.strokeStyle = tool === 'blur' ? '#4f46e5' : '#ffffff';
      octx.lineWidth = 1.5 * px;
      octx.setLineDash([6 * px, 4 * px]);
      octx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }

  // ---- state changes ----
  function record() {
    undoStack.push({ ops, crop });
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }
  function pushOp(op) {
    record();
    ops = [...ops, op];
    renderStage();
    drawOverlay();
    notify();
  }
  function setCrop(rect) {
    record();
    crop = rect;
    drawOverlay();
    notify();
  }
  function restore(snapshot) {
    ops = snapshot.ops;
    crop = snapshot.crop;
    selected = null;
    renderStage();
    drawOverlay();
    notify();
  }
  function deleteSelected() {
    if (selected === null || !ops[selected]) return;
    record();
    const index = selected;
    ops = ops.filter((_, i) => i !== index);
    selected = null;
    renderStage();
    drawOverlay();
    notify();
  }

  function finishDrag() {
    const { start, cur } = drag;
    drag = null;
    const r = norm(start, cur);
    if (tool === 'rect' && r.w >= MIN && r.h >= MIN) {
      pushOp({ type: 'rect', ...r, color, width: sizes().stroke * unit });
    } else if (tool === 'arrow' && Math.hypot(cur.x - start.x, cur.y - start.y) >= MIN * 2) {
      pushOp(arrowOp(start, cur));
    } else if (tool === 'blur' && r.w >= MIN && r.h >= MIN) {
      pushOp({ type: 'blur', ...clampRect(r), block: Math.max(8, Math.round(12 * unit)) });
    } else if (tool === 'crop' && r.w >= MIN * 2 && r.h >= MIN * 2) {
      setCrop(clampRect(r));
    }
    drawOverlay();
  }

  function finishMove() {
    const wasRecorded = drag.recorded;
    drag = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    renderStage();
    drawOverlay();
    if (wasRecorded) notify();
  }

  function addStep(p) {
    pushOp({ type: 'step', x: p.x, y: p.y, r: sizes().step * unit, color });
  }

  function openText(p) {
    const rect = overlay.getBoundingClientRect();
    const f = rect.width / W; // CSS pixels per image pixel
    const px = sizes().text * unit;
    textDraft = { p, px, color };
    textInput.style.left = `${p.x * f}px`;
    textInput.style.top = `${p.y * f}px`;
    textInput.style.fontSize = `${px * f}px`;
    textInput.style.color = color;
    textInput.value = '';
    textInput.hidden = false;
    setTimeout(() => textInput.focus(), 0);
  }
  function commitText() {
    if (!textDraft) return;
    const d = textDraft;
    textDraft = null;
    const text = textInput.value.trim();
    textInput.hidden = true;
    if (text) pushOp({ type: 'text', x: d.p.x, y: d.p.y, text, size: d.px, color: d.color });
  }
  function cancelText() {
    textDraft = null;
    textInput.hidden = true;
  }

  textInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // typing must not trigger tool hotkeys
    if (e.key === 'Enter') {
      e.preventDefault();
      commitText();
    } else if (e.key === 'Escape') {
      cancelText();
    }
  });
  textInput.addEventListener('blur', commitText);

  overlay.addEventListener('pointerdown', (e) => {
    if (!tool || e.button !== 0) return;
    e.preventDefault();
    commitText();
    const p = toPoint(e);
    if (tool === 'step') return addStep(p);
    if (tool === 'text') return openText(p);

    if (tool === 'select') {
      const i = hitIndex(p);
      selected = i >= 0 ? i : null;
      drag = i >= 0 ? { mode: 'move', start: p, index: i, base: ops, recorded: false } : null;
      drawOverlay();
      notify();
      if (!drag) return;
    } else {
      drag = { mode: 'draw', start: p, cur: p };
    }
    try {
      overlay.setPointerCapture(e.pointerId);
    } catch {
      // synthetic or already-released pointer: dragging still works without capture
    }
    drawOverlay();
  });

  overlay.addEventListener('pointermove', (e) => {
    const p = toPoint(e);
    if (!drag) {
      if (tool === 'select') overlay.style.cursor = hitIndex(p) >= 0 ? 'move' : 'default';
      return;
    }
    if (drag.mode === 'move') {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      if (!drag.recorded) {
        if (Math.hypot(dx, dy) < MIN / 2) return; // a click selects; only a real drag moves
        record();
        drag.recorded = true;
      }
      ops = drag.base.map((op, i) => (i === drag.index ? moved(op, dx, dy) : op));
      scheduleRender();
      drawOverlay();
      return;
    }
    drag.cur = p;
    drawOverlay();
  });

  overlay.addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (drag.mode === 'move') return finishMove();
    drag.cur = toPoint(e);
    finishDrag();
  });
  overlay.addEventListener('pointercancel', () => {
    if (drag && drag.mode === 'move') return finishMove();
    drag = null;
    drawOverlay();
  });

  renderStage();
  drawOverlay();

  return {
    subscribe: (fn) => listeners.push(fn),
    setTool(name) {
      commitText();
      drag = null;
      tool = name;
      selected = null;
      overlay.style.pointerEvents = name ? 'auto' : 'none';
      overlay.style.cursor = name === 'text' ? 'text' : name === 'select' ? 'default' : 'crosshair';
      drawOverlay();
      notify();
    },
    setColor(value) {
      color = value;
      if (textDraft) textInput.style.color = value;
      // With something selected, the colour applies to it (blur has no colour).
      if (tool === 'select' && selected !== null && ops[selected] && ops[selected].type !== 'blur') {
        record();
        const index = selected;
        ops = ops.map((op, i) => (i === index ? { ...op, color: value } : op));
        renderStage();
        drawOverlay();
        notify();
      }
    },
    setSize(value) {
      if (EDITOR_SIZES[value]) size = value;
    },
    deleteSelected,
    undo() {
      commitText();
      if (!undoStack.length) return;
      redoStack.push({ ops, crop });
      restore(undoStack.pop());
    },
    redo() {
      if (!redoStack.length) return;
      undoStack.push({ ops, crop });
      restore(redoStack.pop());
    },
    // Plain-JSON snapshot of the edits, for saving; loadState puts it back.
    exportState: () => ({ ops, crop }),
    loadState(state) {
      commitText();
      ops = Array.isArray(state?.ops) ? state.ops : [];
      crop = state?.crop || null;
      undoStack = [];
      redoStack = [];
      selected = null;
      renderStage();
      drawOverlay();
      notify();
    },
    // The canvas to export: the original when untouched, otherwise edits applied and cropped.
    getOutput() {
      commitText();
      const full = ops.length ? stage : base;
      if (!crop) return full;
      const out = document.createElement('canvas');
      out.width = Math.max(1, crop.w);
      out.height = Math.max(1, crop.h);
      out.getContext('2d').drawImage(full, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
      return out;
    },
  };
}

// Wires the toolbar buttons (tools, colours, size, undo/redo, delete) and keyboard shortcuts to an editor.
function bindToolbar(editor) {
  const byId = (id) => document.getElementById(id);
  const toolBtns = [...document.querySelectorAll('.tool[data-tool]')];
  const swatches = [...document.querySelectorAll('.swatch')];
  const sizeBtns = [...document.querySelectorAll('#size button')];
  const undoBtn = byId('undo');
  const redoBtn = byId('redo');
  const deleteBtn = byId('delete');
  let hasSelection = false;

  const select = (name) => {
    editor.setTool(name);
    toolBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === name)));
  };
  toolBtns.forEach((b) =>
    b.addEventListener('click', () => select(b.getAttribute('aria-pressed') === 'true' ? null : b.dataset.tool)),
  );

  swatches.forEach((s) =>
    s.addEventListener('click', () => {
      editor.setColor(s.dataset.color);
      swatches.forEach((o) => o.setAttribute('aria-checked', String(o === s)));
    }),
  );
  sizeBtns.forEach((b) =>
    b.addEventListener('click', () => {
      editor.setSize(b.dataset.size);
      sizeBtns.forEach((o) => o.setAttribute('aria-checked', String(o === b)));
    }),
  );

  undoBtn.addEventListener('click', () => editor.undo());
  redoBtn.addEventListener('click', () => editor.redo());
  deleteBtn.addEventListener('click', () => editor.deleteSelected());
  editor.subscribe((s) => {
    undoBtn.disabled = !s.canUndo;
    redoBtn.disabled = !s.canRedo;
    deleteBtn.disabled = !s.hasSelection;
    hasSelection = s.hasSelection;
  });

  const hotkeys = { v: 'select', c: 'crop', b: 'blur', r: 'rect', a: 'arrow', t: 'text', n: 'step' };
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      editor.redo();
    } else if (!mod && !e.altKey && hotkeys[key]) {
      e.preventDefault();
      select(hotkeys[key]);
    } else if ((key === 'delete' || key === 'backspace') && hasSelection) {
      e.preventDefault();
      editor.deleteSelected();
    } else if (key === 'escape') {
      select(null);
    }
  });
}
