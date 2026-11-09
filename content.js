// Website Screen Snap content script: injected on demand, guarded against double injection.
(() => {
  if (window.__screenSnapLoaded) return;
  window.__screenSnapLoaded = true;

  const doc = document.documentElement;
  let scroller = null; // scrollable element, or null => the window scrolls
  let saved = null; // { target, top, left, behavior } - scroll state to restore
  let hidden = []; // [element, original inline visibility]
  const hiddenSet = new Set();

  // Window scroll is the norm. Many web apps scroll an inner element instead, so detect that case.
  function pickScroller() {
    if (doc.scrollHeight > window.innerHeight + 1) return null;
    let best = null;
    let bestArea = 0;
    for (const node of document.querySelectorAll('body, body *')) {
      if (node.scrollHeight <= node.clientHeight + 1) continue;
      const oy = getComputedStyle(node).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
      const r = node.getBoundingClientRect();
      const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      const area = Math.max(0, w) * Math.max(0, h);
      if (area > bestArea) {
        best = node;
        bestArea = area;
      }
    }
    return bestArea >= 0.3 * window.innerWidth * window.innerHeight ? best : null;
  }

  function scrollInfo() {
    scroller = pickScroller();
    if (!scroller) {
      return {
        viewH: window.innerHeight,
        scrollHeight: doc.scrollHeight,
        scrollWidth: Math.max(doc.scrollWidth, window.innerWidth),
        clip: null,
      };
    }
    const r = scroller.getBoundingClientRect();
    const clip = {
      x: r.left + scroller.clientLeft,
      y: r.top + scroller.clientTop,
      w: scroller.clientWidth,
      h: scroller.clientHeight,
    };
    return { viewH: clip.h, scrollHeight: scroller.scrollHeight, scrollWidth: clip.w, clip };
  }

  // Hide sticky/fixed elements. Incremental: call again after each scroll, because many sites
  // only turn their header into a fixed/sticky bar via JS once the page has scrolled.
  function hideFixedElements() {
    for (const node of document.querySelectorAll('body *')) {
      if (hiddenSet.has(node)) continue;
      if (scroller && (node === scroller || node.contains(scroller))) continue; // keep the scroll area itself
      const pos = getComputedStyle(node).position;
      if (pos === 'fixed' || pos === 'sticky') {
        hiddenSet.add(node);
        hidden.push([node, node.style.visibility]);
        node.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  }

  function scrollTo(y) {
    const target = scroller || doc;
    if (!saved) {
      saved = {
        target,
        top: scroller ? scroller.scrollTop : window.scrollY,
        left: scroller ? scroller.scrollLeft : window.scrollX,
        behavior: target.style.scrollBehavior,
      };
      target.style.scrollBehavior = 'auto';
    }
    if (scroller) scroller.scrollTop = y;
    else window.scrollTo(0, y);
    return {
      y: scroller ? scroller.scrollTop : window.scrollY,
      scrollHeight: scroller ? scroller.scrollHeight : doc.scrollHeight, // can grow with lazy-loading
    };
  }

  function restore() {
    for (const [node, original] of hidden) {
      node.style.removeProperty('visibility');
      if (original) node.style.visibility = original;
    }
    hidden = [];
    hiddenSet.clear();
    if (saved) {
      saved.target.style.scrollBehavior = saved.behavior;
      if (scroller) {
        scroller.scrollTop = saved.top;
        scroller.scrollLeft = saved.left;
      } else {
        window.scrollTo(saved.left, saved.top);
      }
      saved = null;
    }
    scroller = null;
  }

  function el(tag, css) {
    const node = document.createElement(tag);
    node.style.cssText = css;
    return node;
  }

  // Drag-to-select overlay. Resolves with {x, y, w, h} in viewport CSS px, or null when cancelled.
  function selectArea() {
    return new Promise((resolve) => {
      const mono = '"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
      const shade = el('div', 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(10,14,23,.2);user-select:none;');
      const box = el('div', 'position:fixed;display:none;border:1.5px solid #4f46e5;box-shadow:0 0 0 1px rgba(255,255,255,.85),0 0 0 9999px rgba(10,14,23,.55);pointer-events:none;');
      const label = el('div', `position:absolute;left:0;top:100%;margin-top:6px;padding:2px 6px;font:500 11px/14px ${mono};font-feature-settings:"tnum" 1;color:#4cd7f6;background:#0a0e17;border:1px solid #464555;border-radius:4px;white-space:nowrap;`);
      const hint = el('div', 'position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:6px 12px;font:500 12px/16px Inter,system-ui,sans-serif;color:#dfe2ef;background:#1c1f29;border:1px solid #464555;border-radius:8px;box-shadow:0 8px 24px -4px rgba(0,0,0,.45);pointer-events:none;white-space:nowrap;');
      hint.textContent = 'Drag to select · Esc to cancel';
      box.appendChild(label);
      shade.appendChild(box);
      shade.appendChild(hint);
      document.documentElement.appendChild(shade);

      let start = null;

      const draw = (x, y) => {
        const left = Math.min(start.x, x);
        const top = Math.min(start.y, y);
        const w = Math.abs(x - start.x);
        const h = Math.abs(y - start.y);
        Object.assign(box.style, { display: 'block', left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
        label.textContent = `${Math.round(w)} × ${Math.round(h)}`;
      };

      const onDown = (e) => {
        if (e.button !== 0) return;
        start = { x: e.clientX, y: e.clientY };
        hint.style.display = 'none';
        draw(e.clientX, e.clientY);
        e.preventDefault();
      };
      const onMove = (e) => {
        if (start) draw(e.clientX, e.clientY);
      };
      const onUp = (e) => {
        if (!start) return;
        const w = Math.abs(e.clientX - start.x);
        const h = Math.abs(e.clientY - start.y);
        const left = Math.min(start.x, e.clientX);
        const top = Math.min(start.y, e.clientY);
        finish(w >= 2 && h >= 2 ? { x: left, y: top, w, h } : null);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') finish(null);
      };

      function finish(result) {
        window.removeEventListener('mousedown', onDown, true);
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        window.removeEventListener('keydown', onKey, true);
        shade.remove();
        resolve(result);
      }

      window.addEventListener('mousedown', onDown, true);
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
      window.addEventListener('keydown', onKey, true);
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'pageInfo':
        sendResponse({ innerWidth: window.innerWidth, innerHeight: window.innerHeight });
        return false;
      case 'scrollInfo':
        sendResponse(scrollInfo());
        return false;
      case 'scrollTo':
        sendResponse(scrollTo(msg.y));
        return false;
      case 'hideFixed':
        hideFixedElements();
        sendResponse(true);
        return false;
      case 'restore':
        restore();
        sendResponse(true);
        return false;
      case 'selectArea':
        selectArea().then(sendResponse);
        return true; // async response
    }
    return false;
  });
})();
