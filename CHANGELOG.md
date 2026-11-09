# Changelog

All notable changes to Website Screen Snap are documented here.

## [Unreleased] - 2026-11-09

Commit: `5399946` update some feature

### Added
- **Annotation editor** in the preview tab (`editor.js`): crop, blur (pixelate), rectangle, arrow, text, and numbered step markers, with undo/redo and color/size options.
- **Capture history** (`history.html`, `history.js`, `history-db.js`): captures and their edits are stored locally and can be reopened. Accessible via the History icon in the popup.
- **Settings page** (`options.html`, `options.js`, `settings.js`) for configuring output format and quality.
- **Capture delay timer** in the popup (Off / 3s / 5s / 10s) so dropdowns, tooltips, or hover states can be opened before capture.
- **Copy to Clipboard** from the preview.
- Full documentation in `README.md` with screenshots (popup, editor, history, settings).

### Changed
- Popup: the Keyboard shortcuts button was replaced by two buttons, **History** and **Settings**.
- Preview UI (`preview.html`, `preview.css`, `preview.js`) reworked to accommodate the editor toolbar and export options.
- `background.js`, `popup.js`, `icons.js`, `ui.css`, and `popup.css` updated to support the new features.

### Permissions
- Added `storage` (settings and history) and `clipboardWrite` (copy to clipboard) permissions.
- Added `options_ui` (Settings page opens in a new tab).

## [0.1.0] - 2026-11-09

Commit: `333916b` (labeled "v1.0.0" in the commit message)

### Added
- Initial release: **visible area**, **selected area**, and **full page** capture.
- Capture preview and PDF export (custom PDF generator in `pdf.js`).
- Extension popup, icons, and logo.
- Keyboard shortcuts for capture.
