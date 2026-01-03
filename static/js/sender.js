import { arrayBufferToBase64, formatBytes } from './utils.js';

const pasteArea = document.getElementById('pasteArea');
const status    = document.getElementById('sendStatus');
const preview   = document.getElementById('preview');

let sending = false;

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
      // Prefer items API (kind: string/file)
      if (dt.items && dt.items.length) {
        for (const item of dt.items) {
          if (item.kind === 'string') {
            const type = item.type || 'text/plain';
            const data = await new Promise(resolve => item.getAsString(resolve));
            itemsToSend.push({ type, data });
            renderPreview({ type, data });
          } else if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
              const type = file.type || 'application/octet-stream';
              const buf  = await file.arrayBuffer();
              const b64  = arrayBufferToBase64(buf);
              itemsToSend.push({ type, data: b64, name: file.name });
              renderPreview({ type, data: `[${type}] ${file.name} (${formatBytes(file.size)})`, file });
            }
          }
        }
      } else {
        // Fallback—older APIs: just get plain text
        const txt = dt.getData('text/plain');
        if (txt) {
          itemsToSend.push({ type: 'text/plain', data: txt });
          renderPreview({ type: 'text/plain', data: txt });
        }
      }
      return itemsToSend;
    }

    async function collectFromDataTransfer(dt) {
      const itemsToSend = [];

      // 1) Handle DataTransfer.items (text drops, etc.)
      if (dt.items && dt.items.length) {
        for (const item of dt.items) {
          if (item.kind === 'string') {
            // Most browsers expose only text/plain here
            const type = item.type || 'text/plain';
            const data = await new Promise(resolve => item.getAsString(resolve));
            itemsToSend.push({ type, data });
            renderPreview({ type, data });
          }
        }
      }

      // 2) Handle files list
      if (dt.files && dt.files.length) {
        for (const file of dt.files) {
          const type = file.type || 'application/octet-stream';
          const buf  = await file.arrayBuffer();
          const b64  = arrayBufferToBase64(buf);
          itemsToSend.push({ type, data: b64, name: file.name });
          renderPreview({ type, data: `[${type}] ${file.name} (${formatBytes(file.size)})`, file });
        }
      }

      // If nothing captured, try a last-resort plain text
      if (itemsToSend.length === 0) {
        const txt = dt.getData && dt.getData('text') || '';
        if (txt) {
          itemsToSend.push({ type: 'text/plain', data: txt });
          renderPreview({ type: 'text/plain', data: txt });
        }
      }

      return itemsToSend;
    }

    // --- Send ---
    async function sendItems(itemsToSend) {
      if (!itemsToSend.length) { status.textContent = 'Nothing captured.'; return; }
      try {
        sending = true;
        status.textContent = `Sending ${itemsToSend.length} item(s)…`;
        const res = await fetch('/api/clip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: itemsToSend, meta: { source: location.href } })
        });
        const json = await res.json();
        status.textContent = (json && json.ok) ? `Sent. ID=${json.id}` : 'Send failed.';
      } catch (err) {
        console.error(err);
        status.textContent = 'Error sending to server.';
      } finally {
        sending = false;
      }
    }

    // --- Preview ---
    function renderPreview(item) {
      if (item.type === 'text/html') {
        const div = document.createElement('div');
        div.innerHTML = item.data;
        preview.appendChild(div);
      } else if (item.type.startsWith('text/')) {
        const pre = document.createElement('pre');
        pre.textContent = item.data;
        preview.appendChild(pre);
      } else if (item.type.startsWith('image/')) {
        // show image preview (paste) or from dropped file
        const img = document.createElement('img');
        if (item.file) {
          img.src = URL.createObjectURL(item.file);
        } else {
          // if image arrived as base64 from clipboard
          img.src = `data:${item.type};base64,${item.data}`;
        }
        preview.appendChild(img);
      } else {
        const pre = document.createElement('pre');
        pre.className = 'file-line';
        pre.textContent = item.data; // "[mime] name (size)"
        preview.appendChild(pre);
      }
    }

    function clearUI() {
      preview.innerHTML = '';
      status.textContent = '';
    }

