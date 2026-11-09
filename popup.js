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

// Delay (seconds) is persisted; the service worker reads it from storage, so shortcuts honour it too.
const DELAYS = [0, 3, 5, 10];
const segButtons = document.querySelectorAll('.seg button');
let saving = Promise.resolve();

function showDelay(value) {
  segButtons.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.delay) === value)));
}

segButtons.forEach((b) => {
  b.addEventListener('click', () => {
    const value = Number(b.dataset.delay);
    showDelay(value);
    saving = chrome.storage.local.set({ delay: value });
  });
});

chrome.storage.local.get({ delay: 0 }).then(({ delay }) => showDelay(DELAYS.includes(delay) ? delay : 0));

cards.forEach((card) => {
  card.addEventListener('click', () => {
    // Make sure the chosen delay is stored before the worker reads it.
    saving
      .catch(() => {})
      .then(() => chrome.runtime.sendMessage({ type: 'capture', mode: card.dataset.mode }))
      // Background returns without responding, so this rejects right away; the message is already delivered.
      .catch(() => {})
      .finally(() => window.close());
  });
});

document.getElementById('history').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
  window.close();
});

document.getElementById('settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
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
