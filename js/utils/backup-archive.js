// Folio Full-Archive (.folio.zip) Export & Restore Utilities
// Handles binary media, chat avatars, IDB settings blobs, and UI preferences cleanly without JSON Blob corruption.

export const BACKUP_LS_KEYS = [
  'wa_theme_mode',
  'wa_app_accent',
  'wa_app_icon_id',
  'wa_outgoing_bubble_color',
  'wa_enter_to_send',
  'folio_selection_rail_mode',
  'wa_recent_stickers',
  'wa_sticker_chat_mru',
  'wa_recent_emojis'
];

export function collectLocalStoragePrefs(ls = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  const prefs = {};
  if (!ls || typeof ls.getItem !== 'function') return prefs;
  for (const key of BACKUP_LS_KEYS) {
    try {
      const val = ls.getItem(key);
      if (val !== null && val !== undefined) {
        prefs[key] = String(val);
      }
    } catch (_) {
      // Ignore storage access restrictions
    }
  }
  return prefs;
}

export function applyLocalStoragePrefs(prefs, ls = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!prefs || typeof prefs !== 'object' || !ls || typeof ls.setItem !== 'function') return false;
  let applied = false;
  for (const key of BACKUP_LS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(prefs, key) && prefs[key] !== null && prefs[key] !== undefined) {
      try {
        ls.setItem(key, String(prefs[key]));
        applied = true;
      } catch (_) {
        // Ignore quota/storage access restrictions
      }
    }
  }
  return applied;
}

export function isValidBlobLike(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof Blob !== 'undefined' && obj instanceof Blob) {
    return obj.size > 0;
  }
  if (typeof obj.arrayBuffer === 'function') {
    return typeof obj.size === 'number' ? obj.size > 0 : true;
  }
  return false;
}

export async function extractBinaryBytes(candidate, fallbackMime = 'application/octet-stream') {
  if (!candidate) return null;
  try {
    if (candidate instanceof Uint8Array) {
      return candidate.byteLength > 0 ? { bytes: candidate, mimeType: fallbackMime } : null;
    }
    if (candidate instanceof ArrayBuffer) {
      return candidate.byteLength > 0 ? { bytes: new Uint8Array(candidate), mimeType: fallbackMime } : null;
    }
    if (ArrayBuffer.isView(candidate)) {
      const bytes = new Uint8Array(candidate.buffer, candidate.byteOffset, candidate.byteLength);
      return bytes.byteLength > 0 ? { bytes, mimeType: fallbackMime } : null;
    }
    if (typeof candidate === 'object' && typeof candidate.arrayBuffer === 'function') {
      const buf = await candidate.arrayBuffer();
      if (buf && buf.byteLength > 0) {
        return {
          bytes: new Uint8Array(buf),
          mimeType: candidate.type || fallbackMime
        };
      }
    }
  } catch (_) {
    // Unreadable or revoked blob handle
  }
  return null;
}

export function uint8ToBase64(u8) {
  if (!(u8 instanceof Uint8Array)) return '';
  if (typeof btoa === 'function') {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < u8.length; i += chunkSize) {
      binary += String.fromCharCode(...u8.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  }
  return '';
}

export function base64ToUint8(b64) {
  if (!b64 || typeof b64 !== 'string') return new Uint8Array(0);
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      u8[i] = bin.charCodeAt(i);
    }
    return u8;
  }
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return new Uint8Array(0);
}

function inferExtensionFromMimeOrName(mimeType = '', filename = '') {
  const nameStr = String(filename || '').trim();
  const dotMatch = nameStr.match(/\.([a-zA-Z0-9]{1,8})$/);
  if (dotMatch) return dotMatch[1].toLowerCase();

  const lower = String(mimeType || '').toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('svg')) return 'svg';
  if (lower.includes('mp4')) return 'mp4';
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('ogg') || lower.includes('opus')) return 'ogg';
  if (lower.includes('pdf')) return 'pdf';
  if (lower.includes('json')) return 'json';
  if (lower.includes('plain')) return 'txt';
  return 'bin';
}

function makeBlobFromBytes(bytes, mimeType = 'application/octet-stream') {
  if (!bytes || bytes.byteLength === 0) return null;
  if (typeof Blob !== 'undefined') {
    return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
  }
  return {
    type: mimeType || 'application/octet-stream',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer
  };
}

function sanitizeSafeSegment(raw = '', fallback = 'item') {
  const cleaned = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return cleaned || fallback;
}

/**
 * Exports the entire Folio workspace (all chats, messages, formatting/embeds/reactions,
 * binary media + thumbnails, calls, filters, settings/wallpapers/avatars, and UI prefs)
 * into a single portable `.folio.zip` archive.
 */
export async function exportFullBackupArchive(dbInstance, fflateLib = (typeof window !== 'undefined' ? window.fflate : undefined)) {
  if (!fflateLib || typeof fflateLib.zip !== 'function' || typeof fflateLib.strToU8 !== 'function') {
    throw new Error('Archive compression engine (fflate) is unavailable.');
  }

  const data = await dbInstance.exportFullBackup();
  const filesMap = {};

  // 1. Pack binary media + thumbnails cleanly outside backup.json
  const serializedMedia = [];
  const mediaList = Array.isArray(data.media) ? data.media : [];
  for (let i = 0; i < mediaList.length; i++) {
    const med = mediaList[i];
    if (!med || !med.id) continue;

    const { blob, bytes, thumbnailBlob, ...restMeta } = med;
    const entry = { ...restMeta };
    const safeId = sanitizeSafeSegment(med.id, `m_${i}`);

    const mainBinary = await extractBinaryBytes(bytes, med.mimeType)
      || await extractBinaryBytes(blob, med.mimeType)
      || (typeof dbInstance.getMedia === 'function'
        ? await dbInstance.getMedia(med.id).then((resolved) => resolved
          ? (extractBinaryBytes(resolved.bytes, resolved.mimeType).then((r) => r || extractBinaryBytes(resolved.blob, resolved.mimeType)))
          : null).catch(() => null)
        : null);

    if (mainBinary && mainBinary.bytes && mainBinary.bytes.byteLength > 0) {
      const resolvedMime = med.mimeType || mainBinary.mimeType || 'application/octet-stream';
      const ext = inferExtensionFromMimeOrName(resolvedMime, med.filename);
      const archiveFile = `media/m_${i}_${safeId}.${ext}`;
      filesMap[archiveFile] = mainBinary.bytes;
      entry._archiveFile = archiveFile;
      entry._archiveMime = resolvedMime;
      entry.mimeType = resolvedMime;
      entry.size = mainBinary.bytes.byteLength;
    }

    const thumbBinary = await extractBinaryBytes(thumbnailBlob, 'image/jpeg');
    if (thumbBinary && thumbBinary.bytes && thumbBinary.bytes.byteLength > 0) {
      const thumbMime = thumbBinary.mimeType || 'image/jpeg';
      const thumbExt = inferExtensionFromMimeOrName(thumbMime, '');
      const archiveThumbFile = `media/t_${i}_${safeId}.${thumbExt}`;
      filesMap[archiveThumbFile] = thumbBinary.bytes;
      entry._archiveThumbFile = archiveThumbFile;
      entry._archiveThumbMime = thumbMime;
    }

    serializedMedia.push(entry);
  }

  // 2. Pack chats (extract binary avatarBlob separately)
  const serializedChats = [];
  for (let i = 0; i < (data.chats || []).length; i++) {
    const chat = data.chats[i];
    if (!chat || !chat.id) continue;
    const { avatarBlob, ...chatRest } = chat;
    const chatEntry = { ...chatRest };
    const avatarBinary = await extractBinaryBytes(avatarBlob, 'image/jpeg');
    if (avatarBinary && avatarBinary.bytes && avatarBinary.bytes.byteLength > 0) {
      const avatarMime = avatarBinary.mimeType || 'image/jpeg';
      const avatarExt = inferExtensionFromMimeOrName(avatarMime, '');
      const archiveAvatarFile = `avatars/c_${i}_${sanitizeSafeSegment(chat.id, 'chat')}.${avatarExt}`;
      filesMap[archiveAvatarFile] = avatarBinary.bytes;
      chatEntry._archiveAvatarFile = archiveAvatarFile;
      chatEntry._archiveAvatarMime = avatarMime;
    } else {
      chatEntry.avatarBlob = null;
    }
    serializedChats.push(chatEntry);
  }

  // 3. Pack IDB settings (extract Blob settings such as custom wallpaper / profile avatar)
  const serializedSettings = [];
  for (let i = 0; i < (data.settings || []).length; i++) {
    const setting = data.settings[i];
    if (!setting || !setting.key) continue;
    const isBinaryVal = isValidBlobLike(setting.value)
      || setting.value instanceof ArrayBuffer
      || ArrayBuffer.isView(setting.value);
    if (isBinaryVal) {
      const valBinary = await extractBinaryBytes(setting.value, 'application/octet-stream');
      if (valBinary && valBinary.bytes && valBinary.bytes.byteLength > 0) {
        const valMime = valBinary.mimeType || 'application/octet-stream';
        const valExt = inferExtensionFromMimeOrName(valMime, '');
        const archiveBlobFile = `settings_blobs/s_${i}_${sanitizeSafeSegment(setting.key, 'setting')}.${valExt}`;
        filesMap[archiveBlobFile] = valBinary.bytes;
        serializedSettings.push({
          key: setting.key,
          _archiveBlobFile: archiveBlobFile,
          _archiveBlobMime: valMime
        });
        continue;
      }
    }
    // Skip corrupted `{}` placeholder objects from old JSON backups on known Blob keys
    if (
      (setting.key === 'userAvatarBlob' || setting.key === 'customWallpaperBlob') &&
      setting.value &&
      typeof setting.value === 'object' &&
      !isValidBlobLike(setting.value) &&
      Object.keys(setting.value).length === 0
    ) {
      continue;
    }
    serializedSettings.push(setting);
  }

  const exportedAt = data.exportedAt || Date.now();
  const manifest = {
    format: 'folio-full-backup-v2',
    version: data.version || (typeof window !== 'undefined' && window.APP_VERSION) || '3.0.6',
    exportedAt,
    chats: serializedChats,
    messages: Array.isArray(data.messages) ? data.messages : [],
    calls: Array.isArray(data.calls) ? data.calls : [],
    filters: Array.isArray(data.filters) ? data.filters : [],
    settings: serializedSettings,
    media: serializedMedia,
    localStoragePrefs: collectLocalStoragePrefs()
  };

  filesMap['backup.json'] = fflateLib.strToU8(JSON.stringify(manifest));

  const zipU8 = await new Promise((resolve, reject) => {
    fflateLib.zip(filesMap, { level: 6 }, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });

  const dateStamp = new Date(exportedAt).toISOString().slice(0, 10);
  const filename = `folio_backup_${dateStamp}_${exportedAt}.folio.zip`;
  const zipBlob = makeBlobFromBytes(zipU8, 'application/zip');

  return {
    blob: zipBlob,
    uint8: zipU8,
    manifest,
    filename,
    stats: {
      chatCount: serializedChats.length,
      messageCount: manifest.messages.length,
      mediaCount: serializedMedia.length
    }
  };
}

function sanitizeJsonRestoredBackup(raw) {
  if (!raw || !Array.isArray(raw.chats) || !Array.isArray(raw.messages)) {
    throw new Error('Invalid backup file structure.');
  }

  const chats = raw.chats.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const copy = { ...c };
    if (copy._avatarBase64) {
      const u8 = base64ToUint8(copy._avatarBase64);
      copy.avatarBlob = u8.byteLength > 0 ? makeBlobFromBytes(u8, copy._avatarMime || 'image/jpeg') : null;
      delete copy._avatarBase64;
      delete copy._avatarMime;
    } else if (copy.avatarBlob && !isValidBlobLike(copy.avatarBlob)) {
      copy.avatarBlob = null;
    }
    return copy;
  });

  const media = (raw.media || []).map((med) => {
    if (!med || typeof med !== 'object') return null;
    const copy = { ...med };
    if (copy._base64) {
      const u8 = base64ToUint8(copy._base64);
      if (u8.byteLength > 0) {
        copy.bytes = u8.slice().buffer;
        copy.blob = makeBlobFromBytes(u8, copy.mimeType || 'application/octet-stream');
        copy.size = u8.byteLength;
      }
      delete copy._base64;
    }
    if (copy._thumbBase64) {
      const tu8 = base64ToUint8(copy._thumbBase64);
      if (tu8.byteLength > 0) {
        copy.thumbnailBlob = makeBlobFromBytes(tu8, copy._thumbMime || 'image/jpeg');
      }
      delete copy._thumbBase64;
      delete copy._thumbMime;
    }
    // Strip dead `{}` objects created when older exports stringified Blobs
    const hasBytes = copy.bytes && (copy.bytes instanceof ArrayBuffer || ArrayBuffer.isView(copy.bytes)) && copy.bytes.byteLength > 0;
    const hasValidBlob = isValidBlobLike(copy.blob);
    if (!hasBytes) {
      delete copy.bytes;
    }
    if (!hasValidBlob) {
      delete copy.blob;
    }
    if (copy.thumbnailBlob && !isValidBlobLike(copy.thumbnailBlob)) {
      delete copy.thumbnailBlob;
    }
    return (hasBytes || hasValidBlob) ? copy : null;
  }).filter(Boolean);

  const settings = (raw.settings || []).filter((s) => {
    if (!s || !s.key) return false;
    if (
      (s.key === 'userAvatarBlob' || s.key === 'customWallpaperBlob') &&
      s.value &&
      typeof s.value === 'object' &&
      !isValidBlobLike(s.value) &&
      !(s.value instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(s.value) &&
      Object.keys(s.value).length === 0
    ) {
      return false;
    }
    return true;
  });

  return {
    ...raw,
    chats,
    messages: raw.messages,
    calls: Array.isArray(raw.calls) ? raw.calls : [],
    filters: Array.isArray(raw.filters) ? raw.filters : [],
    settings,
    media
  };
}

/**
 * Parses either a `.folio.zip` archive or a legacy `.json` backup file into a
 * ready-to-restore dataset (without writing to IndexedDB until confirmed).
 */
export async function parseFullBackupFile(fileOrInput, fflateLib = (typeof window !== 'undefined' ? window.fflate : undefined)) {
  if (!fileOrInput) {
    throw new Error('No backup file provided.');
  }

  if (typeof fileOrInput === 'string') {
    return sanitizeJsonRestoredBackup(JSON.parse(fileOrInput));
  }

  if (
    typeof fileOrInput === 'object' &&
    !(fileOrInput instanceof Uint8Array) &&
    !(fileOrInput instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(fileOrInput) &&
    typeof fileOrInput.arrayBuffer !== 'function' &&
    typeof fileOrInput.text !== 'function'
  ) {
    return sanitizeJsonRestoredBackup(fileOrInput);
  }

  let bytes = null;
  if (fileOrInput instanceof Uint8Array) {
    bytes = fileOrInput;
  } else if (fileOrInput instanceof ArrayBuffer) {
    bytes = new Uint8Array(fileOrInput);
  } else if (ArrayBuffer.isView(fileOrInput)) {
    bytes = new Uint8Array(fileOrInput.buffer, fileOrInput.byteOffset, fileOrInput.byteLength);
  } else if (typeof fileOrInput.arrayBuffer === 'function') {
    bytes = new Uint8Array(await fileOrInput.arrayBuffer());
  }

  const isZip = bytes && bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (!isZip) {
    let text = '';
    if (bytes) {
      text = typeof TextDecoder !== 'undefined'
        ? new TextDecoder().decode(bytes)
        : (fflateLib && typeof fflateLib.strFromU8 === 'function' ? fflateLib.strFromU8(bytes) : '');
    } else if (typeof fileOrInput.text === 'function') {
      text = await fileOrInput.text();
    }
    const parsedJson = JSON.parse(text);
    return sanitizeJsonRestoredBackup(parsedJson);
  }

  if (!fflateLib || typeof fflateLib.unzip !== 'function' || typeof fflateLib.strFromU8 !== 'function') {
    throw new Error('Archive decompression engine (fflate) is unavailable.');
  }

  const unzipped = await new Promise((resolve, reject) => {
    fflateLib.unzip(bytes, (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });

  const keys = Object.keys(unzipped || {});
  const backupKey = keys.find((k) => k === 'backup.json' || k.endsWith('/backup.json'));
  if (!backupKey) {
    const singleChatMeta = keys.find((k) => k === 'folio_chat_meta.json' || k.endsWith('/folio_chat_meta.json') || k.endsWith('.txt'));
    if (singleChatMeta) {
      throw new Error('This looks like a Single-Chat Export archive. Please import it from Chats (+) -> Import Chat.');
    }
    throw new Error('Invalid .folio.zip backup archive: backup.json is missing.');
  }

  const manifest = JSON.parse(fflateLib.strFromU8(unzipped[backupKey]));
  if (!manifest || !Array.isArray(manifest.chats) || !Array.isArray(manifest.messages)) {
    throw new Error('Invalid backup manifest inside archive.');
  }

  const restoredMedia = [];
  for (const med of (manifest.media || [])) {
    if (!med || !med.id) continue;
    const { _archiveFile, _archiveMime, _archiveThumbFile, _archiveThumbMime, ...rest } = med;
    const item = { ...rest };

    if (_archiveFile && unzipped[_archiveFile] && unzipped[_archiveFile].byteLength > 0) {
      const rawU8 = unzipped[_archiveFile];
      const copied = rawU8.slice();
      const mimeType = _archiveMime || item.mimeType || 'application/octet-stream';
      item.mimeType = mimeType;
      item.bytes = copied.buffer;
      item.size = copied.byteLength;
      item.blob = makeBlobFromBytes(copied, mimeType);
    }

    if (_archiveThumbFile && unzipped[_archiveThumbFile] && unzipped[_archiveThumbFile].byteLength > 0) {
      const thumbU8 = unzipped[_archiveThumbFile].slice();
      item.thumbnailBlob = makeBlobFromBytes(thumbU8, _archiveThumbMime || 'image/jpeg');
    }

    restoredMedia.push(item);
  }

  const restoredChats = (manifest.chats || []).map((chat) => {
    if (!chat || typeof chat !== 'object') return chat;
    const { _archiveAvatarFile, _archiveAvatarMime, ...rest } = chat;
    const restored = { ...rest };
    if (_archiveAvatarFile && unzipped[_archiveAvatarFile] && unzipped[_archiveAvatarFile].byteLength > 0) {
      const avU8 = unzipped[_archiveAvatarFile].slice();
      restored.avatarBlob = makeBlobFromBytes(avU8, _archiveAvatarMime || 'image/jpeg');
    } else if (restored.avatarBlob && !isValidBlobLike(restored.avatarBlob)) {
      restored.avatarBlob = null;
    }
    return restored;
  });

  const restoredSettings = (manifest.settings || []).map((setting) => {
    if (!setting || !setting.key) return setting;
    if (setting._archiveBlobFile && unzipped[setting._archiveBlobFile] && unzipped[setting._archiveBlobFile].byteLength > 0) {
      const sU8 = unzipped[setting._archiveBlobFile].slice();
      return {
        key: setting.key,
        value: makeBlobFromBytes(sU8, setting._archiveBlobMime || 'application/octet-stream')
      };
    }
    return setting;
  });

  return {
    ...manifest,
    chats: restoredChats,
    messages: manifest.messages,
    calls: Array.isArray(manifest.calls) ? manifest.calls : [],
    filters: Array.isArray(manifest.filters) ? manifest.filters : [],
    settings: restoredSettings,
    media: restoredMedia
  };
}

export async function applyRestoredBackup(parsedBackup, dbInstance) {
  await dbInstance.restoreFullBackup(parsedBackup);
  if (parsedBackup && parsedBackup.localStoragePrefs) {
    applyLocalStoragePrefs(parsedBackup.localStoragePrefs);
  }
  return true;
}

export async function parseAndRestoreFullBackup(fileOrInput, dbInstance, fflateLib = (typeof window !== 'undefined' ? window.fflate : undefined)) {
  const parsed = await parseFullBackupFile(fileOrInput, fflateLib);
  await applyRestoredBackup(parsed, dbInstance);
  return parsed;
}
