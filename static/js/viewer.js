/* -------------------- DOM -------------------- */

const selectAllCheckbox = document.getElementById('selectAll');
const status = document.getElementById('status');
const clips  = document.getElementById('clips');
const deleteBtn     = document.getElementById('deleteBtn');
const deleteStatus  = document.getElementById('deleteStatus');

const selectedIds = new Set();

deleteBtn.addEventListener('click', async () => {
  if (selectedIds.size === 0) return;

  const ids = Array.from(selectedIds);
  deleteStatus.textContent = 'Deleting…';
  deleteBtn.disabled = true;

  try {
    const res = await fetch('/api/clip', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });

    if (!res.ok) throw new Error('Delete failed');

    for (const id of ids) {
      const el = clips.querySelector(`article[data-id="${id}"]`);
      if (el) el.remove();
      selectedIds.delete(id);
    }

    deleteStatus.textContent = 'Deleted.';
  } catch (err) {
    console.error(err);
    deleteStatus.textContent = 'Delete failed.';
  } finally {
    updateDeleteUI();
    setTimeout(() => { deleteStatus.textContent = ''; }, 2000);
  }
});

function getSelectedIds() {
  selectedIds.clear();
  document.querySelectorAll('#clips article').forEach(art => {
    const id = Number(art.dataset.id);
    const cb = art.querySelector('input[type=checkbox]');
    if (cb.checked) selectedIds.add(id);
  });
}

selectAllCheckbox.addEventListener('change', () => {
  const checked = selectAllCheckbox.checked;
  document.querySelectorAll('#clips article').forEach(art => {
    const id = Number(art.dataset.id);
    const cb = art.querySelector('input[type=checkbox]');
    cb.checked = checked;
    if (checked) selectedIds.add(id);
  });
  updateDeleteUI();
});

/* -------------------- Socket.IO -------------------- */

const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => { status.textContent = 'Connected.'; });
socket.on('disconnect', () => { status.textContent = 'Disconnected.'; });

socket.on('clip:update', data => {
  clips.innerHTML = '';
  data.store.forEach(e => renderEntry(e, false));
  updateSelectAllUI();
  updateDeleteUI();
});

/* -------------------- Clipboard policy -------------------- */

const ALLOWED_CLIPBOARD_TYPES = new Set([
  'text/plain', 'text/html', 'text/rtf', 'image/png', 'image/jpeg'
]);

function isCopyableType(type) {
  return ALLOWED_CLIPBOARD_TYPES.has(type);
}

/* -------------------- Data loading -------------------- */

loadHistory();

async function loadHistory() {
  const res = await fetch('/api/clip');
  const all = await res.json();
  clips.innerHTML = '';
  all.forEach(e => renderEntry(e, false));
  updateSelectAllUI();
  updateDeleteUI();
}

/* -------------------- Rendering -------------------- */
function renderDescription(entry, container) {
  const descItem = entry.items.find(it => it.type === 'text/description');
  if (!descItem) return;

  // wrapper for layout
  const wrapper = document.createElement('div');
  wrapper.className = 'description-wrapper';
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'flex-start';
  wrapper.style.gap = '0.5rem';
  wrapper.style.marginTop = '0.5rem';

  // textarea (read-only initially, so it can receive focus)
  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.id = "descId" + entry.id;
  textarea.className = 'description-box';

  // retrieve description
  if (descItem.data !== undefined) {
    textarea.value = descItem.data;
  } else if (descItem.path) {
    fetch(`/data/${descItem.path}`)
      .then(r => r.text())
      .then(txt => { textarea.value = txt; })
      .catch(() => { textarea.value = '[description unavailable]'; });
  } else {
    textarea.value = '[description unavailable]';
  }

  textarea.readOnly = true; // initially not editable
  wrapper.appendChild(textarea);

  // Edit button
  const editBtn = document.createElement('button');
  editBtn.className = 'btn editDescBtn';
  editBtn.textContent = 'Edit';
  editBtn.disabled = true; // initially disabled
  wrapper.appendChild(editBtn);

  // Enable editing on focus/click
  textarea.addEventListener('focus', () => {
    textarea.readOnly = false;
    editBtn.disabled = false;
  });

  // Submit updated description
  editBtn.addEventListener('click', async () => {
    const newText = textarea.value;
    textarea.readOnly = true;
    editBtn.disabled = true;

    try {
      const res = await fetch(`/api/clip/${entry.id}/description`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText })
      });

      if (!res.ok) throw new Error('Failed to update description');

      // Update in-memory item
      if (descItem) descItem.data = newText;
    } catch (err) {
      console.error(err);
      alert('Failed to save description');
      textarea.readOnly = false;
      editBtn.disabled = false;
    }
  });

  container.appendChild(wrapper);
}

function renderEntry(entry, prepend) {
  const art = document.createElement('article');
  art.dataset.id = entry.id;

  const header = document.createElement('div');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.addEventListener('change', () => {
    if (cb.checked) selectedIds.add(entry.id);
    else selectedIds.delete(entry.id);
    updateSelectAllUI();
    updateDeleteUI();
  });

  const ts = new Date(entry.timestamp).toLocaleString();
  header.appendChild(cb);
  header.insertAdjacentHTML('beforeend', ` <span class="id">ID ${entry.id}</span> — ${ts}`);
  art.appendChild(header);

  let hasCopyable = false;

  entry.items.forEach((it, idx) => {
    const t = document.createElement('div');
    t.className = 'type';
    t.textContent = it.type;
    art.appendChild(t);

    if (it.type === 'text/description') {
      renderDescription(entry, art);
    } else if (it.type === 'text/html') {
      hasCopyable = true;
      const div = document.createElement('div');
      if (it.data !== undefined) {
        div.innerHTML = it.data;
      } else if (it.path) {
        fetch(`/data/${it.path}`)
          .then(r => r.text())
          .then(txt => { div.innerHTML = txt; })
          .catch(() => { div.textContent = '[content unavailable]'; });
      }
      art.appendChild(div);

    } else if (it.type.startsWith('text/')) {
      hasCopyable = true;
      const pre = document.createElement('pre');
      if (it.data !== undefined) {
        pre.textContent = it.data;
      } else if (it.path) {
        fetch(`/data/${it.path}`)
          .then(r => r.text())
          .then(txt => { pre.textContent = txt; })
          .catch(() => { pre.textContent = '[content unavailable]'; });
      } else {
        pre.textContent = '[content unavailable]';
      }
      art.appendChild(pre);

    } else if (it.type.startsWith('image/')) {
      hasCopyable = true;
      const img = document.createElement('img');
      if (it.path) img.src = `/data/${it.path}`;
      else img.src = `[image missing]`;
      art.appendChild(img);

    } else {
      const pre = document.createElement('pre');
      pre.textContent = `[${it.type}], ${it.name} (binary content)`;
      art.appendChild(pre);

      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn';
      dlBtn.textContent = 'Download';
      dlBtn.addEventListener('click', () => {
        const url = `/data/${it.path}`;
        const form = document.createElement('form');
        form.method = 'GET';
        form.action = url;
        document.body.appendChild(form);
        form.submit();
        form.remove();
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

  if (prepend) clips.prepend(art);
  else clips.appendChild(art);
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
          if (it.data !== undefined) filteredMap[it.type] = new Blob([it.data], { type: it.type });
          else if (it.path) {
            const txt = await fetch(`/data/${it.path}`).then(r => r.text());
            filteredMap[it.type] = new Blob([txt], { type: it.type });
          }
          hasAllowed = true;
        } else if (it.type.startsWith('image/')) {
          if (it.path) {
            const blob = await fetch(`/data/${it.path}`).then(r => r.blob());
            filteredMap[it.type] = blob;
          }
          hasAllowed = true;
        }
      }
      if (hasAllowed) {
        await navigator.clipboard.write([new ClipboardItem(filteredMap)]);
        return;
      }
    } catch (err) {
      console.warn('Full-fidelity copy failed, falling back:', err);
    }
  }

  // fallback
  const htmlItem = entry.items.find(x => x.type === 'text/html');
  const textItem = entry.items.find(x => x.type === 'text/plain') || entry.items.find(x => x.type.startsWith('text/'));
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

/* -------------------- Helpers -------------------- */

function updateDeleteUI() {
  getSelectedIds();
  deleteBtn.disabled = selectedIds.size === 0;
}

function updateSelectAllUI() {
  const all = document.querySelectorAll('#clips article input[type=checkbox]');
  const checked = document.querySelectorAll('#clips article input[type=checkbox]:checked');
  selectAllCheckbox.checked = all.length > 0 && all.length === checked.length;
}
