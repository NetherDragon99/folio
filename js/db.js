// IndexedDB Storage Layer for Folio
import { storageBackup } from './utils/storage-backup.js';
import { assetUrl } from './config/base-path.js';

const DB_NAME = 'WhatsAppCloneDB';
const DB_VERSION = 1;
const USER_MEDIA_CACHE_NAME = 'folio-user-media-v1';

class Database {
  constructor() {
    this.db = null;
    this.initPromise = null;
    this._callsBackfillChecked = false;
    this._isBackfillingCalls = false;
    this._missingMediaMisses = new Set();
    this._demoZipEntriesPromise = null;
    this._legacyMediaMigrated = false;
  }

  generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'uuid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  async init() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Chats store
        if (!db.objectStoreNames.contains('chats')) {
          const chatStore = db.createObjectStore('chats', { keyPath: 'id' });
          chatStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          chatStore.createIndex('isPinned', 'isPinned', { unique: false });
          chatStore.createIndex('isArchived', 'isArchived', { unique: false });
          chatStore.createIndex('isLocked', 'isLocked', { unique: false });
        }

        // Messages store
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('chatId', 'chatId', { unique: false });
          msgStore.createIndex('timestamp', 'timestamp', { unique: false });
          msgStore.createIndex('chat_time', ['chatId', 'timestamp'], { unique: false });
        }

        // Media blobs store
        if (!db.objectStoreNames.contains('media')) {
          const mediaStore = db.createObjectStore('media', { keyPath: 'id' });
          mediaStore.createIndex('chatId', 'chatId', { unique: false });
          mediaStore.createIndex('filename', 'filename', { unique: false });
        }

        // Calls history store
        if (!db.objectStoreNames.contains('calls')) {
          const callStore = db.createObjectStore('calls', { keyPath: 'id' });
          callStore.createIndex('chatId', 'chatId', { unique: false });
          callStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Custom filter lists store
        if (!db.objectStoreNames.contains('filters')) {
          db.createObjectStore('filters', { keyPath: 'id' });
        }

        // Settings key-value store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.db.onversionchange = () => {
          console.warn('[DB] Database version change detected, closing connection');
          if (this.db) {
            this.db.close();
            this.db = null;
          }
          this.initPromise = null;
        };
        this.db.onclose = () => {
          this.db = null;
          this.initPromise = null;
        };
        storageBackup.ensurePersistence().catch(() => { });
        resolve(this.db);
      };

      request.onerror = (event) => {
        this.initPromise = null;
        reject(event.target.error);
      };

      request.onblocked = () => {
        console.warn('[DB] Database open blocked by another open connection');
      };
    });

    return this.initPromise;
  }

  // --- Chats CRUD ---
  async getChats() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chats', 'readonly');
      const store = tx.objectStore('chats');
      const request = store.getAll();
      request.onsuccess = () => {
        const chats = request.result || [];
        chats.sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        resolve(chats);
      };
      request.onerror = () => reject(tx.error);
    });
  }

  async getChat(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chats', 'readonly');
      const store = tx.objectStore('chats');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(tx.error);
    });
  }

  async saveChat(chat) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chats', 'readwrite');
      const store = tx.objectStore('chats');
      store.put(chat);
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(chat);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async updateChat(id, updates) {
    await this.init();
    const chat = await this.getChat(id);
    if (!chat) return null;
    const updated = { ...chat, ...updates };
    return this.saveChat(updated);
  }

  async swapChatPerspective(chatId, { signal } = {}) {
    if (signal?.aborted) return null;
    await this.init();
    if (signal?.aborted) return null;

    const chat = await this.getChat(chatId);
    if (!chat || signal?.aborted) return null;

    const ownerName = await this.getSetting('ownerName', 'You');
    const userProfileAvatar = await this.getSetting('userProfileAvatar', null);

    const currentChatName = chat.name || 'Contact';
    const currentChatAvatar = chat.avatarBlob || null;
    let currentMeName = chat.meParticipant || ownerName || 'Me';

    let newChatName = currentMeName;
    let newMeName = currentChatName;

    if (chat.participantNames && chat.participantNames.length === 2) {
      const p1 = chat.participantNames[0];
      const p2 = chat.participantNames[1];
      if (currentChatName.trim().toLowerCase() === p1.trim().toLowerCase()) {
        newChatName = p2;
        newMeName = p1;
      } else if (currentChatName.trim().toLowerCase() === p2.trim().toLowerCase()) {
        newChatName = p1;
        newMeName = p2;
      }
    }

    if (signal?.aborted) return null;

    // Avatar swap between chat contact and user profile
    const newChatAvatar = userProfileAvatar;
    const newUserAvatar = currentChatAvatar;

    // Flip all messages
    const msgs = await this.getMessages(chatId);
    if (signal?.aborted) return null;

    // Yield in chunks to keep UI responsive and allow user to cancel
    const chunkSize = 150;
    for (let i = 0; i < msgs.length; i++) {
      if (signal?.aborted) return null;
      if (i > 0 && i % chunkSize === 0) {
        await new Promise((r) => setTimeout(r, 0));
        if (signal?.aborted) return null;
      }
      const m = msgs[i];
      if (!m.isSystem) {
        m.isOutgoing = !m.isOutgoing;
        if (m.sender === currentChatName) {
          m.sender = newChatName;
        } else if (m.sender === currentMeName) {
          m.sender = newMeName;
        }
        if (m.replyTo && m.replyTo.sender) {
          const rSender = m.replyTo.sender;
          if (rSender === currentChatName) {
            m.replyTo.sender = !chat.isGroup ? 'You' : newMeName;
          } else if (rSender === 'You' || rSender === currentMeName) {
            m.replyTo.sender = newChatName;
          }
        }
      }
    }

    if (signal?.aborted) return null;

    await this.saveMessages(msgs);
    if (signal?.aborted) return null;

    // Flip calls
    try {
      const calls = await this.getCallsByChat(chatId);
      if (calls && calls.length > 0) {
        for (const c of calls) {
          c.contactName = newChatName;
        }
        await this.saveCallsBatch(calls);
      }
    } catch (callErr) {
      console.warn('[DB] Error updating calls during perspective swap:', callErr);
    }

    if (signal?.aborted) return null;

    // Update chat metadata
    chat.name = newChatName;
    chat.avatarBlob = newChatAvatar;
    chat.meParticipant = newMeName;
    chat.isOutgoingDefault = !(chat.isOutgoingDefault ?? true);
    if (chat.lastMessage && typeof chat.lastMessage === 'object') {
      chat.lastMessage.isOutgoing = !chat.lastMessage.isOutgoing;
    }
    await this.saveChat(chat);

    // Update owner settings
    await this.setSetting('ownerName', newMeName);
    await this.setSetting('userProfileAvatar', newUserAvatar);

    return chat;
  }

  async deleteChat(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['chats', 'messages', 'media', 'calls'], 'readwrite');

      // Delete chat record
      tx.objectStore('chats').delete(id);

      // Delete associated messages
      const msgStore = tx.objectStore('messages');
      const msgIndex = msgStore.index('chatId');
      const msgCursor = msgIndex.openCursor(IDBKeyRange.only(id));
      msgCursor.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      // Delete associated media
      const mediaStore = tx.objectStore('media');
      const mediaIndex = mediaStore.index('chatId');
      const mediaCursor = mediaIndex.openCursor(IDBKeyRange.only(id));
      mediaCursor.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      // Delete associated calls
      const callStore = tx.objectStore('calls');
      const callIndex = callStore.index('chatId');
      const callCursor = callIndex.openCursor(IDBKeyRange.only(id));
      callCursor.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Messages CRUD ---
  async getMessages(chatId, options = {}) {
    await this.init();
    const { limit = 0, beforeTimestamp = null, afterTimestamp = null } = options;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('chat_time');

      let range = null;
      if (beforeTimestamp !== null) {
        range = IDBKeyRange.bound([chatId, 0], [chatId, beforeTimestamp], false, true);
      } else if (afterTimestamp !== null) {
        range = IDBKeyRange.bound([chatId, afterTimestamp], [chatId, Infinity], true, false);
      } else {
        range = IDBKeyRange.bound([chatId, 0], [chatId, Infinity]);
      }

      const sortMessagesStably = (arr) => {
        arr.sort((a, b) => {
          const ta = a.timestamp || 0;
          const tb = b.timestamp || 0;
          if (ta !== tb) return ta - tb;
          const sa = a.seq !== undefined && a.seq !== null ? a.seq : Number.MAX_SAFE_INTEGER;
          const sb = b.seq !== undefined && b.seq !== null ? b.seq : Number.MAX_SAFE_INTEGER;
          if (sa !== sb) return sa - sb;
          return String(a.id || '').localeCompare(String(b.id || ''));
        });
        return arr;
      };

      const results = [];
      const cursorReq = index.openCursor(range, 'next');

      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          results.push(cursor.value);
          if (limit > 0 && results.length >= limit) {
            resolve(sortMessagesStably(results));
            return;
          }
          cursor.continue();
        } else {
          resolve(sortMessagesStably(results));
        }
      };

      cursorReq.onerror = () => reject(tx.error);
    });
  }

  async getMessageCount(chatId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('chatId');
      const req = index.count(IDBKeyRange.only(chatId));
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(tx.error);
    });
  }

  async getStarredMessages(chatId = null) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const results = [];
      let cursorReq;

      if (chatId) {
        const index = store.index('chat_time');
        cursorReq = index.openCursor(IDBKeyRange.bound([chatId, 0], [chatId, Infinity]), 'prev');
      } else {
        const index = store.index('timestamp');
        cursorReq = index.openCursor(null, 'prev');
      }

      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value && cursor.value.isStarred) {
            results.push(cursor.value);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      cursorReq.onerror = () => reject(tx.error);
    });
  }

  async getStarredMessageCount(chatId = null) {
    const msgs = await this.getStarredMessages(chatId);
    return msgs.length;
  }

  async setMessagesStarred(messageIds, isStarred = false) {
    await this.init();
    if (!messageIds || messageIds.length === 0) return true;
    // IDs may arrive as strings from dataset attributes — coerce to number if parseable
    const idSet = new Set(messageIds.map((id) => (isNaN(Number(id)) ? id : Number(id))));
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      for (const id of idSet) {
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result) {
            req.result.isStarred = isStarred;
            store.put(req.result);
          }
        };
      }
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveMessage(msg) {
    return this.saveMessages([msg]);
  }

  async saveMessages(messages) {
    await this.init();
    if (!messages || messages.length === 0) return true;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');

      for (let i = 0; i < messages.length; i++) {
        store.put(messages[i]);
      }

      tx.oncomplete = () => {
        this._callsBackfillChecked = false;
        storageBackup.scheduleBackup(this);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async updateMessage(id, updates) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const msg = getReq.result;
        if (!msg) {
          resolve(null);
          return;
        }
        const updated = { ...msg, ...updates };
        store.put(updated);
        tx.oncomplete = () => {
          storageBackup.scheduleBackup(this);
          resolve(updated);
        };
      };
      getReq.onerror = () => reject(tx.error);
    });
  }

  async deleteMessage(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      tx.objectStore('messages').delete(id);
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async searchMessages(query, chatId = null) {
    await this.init();
    if (!query || !query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      let req = null;

      if (chatId) {
        const index = store.index('chatId');
        req = index.openCursor(IDBKeyRange.only(chatId));
      } else {
        req = store.openCursor();
      }

      const matches = [];
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const msg = cursor.value;
          if (msg.text && msg.text.toLowerCase().includes(lowerQuery)) {
            matches.push(msg);
          }
          if (matches.length >= 200) {
            resolve(matches);
            return;
          }
          cursor.continue();
        } else {
          resolve(matches);
        }
      };

      req.onerror = () => reject(tx.error);
    });
  }

  // --- Media Blobs CRUD (Persistent ArrayBuffer + Cache Storage Mirror) ---
  _mediaCacheRequestUrl(id) {
    return `https://folio-media.local/${encodeURIComponent(String(id))}`;
  }

  async _mirrorMediaToCache(id, bytes, mimeType = 'application/octet-stream') {
    if (!id || !bytes || typeof caches === 'undefined' || typeof Response === 'undefined') return false;
    try {
      const cache = await caches.open(USER_MEDIA_CACHE_NAME);
      const copy = bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes;
      await cache.put(
        this._mediaCacheRequestUrl(id),
        new Response(copy, {
          headers: {
            'Content-Type': mimeType || 'application/octet-stream',
            'Cache-Control': 'max-age=31536000'
          }
        })
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  async _readMediaFromCache(id, fallbackMime = 'application/octet-stream') {
    if (!id || typeof caches === 'undefined') return null;
    try {
      const cache = await caches.open(USER_MEDIA_CACHE_NAME);
      const resp = await cache.match(this._mediaCacheRequestUrl(id));
      if (!resp) return null;
      const bytes = await resp.arrayBuffer();
      if (!bytes || bytes.byteLength === 0) return null;
      const mimeType = resp.headers.get('Content-Type') || fallbackMime || 'application/octet-stream';
      const blob = typeof Blob !== 'undefined' ? new Blob([bytes], { type: mimeType }) : null;
      return { bytes, blob, mimeType, size: bytes.byteLength };
    } catch (_) {
      return null;
    }
  }

  async _materializeMediaItem(mediaItem) {
    if (!mediaItem || typeof mediaItem !== 'object') return mediaItem;
    const item = { ...mediaItem };
    if (!item.timestamp) item.timestamp = Date.now();
    const mimeType = item.mimeType || item.blob?.type || this._inferMimeFromFilename(item.filename, item.type);
    item.mimeType = mimeType;

    // Materialize volatile File/Blob handles into durable standalone ArrayBuffer bytes BEFORE IDB write
    if ((!item.bytes || !(item.bytes instanceof ArrayBuffer) || item.bytes.byteLength === 0) && item.blob && typeof item.blob.arrayBuffer === 'function') {
      try {
        const buf = await item.blob.arrayBuffer();
        if (buf && buf.byteLength > 0) {
          item.bytes = buf;
          item.size = buf.byteLength;
          if (typeof Blob !== 'undefined') {
            item.blob = new Blob([buf], { type: mimeType });
          }
        }
      } catch (_) {
        // Keep existing blob if arrayBuffer read isn't supported in mock environment
      }
    } else if (item.bytes && item.bytes instanceof ArrayBuffer && item.bytes.byteLength > 0) {
      if (!item.size) item.size = item.bytes.byteLength;
      if (!item.blob || item.blob.size === 0 || (typeof File !== 'undefined' && item.blob instanceof File)) {
        if (typeof Blob !== 'undefined') {
          item.blob = new Blob([item.bytes], { type: mimeType });
        }
      }
    }
    return item;
  }

  _hydrateMediaRecord(rec) {
    if (!rec) return null;
    const mimeType = rec.mimeType || rec.blob?.type || this._inferMimeFromFilename(rec.filename, rec.type);
    const hasBytes = rec.bytes && (rec.bytes instanceof ArrayBuffer || ArrayBuffer.isView(rec.bytes));
    const byteLen = hasBytes ? (rec.bytes.byteLength || 0) : 0;
    if (byteLen > 0 && typeof Blob !== 'undefined') {
      const isVolatileFile = typeof File !== 'undefined' && rec.blob instanceof File;
      if (!rec.blob || rec.blob.size === 0 || isVolatileFile) {
        rec.blob = new Blob([rec.bytes], { type: mimeType });
      }
      if (!rec.size) rec.size = byteLen;
    }
    return rec;
  }

  async _isBlobReadable(blob) {
    if (!blob) return false;
    if (blob.size === 0) return false;
    if (typeof blob.slice === 'function') {
      try {
        const head = blob.slice(0, 1);
        if (typeof head.arrayBuffer === 'function') {
          await head.arrayBuffer();
        }
        return true;
      } catch (_) {
        return false;
      }
    }
    return true;
  }

  _clearMissForItem(item) {
    if (!item) return;
    const base = String(item.filename || '').replace(/^.*[\\/]/, '').trim().toLowerCase();
    for (const k of Array.from(this._missingMediaMisses)) {
      if ((item.id && k.startsWith(`${item.id}::`)) || (base && k.endsWith(`::${base}`))) {
        this._missingMediaMisses.delete(k);
      }
    }
  }

  async saveMedia(mediaItem) {
    await this.init();
    // Critical: materialize bytes BEFORE opening IDB transaction so tx never auto-commits
    const prepared = await this._materializeMediaItem(mediaItem);
    this._clearMissForItem(prepared);
    const saved = await new Promise((resolve, reject) => {
      const tx = this.db.transaction('media', 'readwrite');
      tx.objectStore('media').put(prepared);
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this, 1500);
        resolve(prepared);
      };
      tx.onerror = () => reject(tx.error);
    });
    // Asynchronous durable mirrors (Cache Storage + per-item WhatsAppBackupDB)
    if (saved && saved.id && saved.bytes) {
      this._mirrorMediaToCache(saved.id, saved.bytes, saved.mimeType).catch(() => {});
    }
    if (saved && saved.id) {
      storageBackup.saveMediaItemBackup(saved).catch(() => {});
    }
    return saved;
  }

  async _getDemoZipMediaMap() {
    if (this._demoZipEntriesPromise) return this._demoZipEntriesPromise;
    this._demoZipEntriesPromise = (async () => {
      try {
        if (typeof fetch !== 'function' || typeof window === 'undefined' || !window.fflate) {
          return null;
        }
        const resp = await fetch(assetUrl('assets/demo_whatsapp_archive.zip'));
        if (!resp || !resp.ok) return null;
        const buf = await resp.arrayBuffer();
        const unzipped = await new Promise((resolve, reject) => {
          window.fflate.unzip(new Uint8Array(buf), (err, res) => (err ? reject(err) : resolve(res)));
        });
        const map = new Map();
        for (const [rawPath, bytes] of Object.entries(unzipped || {})) {
          if (!rawPath || rawPath.endsWith('/') || rawPath.toLowerCase().endsWith('.txt')) continue;
          const base = rawPath.replace(/^.*[\\/]/, '').trim();
          if (base) map.set(base.toLowerCase(), { filename: base, bytes });
        }
        return map;
      } catch (_) {
        return null;
      }
    })();
    return this._demoZipEntriesPromise;
  }

  _inferMimeFromFilename(filename = '', mediaType = '') {
    const lower = String(filename || '').toLowerCase();
    if (/\.webp$/i.test(lower) || mediaType === 'sticker') return 'image/webp';
    if (/\.png$/i.test(lower)) return 'image/png';
    if (/\.(jpg|jpeg)$/i.test(lower) || mediaType === 'image') return 'image/jpeg';
    if (/\.webm$/i.test(lower)) return mediaType === 'audio' ? 'audio/webm' : 'video/webm';
    if (/\.(mp4|mov|mkv|3gp)$/i.test(lower) || mediaType === 'video') return 'video/mp4';
    if (/\.(opus|ogg)$/i.test(lower)) return 'audio/ogg; codecs=opus';
    if (/\.(m4a|aac)$/i.test(lower)) return 'audio/mp4';
    if (/\.mp3$/i.test(lower)) return 'audio/mpeg';
    if (/\.pdf$/i.test(lower) || mediaType === 'pdf') return 'application/pdf';
    return 'application/octet-stream';
  }

  async resolveMediaForMessage(msg) {
    if (!msg) return null;
    await this.init();

    const rawName = (msg.mediaName || '').trim();
    const baseName = rawName.replace(/^.*[\\/]/, '').trim();
    const lowerTarget = baseName.toLowerCase();
    const inferMime = this._inferMimeFromFilename(baseName, msg.mediaType);
    const healAndReturn = async (rec) => {
      if (!rec) return null;
      this._hydrateMediaRecord(rec);
      const targetId = msg.mediaId || rec.id;
      const healed = {
        ...rec,
        id: targetId,
        chatId: rec.chatId || msg.chatId || null,
        filename: rec.filename || baseName || 'media',
        mimeType: rec.mimeType || inferMime
      };
      try {
        await this.saveMedia(healed);
      } catch (_) {}
      return healed;
    };

    // 1. Primary lookup by mediaId (verify blob isn't an expired File handle)
    if (msg.mediaId) {
      try {
        const direct = await this.getMedia(msg.mediaId);
        if (direct && direct.blob) {
          const readable = (direct.bytes && direct.bytes.byteLength > 0) || await this._isBlobReadable(direct.blob);
          if (readable) {
            // Silently upgrade legacy records missing durable bytes in background
            if (!direct.bytes && typeof direct.blob.arrayBuffer === 'function') {
              this.saveMedia(direct).catch(() => {});
            }
            return direct;
          }
        }
      } catch (_) {}
    }

    // 2. Cache Storage permanent mirror (survives app restarts & updates)
    if (msg.mediaId) {
      const fromCache = await this._readMediaFromCache(msg.mediaId, inferMime);
      if (fromCache && fromCache.blob) {
        return healAndReturn({
          id: msg.mediaId,
          chatId: msg.chatId,
          filename: baseName || 'media',
          type: msg.mediaType || 'document',
          mimeType: fromCache.mimeType,
          bytes: fromCache.bytes,
          blob: fromCache.blob,
          size: fromCache.size,
          duration: msg.duration || 0,
          timestamp: msg.timestamp || Date.now()
        });
      }
    }

    // 3. Fallback lookup by normalized filename within the same chat
    if (lowerTarget && msg.chatId) {
      try {
        const chatMedia = await this.getMediaByChat(msg.chatId);
        for (const m of chatMedia) {
          if (!m || !m.blob) continue;
          const mBase = (m.filename || '').replace(/^.*[\\/]/, '').trim().toLowerCase();
          if (mBase !== lowerTarget) continue;
          const readable = (m.bytes && m.bytes.byteLength > 0) || await this._isBlobReadable(m.blob);
          if (!readable) continue;
          if (msg.id && m.id && m.id !== msg.mediaId) {
            msg.mediaId = m.id;
            this.updateMessage(msg.id, { mediaId: m.id }).catch(() => {});
          }
          return m;
        }
      } catch (_) {}
    }

    const missKey = `${msg.mediaId || ''}::${lowerTarget}`;
    if (this._missingMediaMisses.has(missKey)) return null;

    // 4. Cross-chat filename scan (recovers forwarded/re-imported media across all chats)
    if (lowerTarget) {
      try {
        const allMedia = await this.getAllMedia();
        for (const m of allMedia) {
          if (!m || !m.blob) continue;
          const mBase = (m.filename || '').replace(/^.*[\\/]/, '').trim().toLowerCase();
          if (mBase !== lowerTarget) continue;
          const readable = (m.bytes && m.bytes.byteLength > 0) || await this._isBlobReadable(m.blob);
          if (readable) {
            return healAndReturn(m);
          }
        }
      } catch (_) {}
    }

    // 5. Secondary backup recovery (per-item WhatsAppBackupDB media_items + monolithic snapshot)
    try {
      const backupMatch = await storageBackup.readMediaItemBackup(msg.mediaId, baseName);
      if (backupMatch && (backupMatch.bytes || backupMatch.blob)) {
        return healAndReturn(backupMatch);
      }
    } catch (_) {}

    // 6. Built-in Demo Archive auto-heal
    if (baseName) {
      try {
        const demoMap = await this._getDemoZipMediaMap();
        const entry = demoMap ? demoMap.get(lowerTarget) : null;
        if (entry && entry.bytes) {
          const blob = new Blob([entry.bytes], { type: inferMime });
          return healAndReturn({
            id: msg.mediaId || ('media_healed_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
            chatId: msg.chatId,
            filename: entry.filename,
            type: msg.mediaType || 'document',
            mimeType: inferMime,
            bytes: entry.bytes.slice ? entry.bytes.buffer.slice(0) : null,
            blob,
            size: blob.size,
            duration: msg.duration || 0,
            timestamp: msg.timestamp || Date.now()
          });
        }
      } catch (_) {}
    }

    this._missingMediaMisses.add(missKey);
    return null;
  }

  async migrateLegacyMediaRecords() {
    if (this._legacyMediaMigrated) return { migrated: 0 };
    this._legacyMediaMigrated = true;
    await this.init();
    let migrated = 0;
    try {
      const all = await this.getAllMedia();
      for (const rec of all) {
        if (!rec || !rec.id) continue;
        const hasBytes = rec.bytes && rec.bytes.byteLength > 0;
        if (!hasBytes && rec.blob && typeof rec.blob.arrayBuffer === 'function') {
          try {
            const readable = await this._isBlobReadable(rec.blob);
            if (!readable) continue;
            await this.saveMedia(rec);
            migrated++;
          } catch (_) {}
        } else if (hasBytes) {
          this._mirrorMediaToCache(rec.id, rec.bytes, rec.mimeType).catch(() => {});
          storageBackup.saveMediaItemBackup(rec).catch(() => {});
        }
      }
    } catch (_) {}
    return { migrated };
  }

  async saveMediaBatch(items) {
    await this.init();
    if (!items || items.length === 0) return true;
    // Materialize every item BEFORE opening IDB transaction
    const preparedItems = [];
    for (const item of items) {
      if (item) {
        preparedItems.push(await this._materializeMediaItem(item));
      }
    }
    if (preparedItems.length === 0) return true;
    const result = await new Promise((resolve, reject) => {
      const tx = this.db.transaction('media', 'readwrite');
      const store = tx.objectStore('media');
      for (const item of preparedItems) {
        this._clearMissForItem(item);
        store.put(item);
      }
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this, 1500);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
    for (const saved of preparedItems) {
      if (saved && saved.id && saved.bytes) {
        this._mirrorMediaToCache(saved.id, saved.bytes, saved.mimeType).catch(() => {});
      }
      if (saved && saved.id) {
        storageBackup.saveMediaItemBackup(saved).catch(() => {});
      }
    }
    return result;
  }

  async getMedia(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('media', 'readonly');
      const req = tx.objectStore('media').get(id);
      req.onsuccess = () => resolve(this._hydrateMediaRecord(req.result || null));
      req.onerror = () => reject(tx.error);
    });
  }

  async getMediaByChat(chatId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('media', 'readonly');
      const index = tx.objectStore('media').index('chatId');
      const req = index.getAll(IDBKeyRange.only(chatId));
      req.onsuccess = () => {
        const media = (req.result || []).map((m) => this._hydrateMediaRecord(m));
        media.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(media);
      };
      req.onerror = () => reject(tx.error);
    });
  }

  async getAllMedia() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('media', 'readonly');
      const req = tx.objectStore('media').getAll();
      req.onsuccess = () => {
        const media = (req.result || []).map((m) => this._hydrateMediaRecord(m));
        media.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(media);
      };
      req.onerror = () => reject(tx.error);
    });
  }

  // --- Calls CRUD ---
  async saveCall(callItem) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('calls', 'readwrite');
      tx.objectStore('calls').put(callItem);
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(callItem);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveCallsBatch(calls) {
    await this.init();
    if (!calls || calls.length === 0) return true;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('calls', 'readwrite');
      const store = tx.objectStore('calls');
      for (const c of calls) {
        store.put(c);
      }
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async getCalls() {
    await this.init();
    let calls = await new Promise((resolve, reject) => {
      const tx = this.db.transaction('calls', 'readonly');
      const req = tx.objectStore('calls').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(tx.error);
    });

    // If calls store is empty, scan messages once per session/import for any callInfo records and backfill indexed calls
    if (calls.length === 0 && !this._callsBackfillChecked && !this._isBackfillingCalls) {
      this._callsBackfillChecked = true;
      this._isBackfillingCalls = true;
      try {
        const allChats = await this.getChats();
        const backfilled = [];
        for (const chat of allChats) {
          const msgs = await this.getMessages(chat.id);
          for (const m of msgs) {
            if (m.callInfo && m.callInfo.isCall) {
              backfilled.push({
                id: 'call_' + m.timestamp + '_' + Math.random().toString(36).substr(2, 6),
                chatId: chat.id,
                contactName: chat.name,
                timestamp: m.timestamp,
                callType: m.callInfo.callType || 'voice',
                direction: m.callInfo.direction || 'incoming',
                isMissed: !!m.callInfo.isMissed,
                messageId: m.id
              });
            }
          }
        }
        if (backfilled.length > 0) {
          await this.saveCallsBatch(backfilled);
          calls = backfilled;
          if (typeof window !== 'undefined' && window.backgroundTasks) {
            window.backgroundTasks.emit('calls-ready', { chatId: 'all', count: backfilled.length });
          }
        }
      } catch (syncErr) {
        console.warn('[db.getCalls] Fallback sync check failed:', syncErr);
      } finally {
        this._isBackfillingCalls = false;
      }
    }

    calls.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return calls;
  }

  async getCallsByChat(chatId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('calls', 'readonly');
      const store = tx.objectStore('calls');
      const index = store.index('chatId');
      const req = index.getAll(IDBKeyRange.only(chatId));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(tx.error);
    });
  }

  // --- Custom Filter Lists CRUD ---
  async getFilters() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('filters', 'readonly');
      const req = tx.objectStore('filters').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(tx.error);
    });
  }

  async saveFilter(filter) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('filters', 'readwrite');
      tx.objectStore('filters').put(filter);
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(filter);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteFilter(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('filters', 'readwrite');
      tx.objectStore('filters').delete(id);
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Settings Key-Value Store ---
  async getSetting(key, defaultValue = null) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get(key);
      req.onsuccess = () => {
        if (req.result && req.result.value !== undefined) {
          resolve(req.result.value);
        } else {
          resolve(defaultValue);
        }
      };
      req.onerror = () => reject(tx.error);
    });
  }

  async setSetting(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key, value });
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(value);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Pin Feature Helpers ---
  async getPinsForChat(chatId) {
    const raw = await this.getSetting(`pinnedMessages_${chatId}`, []);
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    return raw.filter(p => p.expiresAt === null || p.expiresAt > now);
  }

  async savePinsForChat(chatId, pins) {
    return this.setSetting(`pinnedMessages_${chatId}`, pins);
  }

  async getPinPriorityMode(chatId) {
    return this.getSetting(`pinnedPriorityMode_${chatId}`, { mode: 'last_added', mixedDays: 7, switcherSeconds: 10 });
  }

  async savePinPriorityMode(chatId, modeObj) {
    return this.setSetting(`pinnedPriorityMode_${chatId}`, modeObj);
  }

  // --- Storage & Diagnostics ---
  async getStorageUsage() {
    await this.init();
    let totalBytes = 0;
    let mediaCount = 0;
    let messageCount = 0;
    let chatCount = 0;

    const chats = await this.getChats();
    chatCount = chats.length;

    const allMedia = await this.getAllMedia();
    mediaCount = allMedia.length;
    for (const m of allMedia) {
      if (m.size) totalBytes += m.size;
      else if (m.blob && m.blob.size) totalBytes += m.blob.size;
    }

    // Estimate message text size
    return new Promise((resolve) => {
      const tx = this.db.transaction('messages', 'readonly');
      const req = tx.objectStore('messages').count();
      req.onsuccess = () => {
        messageCount = req.result || 0;
        totalBytes += messageCount * 128; // ~128 bytes per message estimate
        resolve({
          chatCount,
          messageCount,
          mediaCount,
          totalBytes,
          formattedSize: this.formatBytes(totalBytes)
        });
      };
      req.onerror = () => {
        resolve({ chatCount, messageCount, mediaCount, totalBytes, formattedSize: this.formatBytes(totalBytes) });
      };
    });
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'kB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // --- Advanced Granular Storage Breakdown & Multi-Select Clearance ---
  categorizeMediaRecord(m) {
    if (!m) return 'document';
    const type = m.type || '';
    const mime = m.mimeType || '';
    const filename = m.filename || '';

    if (type === 'sticker' || (mime === 'image/webp' && /stk|sticker/i.test(filename))) return 'sticker';
    if (type === 'image' || mime.startsWith('image/')) return 'photos';
    if (type === 'video' || mime.startsWith('video/')) return 'videos';
    if (type === 'audio' || mime.startsWith('audio/') || /\.(opus|ogg|m4a|aac|mp3|wav)$/i.test(filename)) return 'audio';
    if (type === 'pdf' || mime === 'application/pdf' || /\.pdf$/i.test(filename)) return 'documents';
    return 'documents';
  }

  async getChatDetailedStorage(chatId) {
    await this.init();
    const chatMedia = await this.getMediaByChat(chatId);
    const msgs = await this.getMessages(chatId);

    const categories = {
      photos: { count: 0, bytes: 0, items: [] },
      videos: { count: 0, bytes: 0, items: [] },
      audio: { count: 0, bytes: 0, items: [] },
      documents: { count: 0, bytes: 0, items: [] },
      messages: { count: 0, bytes: 0, items: [] }
    };

    let totalBytes = 0;
    let starredCount = 0;

    for (const med of chatMedia) {
      const cat = this.categorizeMediaRecord(med);
      const size = med.size || (med.blob && med.blob.size) || 0;
      totalBytes += size;

      if (cat === 'photos' || cat === 'sticker') {
        categories.photos.count++;
        categories.photos.bytes += size;
        categories.photos.items.push(med);
      } else if (cat === 'videos') {
        categories.videos.count++;
        categories.videos.bytes += size;
        categories.videos.items.push(med);
      } else if (cat === 'audio') {
        categories.audio.count++;
        categories.audio.bytes += size;
        categories.audio.items.push(med);
      } else {
        categories.documents.count++;
        categories.documents.bytes += size;
        categories.documents.items.push(med);
      }
    }

    for (const msg of msgs) {
      if (msg.isStarred) starredCount++;
      const msgBytes = (msg.text ? msg.text.length * 2 : 0) + 128;
      totalBytes += msgBytes;
      categories.messages.count++;
      categories.messages.bytes += msgBytes;
      categories.messages.items.push(msg);
    }

    return {
      totalBytes,
      formattedTotal: this.formatBytes(totalBytes),
      totalItems: chatMedia.length + msgs.length,
      photos: {
        count: categories.photos.count,
        bytes: categories.photos.bytes,
        formatted: this.formatBytes(categories.photos.bytes),
        items: categories.photos.items
      },
      videos: {
        count: categories.videos.count,
        bytes: categories.videos.bytes,
        formatted: this.formatBytes(categories.videos.bytes),
        items: categories.videos.items
      },
      audio: {
        count: categories.audio.count,
        bytes: categories.audio.bytes,
        formatted: this.formatBytes(categories.audio.bytes),
        items: categories.audio.items
      },
      documents: {
        count: categories.documents.count,
        bytes: categories.documents.bytes,
        formatted: this.formatBytes(categories.documents.bytes),
        items: categories.documents.items
      },
      messages: {
        count: categories.messages.count,
        bytes: categories.messages.bytes,
        formatted: this.formatBytes(categories.messages.bytes),
        items: categories.messages.items
      },
      starredCount,
      allMedia: chatMedia
    };
  }

  async getStorageUsageRanked() {
    await this.init();
    const chats = await this.getChats();
    const rankedChats = [];

    let globalTotalBytes = 0;
    let globalMediaBytes = 0;
    let globalMessageBytes = 0;
    let globalMessageCount = 0;
    let globalMediaCount = 0;

    for (const c of chats) {
      const stats = await this.getChatDetailedStorage(c.id);
      const mediaBytes = stats.photos.bytes + stats.videos.bytes + stats.audio.bytes + stats.documents.bytes;
      globalTotalBytes += stats.totalBytes;
      globalMediaBytes += mediaBytes;
      globalMessageBytes += stats.messages.bytes;
      globalMessageCount += stats.messages.count;
      globalMediaCount += stats.allMedia.length;

      rankedChats.push({
        chat: c,
        stats,
        totalBytes: stats.totalBytes,
        formattedTotal: stats.formattedTotal,
        mediaCount: stats.allMedia.length,
        messageCount: stats.messages.count
      });
    }

    rankedChats.sort((a, b) => b.totalBytes - a.totalBytes);

    return {
      global: {
        totalBytes: globalTotalBytes,
        mediaBytes: globalMediaBytes,
        messageBytes: globalMessageBytes,
        formattedTotal: this.formatBytes(globalTotalBytes),
        formattedMedia: this.formatBytes(globalMediaBytes),
        formattedMessages: this.formatBytes(globalMessageBytes),
        chatCount: chats.length,
        messageCount: globalMessageCount,
        mediaCount: globalMediaCount
      },
      chats: rankedChats
    };
  }

  async clearChatCategory(chatId, category, deleteStarred = false) {
    await this.init();
    const chatMedia = await this.getMediaByChat(chatId);
    const msgs = await this.getMessages(chatId);

    const mediaToDelete = [];
    const messagesToDelete = [];

    if (category === 'all') {
      for (const m of chatMedia) mediaToDelete.push(m.id);
      for (const msg of msgs) {
        if (!deleteStarred && msg.isStarred) continue;
        messagesToDelete.push(msg.id);
      }
    } else if (category === 'messages') {
      for (const msg of msgs) {
        if (!deleteStarred && msg.isStarred) continue;
        messagesToDelete.push(msg.id);
      }
    } else {
      for (const m of chatMedia) {
        const cat = this.categorizeMediaRecord(m);
        let matches = false;
        if (category === 'photos' && (cat === 'photos' || cat === 'sticker')) matches = true;
        else if (category === 'videos' && cat === 'videos') matches = true;
        else if (category === 'audio' && cat === 'audio') matches = true;
        else if (category === 'documents' && cat === 'documents') matches = true;

        if (matches) {
          mediaToDelete.push(m.id);
          const parentMsg = msgs.find((msg) => msg.mediaId === m.id);
          if (parentMsg && (deleteStarred || !parentMsg.isStarred)) {
            messagesToDelete.push(parentMsg.id);
          }
        }
      }
    }

    if (mediaToDelete.length > 0) {
      await this.deleteMediaBatch(mediaToDelete);
    }
    if (messagesToDelete.length > 0) {
      await this.deleteMessagesBatch(messagesToDelete, !deleteStarred);
    }

    const remainingMsgs = await this.getMessages(chatId);
    const lastMsg = remainingMsgs.length > 0 ? remainingMsgs[remainingMsgs.length - 1] : null;

    await this.updateChat(chatId, {
      lastMessage: lastMsg ? {
        text: lastMsg.text,
        timestamp: lastMsg.timestamp,
        isOutgoing: lastMsg.isOutgoing,
        mediaType: lastMsg.mediaType
      } : null
    });

    return true;
  }

  async deleteMediaBatch(mediaIds) {
    await this.init();
    if (!mediaIds || mediaIds.length === 0) return true;
    const idSet = new Set(mediaIds);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('media', 'readwrite');
      const store = tx.objectStore('media');
      for (const id of idSet) {
        store.delete(id);
      }
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteMessagesBatch(messageIds, preserveStarred = true) {
    await this.init();
    if (!messageIds || messageIds.length === 0) return true;
    const idSet = new Set(messageIds);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      for (const id of idSet) {
        if (preserveStarred) {
          const req = store.get(id);
          req.onsuccess = () => {
            if (req.result && !req.result.isStarred) {
              store.delete(id);
            }
          };
        } else {
          store.delete(id);
        }
      }
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearChatsStorageBatch(chatIds, deleteStarred = false) {
    if (!chatIds || chatIds.length === 0) return true;
    for (const cid of chatIds) {
      await this.clearChatCategory(cid, 'all', deleteStarred);
    }
    return true;
  }

  // --- Full Backup Export & Restore ---
  async exportFullBackup() {
    await this.init();
    const chats = await this.getChats();
    const allMedia = await this.getAllMedia();
    const calls = await this.getCalls();
    const filters = await this.getFilters();

    // Fetch all messages
    const messages = await new Promise((resolve) => {
      const tx = this.db.transaction('messages', 'readonly');
      const req = tx.objectStore('messages').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    // Fetch all settings
    const settings = await new Promise((resolve) => {
      const tx = this.db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    return {
      version: '3.0.6',
      exportedAt: Date.now(),
      chats,
      messages,
      calls,
      filters,
      settings,
      media: allMedia
    };
  }

  async restoreFullBackup(data) {
    await this.init();
    if (!data || !Array.isArray(data.chats) || !Array.isArray(data.messages)) {
      throw new Error('Invalid backup file structure.');
    }

    // Materialize all media BEFORE opening the IDB transaction (never await inside IDB tx)
    const preparedMedia = [];
    if (Array.isArray(data.media)) {
      for (const rawMed of data.media) {
        if (!rawMed || !rawMed.id) continue;
        const hasBytes = rawMed.bytes && (rawMed.bytes instanceof ArrayBuffer || ArrayBuffer.isView(rawMed.bytes)) && rawMed.bytes.byteLength > 0;
        const hasValidBlob = rawMed.blob && typeof rawMed.blob.arrayBuffer === 'function' && (typeof rawMed.blob.size !== 'number' || rawMed.blob.size > 0);
        if (!hasBytes && !hasValidBlob) continue;
        const materialized = await this._materializeMediaItem(rawMed);
        if (materialized) preparedMedia.push(materialized);
      }
    }

    // Sanitize chats (strip dead `{}` avatarBlob from legacy JSON exports)
    const preparedChats = data.chats.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const copy = { ...c };
      if (copy.avatarBlob) {
        const validAvatar = typeof copy.avatarBlob.arrayBuffer === 'function' && (typeof copy.avatarBlob.size !== 'number' || copy.avatarBlob.size > 0);
        if (!validAvatar) copy.avatarBlob = null;
      }
      return copy;
    });

    // Strip dead `{}` objects from Blob setting keys
    const preparedSettings = (data.settings || []).filter((s) => {
      if (!s || !s.key) return false;
      if (
        (s.key === 'userAvatarBlob' || s.key === 'customWallpaperBlob') &&
        s.value &&
        typeof s.value === 'object' &&
        typeof s.value.arrayBuffer !== 'function' &&
        !(s.value instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(s.value) &&
        Object.keys(s.value).length === 0
      ) {
        return false;
      }
      return true;
    });

    const tx = this.db.transaction(['chats', 'messages', 'media', 'calls', 'filters', 'settings'], 'readwrite');

    // Clear existing
    tx.objectStore('chats').clear();
    tx.objectStore('messages').clear();
    tx.objectStore('media').clear();
    tx.objectStore('calls').clear();
    tx.objectStore('filters').clear();
    tx.objectStore('settings').clear();

    // Populate
    const chatStore = tx.objectStore('chats');
    for (const c of preparedChats) chatStore.put(c);

    const msgStore = tx.objectStore('messages');
    for (const m of data.messages) msgStore.put(m);

    const mediaStore = tx.objectStore('media');
    for (const med of preparedMedia) {
      this._clearMissForItem(med);
      mediaStore.put(med);
    }

    if (Array.isArray(data.calls)) {
      const callStore = tx.objectStore('calls');
      for (const call of data.calls) callStore.put(call);
    }

    if (Array.isArray(data.filters)) {
      const filterStore = tx.objectStore('filters');
      for (const f of data.filters) filterStore.put(f);
    }

    const setStore = tx.objectStore('settings');
    for (const s of preparedSettings) setStore.put(s);

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        if (this._missingMediaMisses) this._missingMediaMisses.clear();
        storageBackup.scheduleBackup(this);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });

    // Mirror restored media to Cache Storage & Secondary IDB after commit
    for (const med of preparedMedia) {
      if (med && med.id && med.bytes) {
        this._mirrorMediaToCache(med.id, med.bytes, med.mimeType).catch(() => {});
      }
      if (med && med.id) {
        storageBackup.saveMediaItemBackup(med).catch(() => {});
      }
    }

    return true;
  }

  async clearAllData() {
    await this.init();
    const tx = this.db.transaction(['chats', 'messages', 'media', 'calls', 'filters', 'settings'], 'readwrite');
    tx.objectStore('chats').clear();
    tx.objectStore('messages').clear();
    tx.objectStore('media').clear();
    tx.objectStore('calls').clear();
    tx.objectStore('filters').clear();
    tx.objectStore('settings').clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        storageBackup.scheduleBackup(this);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }
  // --- Disaster Recovery & Storage Persistence API ---
  async checkAutoRestore() {
    return storageBackup.checkAndAutoRestoreIfEmpty(this);
  }

  async forceBackup() {
    return storageBackup.forceBackup(this);
  }

  async restoreFromAutoBackup() {
    return storageBackup.restoreFromAutoBackup(this);
  }

  getBackupStatus() {
    return storageBackup.getBackupStatus();
  }

  async ensurePersistence() {
    return storageBackup.ensurePersistence();
  }

  async getPersistenceInfo() {
    return storageBackup.getPersistenceInfo();
  }
}

export const db = new Database();
