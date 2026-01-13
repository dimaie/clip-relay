import { formatBytes } from './utils.js';

const pasteArea = document.getElementById('pasteArea');
const status    = document.getElementById('sendStatus');
const clipDescription = document.getElementById('clipDescription');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');

let sending = false;

uploadBtn.addEventListener('click', () => {
  if (sending) return;
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  if (sending) return;
  clearUI();

  const items = [];
  for (const file of fileInput.files) {
    items.push({
      type: file.type || 'application/octet-stream',
      file,
      name: file.name
    });
  }

  // reset input so selecting the same file again still fires change
  fileInput.value = '';

  await sendItems(items);
});

// ---- event wiring ----
pasteArea.addEventListener('paste', onPaste);
pasteArea.addEventListener('drop', onDrop);
['dragenter','dragover'].forEach(e =>
  pasteArea.addEventListener(e, onDragOver)
);
['dragleave','drop'].forEach(e =>
  pasteArea.addEventListener(e, onDragLeave)
);

// ---- handlers ----
async function onPaste(e) {
  e.preventDefault();
  if (sending) return;
  clearUI();

  const items = await collectFromClipboardData(e.clipboardData);
  await sendItems(items);
}

async function onDrop(e) {
  e.preventDefault();
  if (sending) return;
  clearUI();

  const items = await collectFromDataTransfer(e.dataTransfer);
  await sendItems(items);
}

function onDragOver(e) {
  e.preventDefault();
  pasteArea.classList.add('dragover');
}

function onDragLeave(e) {
  e.preventDefault();
  pasteArea.classList.remove('dragover');
}

// --- Collectors ---
async function collectFromClipboardData(dt) {
  const itemsToSend = [];
  if (dt.items && dt.items.length) {
    for (const item of dt.items) {
      if (item.kind === 'string') {
        const type = item.type || 'text/plain';
        const data = await new Promise(resolve => item.getAsString(resolve));
        itemsToSend.push({ type, data });
      } else if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          itemsToSend.push({ type: file.type, file, name: file.name });
        }
      }
    }
  } else {
    const txt = dt.getData('text/plain');
    if (txt) {
      itemsToSend.push({ type: 'text/plain', data: txt });
    }
  }
  return itemsToSend;
}

async function collectFromDataTransfer(dt) {
  const itemsToSend = [];

  // 1) Handle DataTransfer.items (text drops)
  if (dt.items && dt.items.length) {
    for (const item of dt.items) {
      if (item.kind === 'string') {
        const type = item.type || 'text/plain';
        const data = await new Promise(resolve => item.getAsString(resolve));
        itemsToSend.push({ type, data });
      }
    }
  }

  // 2) Handle files list
  if (dt.files && dt.files.length) {
    for (const file of dt.files) {
      itemsToSend.push({ type: file.type || 'application/octet-stream', file, name: file.name });
    }
  }

  // 3) Last-resort plain text
  if (itemsToSend.length === 0) {
    const txt = dt.getData && dt.getData('text') || '';
    if (txt) {
      itemsToSend.push({ type: 'text/plain', data: txt });
    }
  }

  return itemsToSend;
}

// --- Send ---
async function sendItems(itemsToSend) {
  if (!itemsToSend.length) {
    status.textContent = 'Nothing captured.';
    return;
  }

  sending = true;
  status.textContent = `Sending ${itemsToSend.length} item(s)…`;

  try {
    const files = itemsToSend.filter(i => i.file);   // actual File objects
    const texts = itemsToSend.filter(i => !i.file);  // plain text/html
    const desc = clipDescription.value.trim();

    let res;

    if (files.length) {
      // FormData for files, plus JSON text items
      const form = new FormData();
      form.append('source', location.href);
      if (desc) {
        form.append('description', desc);
      }

      files.forEach(item => form.append('files', item.file, item.name));

      if (texts.length) {
        // embed text items as JSON
        form.append('items', JSON.stringify(texts.map(i => ({
          type: i.type,
          data: i.data,
          name: i.name
        }))));
      }
      res = await fetch('/api/clip', { method: 'POST', body: form });
    } else {
      const payload = {
        items: texts.map(i => ({ type: i.type, data: i.data, name: i.name })),
        meta: { source: location.href }
      };
      if (desc) {
        payload.description = desc;
      }

      res = await fetch('/api/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });    
    }

    const json = await res.json();
    status.textContent = (json && json.ok) ? `Sent. ID=${json.id}` : 'Send failed.';
    clipDescription.value = '';
  } catch (err) {
    console.error(err);
    status.textContent = 'Error sending to server.';
  } finally {
    sending = false;
  }
}

function clearUI() {
  status.textContent = '';
}
