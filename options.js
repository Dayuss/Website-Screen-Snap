const $ = (id) => document.getElementById(id);
const formatButtons = document.querySelectorAll('#format button');
const SWITCHES = ['autoCopy', 'autoDownload', 'saveHistory'];

let settings = { ...SETTINGS_DEFAULTS };
let savedTimer;

function render() {
  formatButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.format === settings.format)));
  $('quality-row').hidden = settings.format === 'png';
  $('quality').value = settings.quality;
  $('quality-value').textContent = `${settings.quality}%`;
  SWITCHES.forEach((key) => $(key).setAttribute('aria-checked', String(settings[key])));
}

function flashSaved() {
  const el = $('saved');
  el.textContent = '✓ Saved';
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

async function update(patch) {
  settings = { ...settings, ...patch }; // reflect the change right away
  render();
  settings = await saveSettings(patch);
  render();
  flashSaved();
}

formatButtons.forEach((b) => b.addEventListener('click', () => update({ format: b.dataset.format })));

SWITCHES.forEach((key) => $(key).addEventListener('click', () => update({ [key]: !settings[key] })));

$('quality').addEventListener('input', (e) => ($('quality-value').textContent = `${e.target.value}%`));
$('quality').addEventListener('change', (e) => update({ quality: Number(e.target.value) }));

$('customize').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

const COMMAND_LABELS = { 'capture-selected': 'Selected area', 'capture-visible': 'Visible area' };

async function renderShortcuts() {
  const commands = await chrome.commands.getAll();
  const list = $('keys');
  list.textContent = '';
  for (const cmd of commands) {
    const label = COMMAND_LABELS[cmd.name];
    if (!label) continue;
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = label;
    const key = document.createElement('kbd');
    key.className = 'kbd';
    key.textContent = cmd.shortcut || 'Not set';
    item.append(name, key);
    list.append(item);
  }
}

async function renderHistoryCount() {
  try {
    const count = (await historyList()).length;
    $('history-count').textContent = count === 0 ? 'Nothing saved yet.' : `${count} of the last ${HISTORY_LIMIT} captures are saved.`;
    $('clear-history').disabled = count === 0;
  } catch (err) {
    console.error(err);
    $('history-count').textContent = 'History is unavailable in this browser profile.';
  }
}

$('open-history').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('history.html') }));
$('clear-history').addEventListener('click', async () => {
  if (!confirm('Delete all saved captures? This cannot be undone.')) return;
  await historyClear();
  renderHistoryCount();
});

$('version').textContent = `v${chrome.runtime.getManifest().version}`;

(async () => {
  settings = await loadSettings();
  render();
  renderShortcuts();
  renderHistoryCount();
})();
