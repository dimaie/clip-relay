import { base64ToBlob } from './utils.js';

/* -------------------- DOM -------------------- */

const status = document.getElementById('status');
const clips  = document.getElementById('clips');
const refreshBtn = document.getElementById('refreshBtn');

/* -------------------- Socket.IO -------------------- */

const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  status.textContent = 'Connected.';
});

socket.on('disconnect', () => {
  status.textContent = 'Disconnected.';
});

socket.on('clip:new', entry => {
  renderEntry(entry, true);
});

/* -------------------- Events -------------------- */

refreshBtn.addEventListener('click', loadHistory);

/* -------------------- Clipboard policy -------------------- */

const ALLOWED_CLIPBOARD_TYPES = new Set([
  'text/plain',
  'text/html',
  'text/rtf',
  'image/png',
  'image/jpeg'
]);

function isCopyableType(type) {
  return ALLOWED_CLIPBOARD_TYPES.has(type);
}

/* -------------------- Data loading -------------------- */

async function loadHistory() {
  const res = await fetch('/api/clip');
  const all = await res.json();
  clips.innerHTML = '';
  all.slice().reverse().forEach(e => renderEntry(e, false));
}

/* -------------------- Rendering -------------------- */

function renderEntry(entry, prepend) {
  const art = document.createElement('article');

  const ts = new Date(entry.timestamp).toLocaleString();
  const header = document.createElement('div');
  header.innerHTML = `<span class="id">ID ${entry.id}</span> — ${ts}`;
  art.appendChild(header);

  let hasCopyable = false;

  entry.items.forEach((it, idx) => {
    const t = document.createElement('div');
    t.className = 'type';
    t.textContent = it.type;
    art.appendChild(t);

    if (it.type === 'text/html') {
      hasCopyable = true;
      const div = document.createElement('div');
      div.innerHTML = it.data;
      art.appendChild(div);

    } else if (it.type.startsWith('text/')) {
      hasCopyable = true;
      const pre = document.createElement('pre');
      pre.textContent = it.data;
      art.appendChild(pre);

    } else if (it.type.startsWith('image/')) {
      hasCopyable = true;
      const img = document.createElement('img');
      img.src = `data:${it.type};base64,${it.data}`;
      art.appendChild(img);

    } else {
      const pre = document.createElement('pre');
      pre.textContent = `[${it.type}] (binary content)`;
      art.appendChild(pre);

      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn';
      dlBtn.textContent = 'Download';
      dlBtn.addEventListener('click', () => {
        const name = it.name || `clip-${entry.id}-${idx}.bin`;
        downloadBlob(name, it.data, it.type);
      });
      art.appendChild(dlBtn);
    }
  });

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  if (hasCopyable) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn';
    copyBtn.textContent = 'Copy';

    const rowStatus = document.createElement('span');
    rowStatus.className = 'status';

    copyBtn.addEventListener('click', async () => {
      rowStatus.textContent = 'Copying…';
      try {
        await copyEntryToClipboard(entry);
        rowStatus.textContent = 'Copied.';
      } catch (err) {
        console.error(err);
        rowStatus.textContent = 'Copy failed.';
      }
      setTimeout(() => { rowStatus.textContent = ''; }, 2000);
    });

    actions.appendChild(copyBtn);
    actions.appendChild(rowStatus);
  }

  art.appendChild(actions);

  if (prepend) {
    clips.prepend(art);
  } else {
    clips.appendChild(art);
  }
}

/* -------------------- Clipboard write -------------------- */

async function copyEntryToClipboard(entry) {
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      const filteredMap = {};
      let hasAllowed = false;

      for (const it of entry.items) {
        if (!isCopyableType(it.type)) continue;

        if (it.type.startsWith('text/')) {
          filteredMap[it.type] = new Blob(
            [it.data],
            { type: it.type }
          );
          hasAllowed = true;

        } else if (it.type.startsWith('image/')) {
          filteredMap[it.type] = base64ToBlob(it.data, it.type);
          hasAllowed = true;
        }
      }

      if (hasAllowed) {
        const item = new ClipboardItem(filteredMap);
        await navigator.clipboard.write([item]);
        return;
      }
    } catch (err) {
      console.warn(
        'Full-fidelity copy failed, falling back:',
        err
      );
    }
  }

  // fallback
  const htmlItem = entry.items.find(x => x.type === 'text/html');
  const textItem =
    entry.items.find(x => x.type === 'text/plain') ||
    entry.items.find(x => x.type.startsWith('text/'));

  const html = htmlItem ? htmlItem.data : null;
  const text = textItem ? textItem.data : '';

  await legacyCopy(text, html);
}

/* -------------------- Legacy copy -------------------- */

function legacyCopy(text, html) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(html ? 'div' : 'textarea');
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';

    if (html) {
      el.contentEditable = 'true';
      el.innerHTML = html;
      document.body.appendChild(el);

      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      el.value = text || '';
      document.body.appendChild(el);
      el.select();
    }

    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      ok ? resolve() : reject(new Error('execCommand failed'));
    } catch (e) {
      document.body.removeChild(el);
      reject(e);
    }
  });
}

/* -------------------- Download helper -------------------- */

function downloadBlob(filename, base64, mime) {
  const blob = base64ToBlob(base64, mime);
  const url  = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'clip.bin';
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}
