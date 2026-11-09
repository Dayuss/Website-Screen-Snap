const $ = (id) => document.getElementById(id);
const copyBtn = $('copy');
const copyLabel = $('copy-label');
const downloadBtn = $('download');
const modeChip = $('mode');
const editedChip = $('edited');
const inHistoryChip = $('in-history');
const dimsChip = $('dims');
const scaledChip = $('scaled');
const pdfBtn = $('pdf');
const pdfLabel = $('pdf-label');

const MODE_LABEL = { visible: 'Visible area', selected: 'Selected area', full: 'Full page' };

const MAX_SIDE = 16384; // canvas limit per side in Chrome
const MAX_AREA = 268435456; // total pixel budget (~256 MP)

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode captured image'));
    image.src = src;
  });

// slices: [{ dataUrl, x, y }] placed at page CSS-px coords; out: CSS-px rect to keep.
async function compose({ slices, viewportW, out }) {
  const images = await Promise.all(slices.map((s) => loadImage(s.dataUrl)));
  const srcScale = images[0].naturalWidth / viewportW; // device px per CSS px

  const w = out.w * srcScale;
  const h = out.h * srcScale;
  const fit = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));
  const scale = srcScale * fit;
  const k = fit; // image draw size relative to its native device size

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(out.w * scale));
  canvas.height = Math.max(1, Math.round(out.h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Copy a CSS-px rect from a capture to a CSS-px position on the output canvas.
  const blit = (im, sx, sy, sw, sh, dx, dy) => {
    if (sw <= 0 || sh <= 0) return;
    ctx.drawImage(im, sx * srcScale, sy * srcScale, sw * srcScale, sh * srcScale, dx * scale, dy * scale, sw * scale, sh * scale);
  };

  // Extend a short strip (e.g. a sidebar) downward: each column is filled with its dominant colour,
  // so the background and vertical borders continue without smearing icons or text.
  const extendColumns = (im, sx, sy, sw, sh, dx, dy, dh) => {
    if (sw <= 0 || sh <= 0 || dh <= 0) return;
    const pw = Math.max(1, Math.round(sw * srcScale));
    const ph = Math.max(1, Math.round(sh * srcScale));
    const tmp = document.createElement('canvas');
    tmp.width = pw;
    tmp.height = ph;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(im, sx * srcScale, sy * srcScale, sw * srcScale, sh * srcScale, 0, 0, pw, ph);
    const data = tctx.getImageData(0, 0, pw, ph).data;

    const row = tctx.createImageData(pw, 1);
    for (let x = 0; x < pw; x++) {
      const counts = new Map();
      let best = 0;
      let bestN = 0;
      for (let y = 0; y < ph; y++) {
        const i = (y * pw + x) * 4;
        const key = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
        const n = (counts.get(key) || 0) + 1;
        counts.set(key, n);
        if (n > bestN) {
          bestN = n;
          best = key;
        }
      }
      row.data[x * 4] = best >>> 24;
      row.data[x * 4 + 1] = (best >>> 16) & 255;
      row.data[x * 4 + 2] = (best >>> 8) & 255;
      row.data[x * 4 + 3] = best & 255;
    }

    const rowCanvas = document.createElement('canvas');
    rowCanvas.width = pw;
    rowCanvas.height = 1;
    rowCanvas.getContext('2d').putImageData(row, 0, 0);
    ctx.drawImage(rowCanvas, 0, 0, pw, 1, dx * scale, dy * scale, sw * scale, dh * scale);
  };

  const c = slices[0].clip;
  if (c) {
    // Inner scroll container: page chrome comes from the first capture, scroll area from every slice.
    const first = images[0];
    const viewH = first.naturalHeight / srcScale;
    const bottomH = viewH - c.y - c.h;
    blit(first, 0, 0, viewportW, c.y, 0, 0); // header
    blit(first, 0, c.y, c.x, c.h, 0, c.y); // left sidebar
    blit(first, c.x + c.w, c.y, viewportW - c.x - c.w, c.h, c.x + c.w, c.y); // right sidebar
    // Sidebars are only viewport-tall; extend them down to the footer.
    const growY = c.y + c.h;
    const growH = out.h - bottomH - growY;
    extendColumns(first, 0, c.y, c.x, c.h, 0, growY, growH);
    extendColumns(first, c.x + c.w, c.y, viewportW - c.x - c.w, c.h, c.x + c.w, growY, growH);
    slices.forEach((s, i) => blit(images[i], c.x, c.y, c.w, c.h, c.x, c.y + s.y)); // scroll content
    blit(first, 0, c.y + c.h, viewportW, bottomH, 0, out.h - bottomH); // footer
  } else {
    slices.forEach((s, i) => {
      const im = images[i];
      ctx.drawImage(im, (s.x - out.x) * scale, (s.y - out.y) * scale, im.naturalWidth * k, im.naturalHeight * k);
    });
  }

  return { canvas, width: canvas.width, height: canvas.height, scaled: fit < 1 };
}

function setState(state) {
  $('loading').hidden = state !== 'loading';
  $('error').hidden = state !== 'error';
  $('result').hidden = state !== 'result';
}

function showError(title, detail) {
  $('error-title').textContent = title;
  $('error-detail').textContent = detail;
  setState('error');
}

let copyTimer;
function flashCopy(state, label) {
  copyBtn.dataset.state = state;
  copyLabel.textContent = label;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    delete copyBtn.dataset.state;
    copyLabel.textContent = 'Copy to Clipboard';
  }, 1600);
}

const toBlob = (canvas, mime, quality) => new Promise((resolve) => canvas.toBlob(resolve, mime, quality));

const THUMB_W = 320;
const THUMB_H = 200;

// Thumbnail for the history grid: fit to width and keep the top of tall pages.
function makeThumb(canvas) {
  const thumb = document.createElement('canvas');
  thumb.width = THUMB_W;
  thumb.height = THUMB_H;
  const ctx = thumb.getContext('2d');
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  const scale = THUMB_W / canvas.width;
  const srcH = Math.min(canvas.height, THUMB_H / scale);
  ctx.drawImage(canvas, 0, 0, canvas.width, srcH, 0, 0, THUMB_W, srcH * scale);
  return toBlob(thumb, 'image/jpeg', 0.8);
}

async function blobToCanvas(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function saveToHistory(base, meta) {
  const id = crypto.randomUUID();
  const [blob, thumb] = await Promise.all([toBlob(base, 'image/png'), makeThumb(base)]);
  if (!blob) throw new Error('Could not encode the capture for history');
  await historyAdd({
    id,
    createdAt: Date.now(),
    mode: meta.mode,
    host: meta.host || '',
    title: meta.title || '',
    filename: meta.filename,
    width: base.width,
    height: base.height,
    outW: meta.outW,
    outH: meta.outH,
    base: blob,
    thumb,
    ops: [],
    crop: null,
  });
  return id;
}

// A capture comes either from the service worker (fresh) or from History (?history=<id>).
async function loadCapture() {
  const historyId = new URLSearchParams(location.search).get('history');
  if (historyId) {
    const entry = await historyGet(historyId);
    if (!entry) throw new Error('This capture is no longer in history.');
    return {
      base: await blobToCanvas(entry.base),
      scaled: false,
      entry,
      meta: { mode: entry.mode, filename: entry.filename, outW: entry.outW, outH: entry.outH },
    };
  }

  // Background stores the capture for this tab before/while this page loads, so retry briefly.
  let payload = null;
  for (let attempt = 0; attempt < 30 && !payload; attempt++) {
    payload = await chrome.runtime.sendMessage({ type: 'preview-ready' });
    if (!payload) await new Promise((r) => setTimeout(r, 100));
  }
  if (!payload) return null;

  const { canvas, scaled } = await compose(payload);
  return {
    base: canvas,
    scaled,
    entry: null,
    meta: {
      mode: payload.mode,
      filename: payload.filename,
      outW: payload.out.w,
      outH: payload.out.h,
      host: payload.host,
      title: payload.title,
    },
  };
}

(async () => {
  setState('loading');

  try {
    const capture = await loadCapture();
    if (!capture) {
      showError('No capture found', 'Take a screenshot from the Website Screen Snap popup first, or open one from History.');
      return;
    }
    const { base, scaled, entry, meta } = capture;
    const settings = await loadSettings();
    const fmt = FORMATS[settings.format];
    const pxPerCss = base.width / meta.outW; // device px per CSS px, for editor sizing and PDF page size
    const fileBase = (meta.filename || 'screenshot.png').replace(/\.png$/i, '');

    const editor = createEditor({
      base,
      stage: $('stage'),
      overlay: $('overlay'),
      textInput: $('text-input'),
      unit: pxPerCss,
    });
    bindToolbar(editor);

    const showSize = ({ width, height, dirty }) => {
      dimsChip.textContent = `${Math.round(width)} × ${Math.round(height)} px · ${fmt.label}`;
      editedChip.hidden = !dirty;
    };
    editor.subscribe(showSize);
    if (entry) editor.loadState({ ops: entry.ops, crop: entry.crop });
    else showSize({ width: base.width, height: base.height, dirty: false });

    // ---- history: save fresh captures, and keep saving edits to the entry ----
    let entryId = entry ? entry.id : null;
    let ready = Promise.resolve();
    if (entry) {
      inHistoryChip.hidden = false;
    } else if (settings.saveHistory) {
      ready = saveToHistory(base, meta)
        .then((id) => {
          entryId = id;
          inHistoryChip.hidden = false;
        })
        .catch((err) => console.error('History save failed', err));
    }
    let lastSaved = JSON.stringify(entry ? { ops: entry.ops, crop: entry.crop } : { ops: [], crop: null });
    let persistTimer;
    editor.subscribe(() => {
      if (!entry && !settings.saveHistory) return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(async () => {
        const state = editor.exportState();
        const json = JSON.stringify(state);
        if (json === lastSaved) return; // selection changes etc. are not edits
        await ready;
        if (!entryId) return;
        lastSaved = json;
        historyUpdate(entryId, state).catch((err) => console.error('History update failed', err));
      }, 400);
    });

    modeChip.textContent = MODE_LABEL[meta.mode] || 'Screenshot';
    modeChip.hidden = false;
    dimsChip.hidden = false;
    scaledChip.hidden = !scaled;
    $('dl-label').textContent = `Download ${fmt.label}`;
    $('toolbar').hidden = false;
    setState('result');

    // Every output reads the editor at click time, so edits are always included.
    const download = async () => {
      const blob = await toBlob(editor.getOutput(), fmt.mime, settings.quality / 100);
      if (!blob) throw new Error(`This browser could not encode ${fmt.label}`);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${fileBase}.${fmt.ext}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    };
    downloadBtn.disabled = false;
    downloadBtn.addEventListener('click', () => download().catch((err) => console.error(err)));

    pdfBtn.disabled = false;
    pdfBtn.addEventListener('click', async () => {
      pdfBtn.disabled = true;
      pdfLabel.textContent = 'Building PDF…';
      let label = 'Download PDF';
      try {
        // Page is sized to the screenshot in CSS px, so retina captures stay sharp.
        const out = editor.getOutput();
        const pdf = await buildPdf(out, out.width / pxPerCss, out.height / pxPerCss);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(pdf);
        link.download = `${fileBase}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      } catch (err) {
        console.error(err);
        label = 'PDF failed';
      } finally {
        pdfLabel.textContent = label;
        pdfBtn.disabled = false;
        if (label !== 'Download PDF') setTimeout(() => (pdfLabel.textContent = 'Download PDF'), 1600);
      }
    });

    const copyImage = async () => {
      try {
        // A promise keeps the click's user activation alive while the PNG is encoded.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob(editor.getOutput(), 'image/png') })]);
        flashCopy('ok', 'Copied!');
      } catch (err) {
        console.error(err);
        flashCopy('fail', 'Copy failed');
      }
    };
    copyBtn.disabled = false;
    copyBtn.addEventListener('click', copyImage);

    // Auto actions are for fresh captures only; reopening from History must not copy or download again.
    if (!entry && settings.autoCopy) copyImage();
    if (!entry && settings.autoDownload) download().catch((err) => console.error(err));
  } catch (err) {
    console.error(err);
    showError("Couldn't open the screenshot", err.message);
  }
})();
