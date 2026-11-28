// Component: WhatsApp Chat Exporter (Text & Media Archive .zip Generator)
import { db } from '../db.js';
import { Toast } from './toast.js';
import { extractBinaryBytes } from '../utils/backup-archive.js';

export class ChatExporter {
  static formatTimestamp(timestamp) {
    const d = new Date(timestamp);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();

    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;

    return `${day}/${month}/${year}, ${hours}:${minutes} ${ampm}`;
  }

  static async generateChatLogText(chat, messages) {
    const lines = [];

    // Official WhatsApp encryption header
    const firstTs = messages.length > 0 ? messages[0].timestamp : Date.now();
    lines.push(`${this.formatTimestamp(firstTs)} - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.`);

    for (const msg of messages) {
      const ts = this.formatTimestamp(msg.timestamp);
      const sender = msg.sender || (msg.isOutgoing ? (chat.meParticipant || 'You') : chat.name);

      if (msg.isSystem) {
        lines.push(`${ts} - ${msg.text}`);
        continue;
      }

      let replyPrefix = '';
      if (msg.replyTo && (msg.replyTo.sender || msg.replyTo.text || msg.replyTo.mediaType)) {
        const rawRSender = (msg.replyTo.sender === 'You' && chat.meParticipant) ? chat.meParticipant : (msg.replyTo.sender || 'Contact');
        const rSender = String(rawRSender).replace(/[|>\r\n]/g, ' ').trim() || 'Contact';
        const fallbackMediaLabel = msg.replyTo.mediaName || (msg.replyTo.mediaType ? msg.replyTo.mediaType : 'Message');
        const rawSnippet = (msg.replyTo.text && msg.replyTo.text.trim()) ? msg.replyTo.text : fallbackMediaLabel;
        const rSnippet = String(rawSnippet).replace(/[|>\r\n]/g, ' ').trim().slice(0, 120) || 'Message';
        replyPrefix = `<Reply: ${rSender} | ${rSnippet}>\n`;
      }

      const fwdPrefix = msg.isForwarded ? '<Forwarded> ' : '';
      const editedSuffix = msg.isEdited ? ' <This message was edited>' : '';
      const reactSuffix = msg.reaction ? ` <Reaction: ${msg.reaction}>` : '';

      if (msg.mediaName) {
        const caption = (msg.text || '').trim();
        const bodyPart = caption
          ? `${fwdPrefix}${replyPrefix}${msg.mediaName} (file attached)\n${caption}${editedSuffix}${reactSuffix}`
          : `${fwdPrefix}${replyPrefix}${msg.mediaName} (file attached)${editedSuffix}${reactSuffix}`;
        lines.push(`${ts} - ${sender}: ${bodyPart}`);
      } else {
        const bodyText = `${fwdPrefix}${replyPrefix}${msg.text || ''}${editedSuffix}${reactSuffix}`.trim();
        lines.push(`${ts} - ${sender}: ${bodyText}`);
      }
    }

    return lines.join('\n');
  }

  static triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  static async exportWithoutMedia(chatId) {
    Toast.show('Exporting chat without media...');
    await db.init();
    const chat = await db.getChat(chatId);
    if (!chat) return;

    const messages = await db.getMessages(chatId);
    const logText = await this.generateChatLogText(chat, messages);

    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
    const cleanName = (chat.name || 'Chat').replace(/[<>:"/\\|?*]/g, '_');
    this.triggerDownload(blob, `WhatsApp Chat with ${cleanName}.txt`);
    Toast.show('Chat exported successfully');
  }

  static extractInlineEmbedIds(text) {
    if (!text || typeof text !== 'string' || !text.includes('[embed:')) return [];
    const ids = [];
    const seen = new Set();
    const re = /\[embed:(?:image|audio|file|whiteboard):([^:\]\n]+?)(?::[^|\]\n]*)?(?:\|[^\]\n]*)?\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const id = (m[1] || '').trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  }

  static _inferExtension(mimeType = '', filename = '') {
    const dotMatch = String(filename || '').trim().match(/\.([a-zA-Z0-9]{1,8})$/);
    if (dotMatch) return dotMatch[1].toLowerCase();
    const lower = String(mimeType || '').toLowerCase();
    if (lower.includes('png')) return 'png';
    if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
    if (lower.includes('webp')) return 'webp';
    if (lower.includes('gif')) return 'gif';
    if (lower.includes('mp4')) return 'mp4';
    if (lower.includes('webm')) return 'webm';
    if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
    if (lower.includes('wav')) return 'wav';
    if (lower.includes('ogg') || lower.includes('opus')) return 'ogg';
    if (lower.includes('pdf')) return 'pdf';
    return 'bin';
  }

  static async buildChatExportArchive(chatId, fflateLib = (typeof window !== 'undefined' ? window.fflate : undefined)) {
    await db.init();
    const chat = await db.getChat(chatId);
    if (!chat) return null;

    const messages = await db.getMessages(chatId);
    const logText = await this.generateChatLogText(chat, messages);

    if (!fflateLib || typeof fflateLib.zip !== 'function' || typeof fflateLib.strToU8 !== 'function') {
      throw new Error('Archive compression engine (fflate) is unavailable.');
    }

    const filesMap = {};
    filesMap['_chat.txt'] = fflateLib.strToU8(logText);

    // Collect every unique mediaId across both top-level attachments and inline [embed:...] tokens
    const mediaHints = new Map();
    for (const msg of messages) {
      if (msg.mediaId && !mediaHints.has(msg.mediaId)) {
        mediaHints.set(msg.mediaId, {
          mediaName: msg.mediaName || '',
          mediaType: msg.mediaType || 'document',
          isTopLevel: true
        });
      }
      for (const embedId of this.extractInlineEmbedIds(msg.text)) {
        if (!mediaHints.has(embedId)) {
          mediaHints.set(embedId, {
            mediaName: '',
            mediaType: 'image',
            isTopLevel: false
          });
        }
      }
    }

    const mediaIndex = {};
    const usedPaths = new Set(['_chat.txt', 'folio_chat_meta.json']);

    for (const [mediaId, hint] of mediaHints.entries()) {
      try {
        let mediaItem = null;
        if (typeof db.resolveMediaForMessage === 'function') {
          mediaItem = await db.resolveMediaForMessage({
            mediaId,
            chatId,
            mediaName: hint.mediaName,
            mediaType: hint.mediaType
          });
        }
        if (!mediaItem && typeof db.getMedia === 'function') {
          mediaItem = await db.getMedia(mediaId);
        }
        if (!mediaItem) continue;

        const bin = await extractBinaryBytes(mediaItem.bytes || mediaItem.blob, mediaItem.mimeType);
        if (!bin || !bin.bytes || bin.bytes.byteLength === 0) continue;

        const mimeType = mediaItem.mimeType || bin.mimeType || 'application/octet-stream';
        const baseFilename = (hint.mediaName || mediaItem.filename || `${mediaId}.${this._inferExtension(mimeType)}`).replace(/^.*[\\/]/, '');
        let archivePath = (hint.isTopLevel && baseFilename && !usedPaths.has(baseFilename))
          ? baseFilename
          : `folio_media/${String(mediaId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${baseFilename}`;
        while (usedPaths.has(archivePath)) {
          archivePath = `folio_media/${usedPaths.size}_${baseFilename}`;
        }
        usedPaths.add(archivePath);
        filesMap[archivePath] = bin.bytes;

        let thumbArchivePath = null;
        let thumbMimeType = null;
        const thumbBin = await extractBinaryBytes(mediaItem.thumbnailBlob, 'image/jpeg');
        if (thumbBin && thumbBin.bytes && thumbBin.bytes.byteLength > 0) {
          thumbMimeType = thumbBin.mimeType || 'image/jpeg';
          thumbArchivePath = `folio_media/thumbs/${String(mediaId).replace(/[^a-zA-Z0-9_-]/g, '_')}.${this._inferExtension(thumbMimeType)}`;
          usedPaths.add(thumbArchivePath);
          filesMap[thumbArchivePath] = thumbBin.bytes;
        }

        mediaIndex[mediaId] = {
          id: mediaId,
          archivePath,
          thumbArchivePath,
          thumbMimeType,
          filename: mediaItem.filename || baseFilename,
          mimeType,
          type: mediaItem.type || hint.mediaType || 'document',
          size: bin.bytes.byteLength,
          timestamp: mediaItem.timestamp || Date.now(),
          duration: mediaItem.duration || 0,
          width: mediaItem.width,
          height: mediaItem.height
        };
      } catch (e) {
        console.warn('[ChatExporter] Error packing media item:', mediaId, e);
      }
    }

    // Export chat avatar binary if valid
    const { avatarBlob, ...chatRest } = chat;
    const chatCopy = { ...chatRest, avatarBlob: null };
    const avatarBin = await extractBinaryBytes(avatarBlob, 'image/jpeg');
    if (avatarBin && avatarBin.bytes && avatarBin.bytes.byteLength > 0) {
      const avMime = avatarBin.mimeType || 'image/jpeg';
      const avPath = `folio_avatar.${this._inferExtension(avMime)}`;
      filesMap[avPath] = avatarBin.bytes;
      usedPaths.add(avPath);
      chatCopy.avatarArchivePath = avPath;
      chatCopy.avatarMime = avMime;
    }

    // Collect pins, calls, and per-chat settings (theme/wallpaper/priority mode)
    const pins = typeof db.getPinsForChat === 'function' ? await db.getPinsForChat(chatId).catch(() => []) : [];
    const calls = typeof db.getCallsByChat === 'function' ? await db.getCallsByChat(chatId).catch(() => []) : [];
    const chatSettings = [];
    if (db.db && db.db.objectStoreNames.contains('settings')) {
      try {
        const allSettings = await new Promise((resolve) => {
          const tx = db.db.transaction('settings', 'readonly');
          const req = tx.objectStore('settings').getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
        for (let i = 0; i < allSettings.length; i++) {
          const s = allSettings[i];
          if (!s || !s.key || !String(s.key).includes(chatId)) continue;
          const valBin = await extractBinaryBytes(s.value, 'application/octet-stream');
          if (valBin && valBin.bytes && valBin.bytes.byteLength > 0) {
            const settingPath = `folio_settings/s_${i}.${this._inferExtension(valBin.mimeType)}`;
            filesMap[settingPath] = valBin.bytes;
            chatSettings.push({ key: s.key, _archiveBlobFile: settingPath, _archiveBlobMime: valBin.mimeType });
          } else {
            chatSettings.push({ key: s.key, value: s.value });
          }
        }
      } catch (_) {}
    }

    const folioMeta = {
      format: 'folio-chat-v1',
      version: (typeof window !== 'undefined' && window.APP_VERSION) || '3.0.6',
      exportedAt: Date.now(),
      chat: chatCopy,
      messages: messages.map((m) => ({ ...m })),
      mediaIndex,
      pins,
      calls,
      chatSettings
    };

    filesMap['folio_chat_meta.json'] = fflateLib.strToU8(JSON.stringify(folioMeta));

    const zipData = await new Promise((resolve, reject) => {
      fflateLib.zip(filesMap, { level: 6 }, (err, out) => {
        if (err) reject(err);
        else resolve(out);
      });
    });

    const cleanName = (chat.name || 'Chat').replace(/[<>:"/\\|?*]/g, '_');
    const filename = `WhatsApp Chat - ${cleanName}.zip`;
    const blob = typeof Blob !== 'undefined' ? new Blob([zipData], { type: 'application/zip' }) : null;
    return { blob, uint8: zipData, filesMap, meta: folioMeta, filename };
  }

  static async exportWithMedia(chatId) {
    Toast.show('Exporting chat with media...');
    if (typeof window.fflate === 'undefined') {
      console.warn('[ChatExporter] fflate library not available, exporting text only');
      return this.exportWithoutMedia(chatId);
    }
    try {
      const archive = await this.buildChatExportArchive(chatId, window.fflate);
      if (!archive || !archive.blob) return;
      this.triggerDownload(archive.blob, archive.filename);
      Toast.show('Chat exported successfully');
    } catch (err) {
      console.error('[ChatExporter] Zip error:', err);
      Toast.show('Failed to create zip archive');
    }
  }

  static showExportPrompt(chatId) {
    const existing = document.querySelector('.wa-export-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'custom-dialog-overlay wa-export-dialog-overlay active';
    overlay.innerHTML = `
      <div class="custom-dialog-card wa-export-dialog-card" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
        <h3 class="custom-dialog-title" id="export-dialog-title">Export chat</h3>
        <p class="custom-dialog-message">Including media will increase the size of the chat export.</p>
        <div class="wa-export-dialog-actions">
          <button type="button" class="wa-export-action-btn" id="btn-export-no-media">Without media</button>
          <button type="button" class="wa-export-action-btn btn-primary-export" id="btn-export-with-media">Include media</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 200);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#btn-export-no-media').addEventListener('click', () => {
      close();
      this.exportWithoutMedia(chatId);
    });

    overlay.querySelector('#btn-export-with-media').addEventListener('click', () => {
      close();
      this.exportWithMedia(chatId);
    });
  }
}

