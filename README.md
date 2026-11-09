# Website Screen Snap

A Chrome (Manifest V3) extension for website screenshots: **visible area**, **selected area**, and **full page**. Captures open straight into an editor (crop, blur, arrows, text, numbered steps), then you can copy them, download as PNG/JPG/WebP, or export to PDF.

Made by [Digidaw Studio](https://digidaw.web.id). Current version: **0.1.0**.

🇮🇩 Bahasa Indonesia: [README.id.md](README.id.md)

<p align="center">
  <img src="image/popup.png" alt="Website Screen Snap popup" width="340">
</p>

---

## Background

Taking a screenshot is often a two-step job: capture the image, then open another app to annotate it, hide sensitive data, or crop. Long pages add a third step: stitching several screenshots together by hand.

Website Screen Snap brings that whole flow into the browser:

1. **Capture** a page in three modes (what's visible, a selected area, or the entire page, auto-scrolled and stitched together).
2. **Edit** in the preview tab: crop, pixelate sensitive areas, add arrows, boxes, text, and numbered markers.
3. **Output** the result: copy to clipboard, download as an image, or export to PDF.

A few principles held from the start:

- **Lightweight.** Plain JavaScript, no build step, no dependencies. Even the PDF generator is hand-written (about 90 lines).
- **Minimal permissions.** No access to all sites (no host permissions). The extension only works on the tab you click or trigger with a shortcut.
- **Privacy.** No server, nothing sent over the network. Images, edits, and history stay in your browser.
- **Non-destructive.** The original image is never modified. Edits are stored as layers on top, so they can always be undone, moved, or removed.

---

## Features

### Three capture modes

| Mode | What it captures | How to trigger |
|---|---|---|
| **Visible area** | Exactly what's currently on screen | Popup card, or `Alt+Shift+V` (`⌥⇧V` on Mac) |
| **Selected area** | A rectangle you drag on the page. `Esc` to cancel | Popup card, or `Alt+Shift+S` (`⌥⇧S` on Mac) |
| **Full page** | The whole page: auto-scrolled and stitched into one image | Popup card |

There's also a **delay timer** (Off / 3s / 5s / 10s) in the popup, so dropdown menus, tooltips, or hover states can be opened before the capture. The countdown shows on the extension icon badge, not on the page, so it doesn't end up in the capture.

### Editor in the preview tab

Every capture opens in a preview tab with an editor toolbar.

<p align="center">
  <img src="image/editor.png" alt="Editor in the preview tab" width="900">
</p>

| Tool | Key | Function |
|---|---|---|
| Select | `V` | Select, move, recolor, or delete existing annotations |
| Crop | `C` | Drag the area to keep; the rest is excluded from the result |
| Blur | `B` | Pixelate the dragged area so the text underneath is unreadable |
| Rectangle | `R` | Outline box |
| Arrow | `A` | Arrow from tail to head |
| Text | `T` | Click, type, press Enter |
| Step | `N` | Numbered marker; numbers increment and renumber automatically when one is deleted |

Choose a color (red, indigo, yellow, green, white, black) and size (S/M/L) in the toolbar. **Undo/Redo**: `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`. **Delete** the selected annotation: `Delete`. `Esc` releases the active tool.

> **Blur is pixelation** and permanent once exported. For sensitive data, cover an area slightly larger than the text.

### Output

- **Copy to Clipboard**: always PNG, regardless of the selected format.
- **Download PNG / JPG / WebP**: per the format setting (and quality for JPG/WebP).
- **Download PDF**: a single page sized to the screenshot, so long pages aren't cut off. It contains the image only, so text can't be selected or searched.

All outputs include your latest edits.

### History

The last 10 captures are saved along with their edits, so you can reopen and keep editing even after the preview tab is closed. Open it with the clock icon in the popup.

<p align="center">
  <img src="image/history.png" alt="Capture history page" width="900">
</p>

History can be turned off in Settings, and entries can be deleted one by one or all at once. Data is stored in your browser's IndexedDB and is not sent anywhere.

### Settings

Open with the gear icon in the popup. Changes are saved automatically.

<p align="center">
  <img src="image/setting.png" alt="Settings page" width="900">
</p>

- **Image format**: PNG, JPG, or WebP, plus a quality slider (50 to 100%) for JPG and WebP.
- **Copy to clipboard automatically** and **Download automatically**: run as soon as the preview of a new capture opens. Reopening from history does not trigger them.
- **Save capture history**: turn history on or off.
- **Shortcuts**: shows the keys that are actually registered, with a button to change them.

---

## Installation

This extension isn't on the Chrome Web Store yet, so it's installed from its folder (developer mode). No build or install step is needed.

**Requirements:** Chrome or a Chromium-based browser that supports Manifest V3 (Brave, Edge, and similar), on a version that still receives updates.

1. **Download this project** (clone the repo, or download the ZIP and extract it) so you have a folder containing `manifest.json`.
2. Open the browser's extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked**, then select the project folder (the one containing `manifest.json`, not its parent).
5. **Pin** the extension via the puzzle icon in the toolbar for easy access.

After that, click the **Website Screen Snap** icon or use a shortcut.

### Changing the code or updating

Whenever a file changes, click **Reload** on the extension card in the extensions page, then **refresh the tab** you want to capture so the content script is reloaded.

### Changing shortcuts

Go to **Settings → Shortcuts → Customize** (or directly to `chrome://extensions/shortcuts`). Defaults are `Alt+Shift+S` (selected area) and `Alt+Shift+V` (visible area).

---

## Permissions

| Permission | What it's for |
|---|---|
| `activeTab` | Capturing the active tab after you click the icon or use a shortcut, without broad site access |
| `scripting` | Injecting the content script into the active tab (selection overlay, scrolling, hiding sticky bars) |
| `storage` | Saving settings and the delay choice |
| `clipboardWrite` | Letting auto-copy write to the clipboard without a click |

No host permissions, and no network requests.

---

## How it works

The service worker is the hub: the popup and shortcuts say what to capture, the worker coordinates the page and Chrome's screenshot API, then hands the result to the preview tab.

```
Popup / Shortcut ──▶ Service worker ◀──▶ Content script (inside the website)
                          │
                          ├──▶ chrome.tabs.captureVisibleTab
                          │
                          ▼
                     Preview tab (stitch images, editor, Copy / PNG / PDF)
                          │
                          ▼
                     IndexedDB (history)
```

**Full page** works as a loop: scroll one screen height, wait briefly, hide sticky/fixed elements, capture, repeat until the bottom of the page, then the preview stitches all the slices together. Some details:

- `fixed`/`sticky` elements are rescanned after every scroll, since many sites only turn a header into a fixed bar once scrolled.
- Page height is re-measured at every step, so lazy-loaded content is captured too (limit of 80 slices).
- Web apps whose scrolling happens in an inner element (not `window`) are detected automatically. The header, sidebar, and footer are captured once, then the scroll area is extended.
- Chrome rate-limits `captureVisibleTab` to about twice per second, so each slice takes roughly 0.7 seconds.
- Canvas is capped at 16384 px per side; larger images are scaled down automatically.

### Folder structure

```
manifest.json              MV3 manifest: permissions, popup, options, shortcuts, icons
background.js              Service worker: delay, capture orchestration, handoff to preview
content.js                 Injected into the page: selection overlay, scrolling, hide sticky bars
popup.html / .css / .js    Popup: mode cards, delay, restricted-page check
preview.html / .css / .js  Preview tab: stitch images, toolbar, Copy / Download / PDF
editor.js                  Non-destructive editor (crop, blur, rectangle, arrow, text, step, undo/redo)
pdf.js                     Dependency-free single-page PDF writer
options.html / .css / .js  Settings page
settings.js                Defaults, validation, and settings storage helpers
history.html / .css / .js  History page
history-db.js              IndexedDB history storage (last 10)
ui.css / icons.js          Shared design tokens and inline SVG icons
icons/                     Logo (SVG) and PNG icons at 16, 32, 48, 128 px
image/                     Screenshots for this documentation
design/                    Design references (DESIGN.md and mockups)
```

---

## Known limitations

| Limitation | Impact | Workaround |
|---|---|---|
| Two scroll areas at once (e.g. left and right columns) | Only the largest scroll area is fully captured | Capture each side with Selected area |
| Horizontal scrolling | Content beyond the screen width isn't stitched | None yet |
| Lazy-loaded images | Fast scrolling may capture placeholders | Scroll the page once manually before capturing |
| Restricted pages (`chrome://`, Web Store, some PDF viewers, `file://` without permission) | Capture is disabled or fails | Enable "Allow access to file URLs" for local files |
| Very long pages | Image is scaled down to fit the canvas limit | Use Selected area for the part you need |
| PDF | Contains the image only, text isn't searchable | Use PNG, or add OCR later |
| Blur | Pixelation, permanent once exported | Cover an area slightly larger than the text |
| Switching tabs during the delay countdown | Capture is cancelled, badge shows `ERR` | Stay on the same tab until it finishes |

### Troubleshooting

- **`ERR` badge on the icon:** open the extension card in the extensions page, click **service worker**, and read the console.
- **Nothing happens after changing code:** Reload the extension, then refresh the target tab.
- **Repeated header in a full-page result:** report it along with the site, so sticky element detection can be improved.
- **Auto-copy fails:** the Copy button shows "Copy failed". Details are in the preview tab's console.

---

## Status and roadmap

Version 0.1.0 is early-stage and developed through rapid iteration. Most flows have been tried in the browser, but there are no automated tests in the repo yet.

Ideas for next steps:

- Full-page improvements: multiple scroll areas, horizontal scroll, waiting for lazy-loaded images.
- Paginated PDF (A4) as an alternative to one long page.
- Element capture (hover and click a DOM element).
- Upload and share links (needs a backend).
- Screen recording / GIF.
- Localization (Indonesian and English); the interface is currently in English.

License is not yet determined.
