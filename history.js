const $ = (id) => document.getElementById(id);
const MODE_LABEL = { visible: 'Visible area', selected: 'Selected area', full: 'Full page' };

function timeAgo(ts) {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(className, icon, label, text) {
  const button = el('button', className);
  button.title = label;
  button.setAttribute('aria-label', label);
  const i = el('i');
  i.dataset.icon = icon;
  button.append(i);
  if (text) button.append(el('span', '', text));
  return button;
}

const openEntry = (id) => {
  location.href = `preview.html?history=${encodeURIComponent(id)}`;
};

// Entry fields come from web pages (hostname, title), so they only ever go in via textContent.
function renderCard(entry, onDelete) {
  const card = el('article', 'card');

  const thumb = el('button', 'thumb');
  thumb.setAttribute('aria-label', `Open capture from ${entry.host || 'a page'}`);
  const img = el('img');
  img.alt = '';
  img.loading = 'lazy';
  if (entry.thumb) img.src = URL.createObjectURL(entry.thumb);
  thumb.append(img);
  thumb.addEventListener('click', () => openEntry(entry.id));

  const body = el('div', 'body');
  const host = el('div', 'host', entry.host || 'Unknown page');
  if (entry.title) host.title = entry.title;

  const meta = el('div', 'meta');
  const mode = el('span', 'chip', MODE_LABEL[entry.mode] || 'Screenshot');
  const dims = el('span', 'chip muted mono', `${entry.width} × ${entry.height}`);
  meta.append(mode, dims);
  if ((entry.ops && entry.ops.length) || entry.crop) meta.append(el('span', 'chip', 'edited'));
  meta.append(el('span', 'time', timeAgo(entry.createdAt)));

  const row = el('div', 'row');
  const open = iconButton('btn primary', 'pencil', 'Open and edit', 'Open');
  open.addEventListener('click', () => openEntry(entry.id));
  const remove = iconButton('btn icon', 'trash', 'Delete this capture');
  remove.addEventListener('click', () => onDelete(entry));
  row.append(open, remove);

  body.append(host, meta, row);
  card.append(thumb, body);
  return card;
}

async function render() {
  const [entries, settings] = await Promise.all([historyList(), loadSettings()]);
  const grid = $('grid');
  grid.textContent = '';

  $('off').hidden = settings.saveHistory;
  $('empty').hidden = entries.length > 0;
  $('clear').hidden = entries.length === 0;
  $('lead').hidden = entries.length === 0;
  $('lead').textContent = `${entries.length} of the last ${HISTORY_LIMIT} captures, newest first.`;

  for (const entry of entries) {
    grid.append(
      renderCard(entry, async (target) => {
        await historyDelete(target.id);
        render();
      }),
    );
  }
  renderIcons(document);
}

$('clear').addEventListener('click', async () => {
  if (!confirm('Delete all saved captures? This cannot be undone.')) return;
  await historyClear();
  render();
});
$('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

render().catch((err) => {
  console.error(err);
  $('empty').hidden = false;
  $('empty').querySelector('p').textContent = `Could not open history: ${err.message}`;
});
