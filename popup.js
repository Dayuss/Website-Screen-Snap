const RESTRICTED_URL = /^(chrome|chrome-extension|chrome-untrusted|chrome-search|edge|about|devtools|view-source):/i;
const STORE_URL = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)/i;
const DOCS_URL = 'https://developer.chrome.com/docs/extensions/develop/concepts/activeTab';

const cards = document.querySelectorAll('.card');

// A page is capturable only if we can inject into it, so probe instead of guessing from the URL alone.
async function isRestricted() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return true;
  if (tab.url && (RESTRICTED_URL.test(tab.url) || STORE_URL.test(tab.url))) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => true });
    return false;
  } catch {
    return true;
  }
}

cards.forEach((card) => {
  card.addEventListener('click', () => {
    // Background returns without responding, so this rejects right away; the message is already delivered.
    chrome.runtime
      .sendMessage({ type: 'capture', mode: card.dataset.mode })
      .catch(() => {})
      .finally(() => window.close());
  });
});

document.getElementById('shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});

document.getElementById('docs').addEventListener('click', () => {
  chrome.tabs.create({ url: DOCS_URL });
  window.close();
});

document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;

(async () => {
  const [restricted, commands] = await Promise.all([isRestricted(), chrome.commands.getAll()]);

  // Show the shortcut the user actually has bound (already formatted for the OS, e.g. ⌥⇧S on macOS).
  for (const cmd of commands) {
    const chip = document.querySelector(`[data-command="${cmd.name}"]`);
    if (chip && cmd.shortcut) {
      chip.textContent = cmd.shortcut;
      chip.hidden = false;
    }
  }

  if (restricted) {
    document.body.classList.add('restricted');
    cards.forEach((card) => (card.disabled = true));
  }
})();
