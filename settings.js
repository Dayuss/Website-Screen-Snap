// User settings, shared by the options page and the preview tab. Stored in chrome.storage.local.
const SETTINGS_DEFAULTS = { format: 'png', quality: 92, autoCopy: false, autoDownload: false, saveHistory: true };

const FORMATS = {
  png: { mime: 'image/png', ext: 'png', label: 'PNG' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' },
};

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...SETTINGS_DEFAULTS, ...settings };
  if (!FORMATS[merged.format]) merged.format = SETTINGS_DEFAULTS.format;
  merged.quality = Math.min(100, Math.max(50, Number(merged.quality) || SETTINGS_DEFAULTS.quality));
  merged.autoCopy = merged.autoCopy === true;
  merged.autoDownload = merged.autoDownload === true;
  merged.saveHistory = merged.saveHistory !== false;
  return merged;
}

async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

if (typeof module !== 'undefined') module.exports = { SETTINGS_DEFAULTS, FORMATS, loadSettings, saveSettings };
