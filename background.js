// Website Screen Snap service worker: orchestrates captures. Image composition happens in preview.html.

const CAPTURE_INTERVAL_MS = 700; // captureVisibleTab is rate-limited (~2 calls/sec)
const SETTLE_MS = 300; // time for scroll handlers / lazy content to react before we hide sticky bars
const MAX_SLICES = 80; // safety cap for infinite-scroll pages
const pendingPreviews = new Map(); // preview tab id -> payload

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sendToTab = (tabId, message) => chrome.tabs.sendMessage(tabId, message);

async function captureViewport(windowId) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (err) {
      // Retry when the per-second capture quota is hit.
      if (attempt >= 2 || !/quota/i.test(String(err?.message))) throw err;
      await sleep(1000);
    }
  }
}

function makeFilename(url, mode) {
  let host = 'page';
  try {
    host = new URL(url).hostname || 'page';
  } catch {
    // url unavailable (no "tabs" permission) - keep fallback
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `screenshot-${mode}-${host}-${ts}.png`;
}

async function captureFullPage(tab, pageInfo) {
  const info = await sendToTab(tab.id, { type: 'scrollInfo' });
  const slices = [];
  let contentH = info.scrollHeight;
  let y = 0;
  let prevY = -1;

  try {
    for (let i = 0; i < MAX_SLICES; i++) {
      const res = await sendToTab(tab.id, { type: 'scrollTo', y });
      if (i > 0 && res.y <= prevY) break; // scroll made no progress
      contentH = res.scrollHeight; // may grow while lazy-loading

      await sleep(SETTLE_MS);
      // Re-scan after every scroll: headers that become fixed/sticky only once scrolled are caught here.
      if (res.y > 0) await sendToTab(tab.id, { type: 'hideFixed' });
      await sleep(CAPTURE_INTERVAL_MS - SETTLE_MS);

      const dataUrl = await captureViewport(tab.windowId);
      slices.push({ dataUrl, x: 0, y: res.y, clip: info.clip });
      prevY = res.y;

      if (res.y + info.viewH >= contentH - 1) break; // reached the bottom
      y = Math.min(res.y + info.viewH, contentH - info.viewH);
    }
  } finally {
    await sendToTab(tab.id, { type: 'restore' }).catch(() => {});
  }

  // Inner scroller: the page chrome (header/sidebar/footer) is kept once, and only the scroll area grows.
  const out = info.clip
    ? { x: 0, y: 0, w: pageInfo.innerWidth, h: pageInfo.innerHeight + contentH - info.clip.h }
    : { x: 0, y: 0, w: info.scrollWidth, h: contentH };

  return { slices, viewportW: pageInfo.innerWidth, out };
}

async function capture(mode) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab');

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  const info = await sendToTab(tab.id, { type: 'pageInfo' });

  let payload;
  if (mode === 'visible') {
    const dataUrl = await captureViewport(tab.windowId);
    payload = {
      slices: [{ dataUrl, x: 0, y: 0 }],
      viewportW: info.innerWidth,
      out: { x: 0, y: 0, w: info.innerWidth, h: info.innerHeight },
    };
  } else if (mode === 'selected') {
    const rect = await sendToTab(tab.id, { type: 'selectArea' });
    if (!rect) return; // cancelled with Esc or too small
    await sleep(80); // let the overlay leave the screen before capturing
    const dataUrl = await captureViewport(tab.windowId);
    payload = {
      slices: [{ dataUrl, x: 0, y: 0 }],
      viewportW: info.innerWidth,
      out: rect,
    };
  } else if (mode === 'full') {
    payload = await captureFullPage(tab, info);
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }

  payload.mode = mode;
  payload.filename = makeFilename(tab.url, mode);
  const previewTab = await chrome.tabs.create({ url: chrome.runtime.getURL('preview.html') });
  pendingPreviews.set(previewTab.id, payload);
}

function run(mode) {
  capture(mode).catch((err) => {
    console.error('[Website Screen Snap]', err);
    chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    chrome.action.setBadgeText({ text: 'ERR' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'capture') {
    run(msg.mode);
    return false; // no response; popup closes
  }
  if (msg.type === 'preview-ready') {
    const id = sender.tab?.id;
    const payload = pendingPreviews.get(id) ?? null;
    if (payload) pendingPreviews.delete(id);
    sendResponse(payload);
    return false;
  }
  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-selected') run('selected');
  if (command === 'capture-visible') run('visible');
});
