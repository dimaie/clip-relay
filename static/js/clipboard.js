import { arrayBufferToBase64 } from './utils.js';

export async function collectFromClipboardData(dt, renderPreview) {
  const itemsToSend = [];

  if (dt.items?.length) {
    for (const item of dt.items) {
      if (item.kind === 'string') {
        const type = item.type || 'text/plain';
        const data = await new Promise(r => item.getAsString(r));
        itemsToSend.push({ type, data });
        renderPreview?.({ type, data });
      } else if (item.kind === 'file') {
        const file = item.getAsFile();
        if (!file) continue;
        const buf = await file.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        itemsToSend.push({ type: file.type, data: b64, name: file.name });
        renderPreview?.({ type: file.type, file });
      }
    }
  }
  return itemsToSend;
}
