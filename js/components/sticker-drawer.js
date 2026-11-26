// Component: WhatsApp-Style Tabbed & Resizable Bottom Sticker Drawer
import { db } from '../db.js';
import { Icons } from '../icons.js';
import { Toast } from './toast.js';
import { assetUrl } from '../config/base-path.js';
import { DrawerResizer } from '../utils/drawer-resizer.js';
import { escapeHtml } from '../utils/rich-text.js';

const APP_STICKERS_CHAT_ID = '__folio_app__';
const RECENT_STICKERS_KEY = 'wa_recent_stickers';
const CHAT_MRU_STORAGE_KEY = 'wa_sticker_chat_mru';
const MAX_VISIBLE_CHAT_TABS = 10;
const MAX_RECENT_STICKERS = 40;

export class StickerDrawer {
  constructor(options = {}) {
    this.onSelectSticker = options.onSelectSticker || (() => {});
    this.currentChatId = options.currentChatId || null;
    this.container = null;
    this.drawerEl = null;
    this.isOpen = false;
    this.currentHeightVh = 44;
    this.resizer = null;
    this.activeTab = null; // 'recent' | 'app' | `chat:${chatId}`
    this._state = null;
    this._objectUrls = [];
  }

  static getRecentStickers() {
    try {
      const raw = localStorage.getItem(RECENT_STICKERS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  static getChatMruMap() {
    try {
      const raw = localStorage.getItem(CHAT_MRU_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  static promoteChatTab(chatId) {
    if (!chatId || chatId === APP_STICKERS_CHAT_ID) return {};
    const mru = StickerDrawer.getChatMruMap();
    mru[String(chatId)] = Date.now();
    try {
      localStorage.setItem(CHAT_MRU_STORAGE_KEY, JSON.stringify(mru));
    } catch (_) {}
    return mru;
  }

  static recordStickerUsage(sticker = {}, targetChatId = null) {
    const id = String(sticker.id || sticker.name || ('stk_' + Date.now()));
    const entry = {
      id,
      name: sticker.name || 'Sticker',
      url: sticker.isDefault ? sticker.url : (sticker.url || ''),
      chatId: sticker.chatId || targetChatId || APP_STICKERS_CHAT_ID,
      isDefault: Boolean(sticker.isDefault),
      usedAt: Date.now()
    };

    const existing = StickerDrawer.getRecentStickers().filter(
      (item) => !(String(item.id) === id || (entry.isDefault && item.url === entry.url))
    );
    existing.unshift(entry);
    try {
      localStorage.setItem(RECENT_STICKERS_KEY, JSON.stringify(existing.slice(0, MAX_RECENT_STICKERS)));
    } catch (_) {}

    const mruChat = sticker.chatId && sticker.chatId !== APP_STICKERS_CHAT_ID
      ? sticker.chatId
      : targetChatId;
    if (mruChat && mruChat !== APP_STICKERS_CHAT_ID) {
      StickerDrawer.promoteChatTab(mruChat);
    }
  }

  static extractChatTabBadge(chatName = '') {
    const trimmed = String(chatName || '').trim();
    if (!trimmed) return 'C';
    try {
      const emojiMatch = trimmed.match(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/u);
      if (emojiMatch && emojiMatch[0]) return emojiMatch[0];
    } catch (_) {}
    const chars = Array.from(trimmed);
    const letter = chars.find((ch) => /\S/.test(ch));
    return letter ? letter.toUpperCase() : 'C';
  }

  async open() {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.isOpen = true;
    await this.render();
  }

  close(notifyRouter = true) {
    if (this.resizer && this.resizer.isOpen) {
      this.resizer.close(notifyRouter);
      return;
    }
    this._cleanupDOM();
    if (notifyRouter && window.router) {
      window.router.removeOverlay('sticker-drawer');
    }
    this.isOpen = false;
  }

  _cleanupDOM() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    if (this.drawerEl) {
      this.drawerEl.remove();
      this.drawerEl = null;
    }
    for (const url of this._objectUrls) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
    this._objectUrls = [];
  }

  async loadStickerState() {
    for (const url of this._objectUrls) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
    this._objectUrls = [];

    const appStickers = [];
    const byChatId = new Map();
    const mediaById = new Map();
    const chatsById = new Map();

    try {
      await db.init();
      const [allMedia, allChats] = await Promise.all([
        db.getAllMedia(),
        db.getChats().catch(() => [])
      ]);

      for (const c of allChats || []) {
        chatsById.set(String(c.id), c);
      }

      for (const m of allMedia || []) {
        const isSticker = m.type === 'sticker' ||
          m.mediaType === 'sticker' ||
          (m.filename && (/\.webp$/i.test(m.filename) || /stk-/i.test(m.filename) || /sticker/i.test(m.filename))) ||
          m.mimeType === 'image/webp';
        if (!isSticker || !m.blob) continue;

        const url = URL.createObjectURL(m.blob);
        this._objectUrls.push(url);
        const rec = {
          id: String(m.id || m.mediaId),
          name: m.filename || 'Sticker',
          url,
          blob: m.blob,
          chatId: m.chatId ? String(m.chatId) : APP_STICKERS_CHAT_ID,
          timestamp: m.timestamp || 0,
          isImported: true
        };
        mediaById.set(rec.id, rec);

        if (rec.chatId === APP_STICKERS_CHAT_ID) {
          appStickers.push(rec);
        } else {
          if (!byChatId.has(rec.chatId)) {
            byChatId.set(rec.chatId, []);
          }
          byChatId.get(rec.chatId).push(rec);
        }
      }
    } catch (e) {
      console.warn('[StickerDrawer] Error loading sticker packs:', e);
    }

    // Add 12 bundled built-in Folio vector stickers to App Stickers
    for (let i = 1; i <= 12; i++) {
      const defUrl = assetUrl(`assets/stickers/sticker-${i}.svg`);
      const defRec = {
        id: `default-stk-${i}`,
        name: `Sticker ${i}`,
        url: defUrl,
        chatId: APP_STICKERS_CHAT_ID,
        isDefault: true
      };
      appStickers.push(defRec);
      mediaById.set(defRec.id, defRec);
    }

    // Build sorted per-chat sticker tabs (only chats with >= 1 sticker!)
    const mruMap = StickerDrawer.getChatMruMap();
    const allChatTabs = [];
    for (const [chatId, stickers] of byChatId.entries()) {
      if (!stickers || stickers.length === 0) continue;
      const chat = chatsById.get(chatId);
      const chatName = chat?.name || 'Chat Stickers';
      const maxStkTs = stickers.reduce((mx, s) => Math.max(mx, s.timestamp || 0), 0);
      const sortScore = Number(mruMap[chatId] || maxStkTs || chat?.updatedAt || 0);
      allChatTabs.push({
        tabId: `chat:${chatId}`,
        chatId,
        name: chatName,
        badge: StickerDrawer.extractChatTabBadge(chatName),
        stickers,
        sortScore
      });
    }

    allChatTabs.sort((a, b) => b.sortScore - a.sortScore);
    const visibleChatTabs = allChatTabs.slice(0, MAX_VISIBLE_CHAT_TABS);

    // Resolve Recent stickers against live DB media URLs or default SVG URLs
    const recentRaw = StickerDrawer.getRecentStickers();
    const recentStickers = [];
    const seenRecent = new Set();
    for (const r of recentRaw) {
      const rid = String(r.id || '');
      const live = mediaById.get(rid);
      if (live) {
        if (seenRecent.has(live.id)) continue;
        seenRecent.add(live.id);
        recentStickers.push(live);
      } else if (r.isDefault && r.url) {
        if (seenRecent.has(r.url)) continue;
        seenRecent.add(r.url);
        recentStickers.push({
          id: rid || r.url,
          name: r.name || 'Sticker',
          url: r.url,
          chatId: APP_STICKERS_CHAT_ID,
          isDefault: true
        });
      }
    }

    return {
      recentStickers,
      appStickers,
      visibleChatTabs,
      allChatTabs
    };
  }

  _getActiveGridData() {
    if (!this._state) return { title: 'Stickers', stickers: [], emptyHint: 'No stickers found' };
    const { recentStickers, appStickers, allChatTabs } = this._state;

    if (this.activeTab === 'recent') {
      return {
        title: 'Recently Used',
        stickers: recentStickers,
        emptyHint: 'No recent stickers yet — tap any sticker to use it'
      };
    }

    if (this.activeTab && this.activeTab.startsWith('chat:')) {
      const targetChatId = this.activeTab.slice(5);
      const tab = allChatTabs.find((t) => String(t.chatId) === String(targetChatId));
      if (tab) {
        return {
          title: tab.name,
          stickers: tab.stickers,
          emptyHint: `No stickers in ${tab.name}`
        };
      }
    }

    this.activeTab = 'app';
    return {
      title: 'App Stickers',
      stickers: appStickers,
      emptyHint: 'Tap + to add custom stickers'
    };
  }

  _renderTabsAndGrid() {
    if (!this.drawerEl || !this._state) return;
    const { recentStickers, visibleChatTabs, allChatTabs } = this._state;

    if (!this.activeTab) {
      this.activeTab = recentStickers.length > 0 ? 'recent' : 'app';
    }
    if (this.activeTab.startsWith('chat:')) {
      const cId = this.activeTab.slice(5);
      if (!allChatTabs.some((t) => String(t.chatId) === String(cId))) {
        this.activeTab = 'app';
      }
    }

    const tabsBar = this.drawerEl.querySelector('#sticker-tabs-bar');
    const titleEl = this.drawerEl.querySelector('#sticker-drawer-title');
    const fsTitleEl = this.drawerEl.querySelector('#sticker-fs-title');
    const gridEl = this.drawerEl.querySelector('#sticker-grid');

    if (tabsBar) {
      const chatTabsHtml = visibleChatTabs.map((t) => `
        <button type="button" class="sticker-tab-btn is-chat-tab ${this.activeTab === t.tabId ? 'active' : ''}" data-tab="${escapeHtml(t.tabId)}" title="${escapeHtml(t.name)} (${t.stickers.length})" aria-label="${escapeHtml(t.name)}">
          <span class="sticker-chat-badge" dir="auto">${escapeHtml(t.badge)}</span>
        </button>
      `).join('');

      const recentClockSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`;

      tabsBar.innerHTML = `
        <button type="button" class="sticker-tab-btn ${this.activeTab === 'recent' ? 'active' : ''}" data-tab="recent" title="Recent stickers" aria-label="Recent stickers">
          ${recentClockSvg}
        </button>
        <button type="button" class="sticker-tab-btn ${this.activeTab === 'app' ? 'active' : ''}" data-tab="app" title="App Stickers" aria-label="App Stickers">
          ${Icons.sticker('', 18)}
        </button>
        ${chatTabsHtml}
        <button type="button" class="sticker-tab-btn sticker-add-btn" id="btn-sticker-add-custom" title="Add custom sticker" aria-label="Add custom sticker">+</button>
        <button type="button" class="sticker-tab-btn sticker-overflow-btn ${allChatTabs.length === 0 ? 'is-disabled' : ''}" id="btn-sticker-all-chats" title="All sticker chats" aria-label="All sticker chats" ${allChatTabs.length === 0 ? 'disabled' : ''}>
          ${Icons.chevronDown('', 18)}
        </button>
      `;
    }

    const activeData = this._getActiveGridData();
    if (titleEl) titleEl.textContent = activeData.title;
    if (fsTitleEl) fsTitleEl.textContent = activeData.title;

    if (gridEl) {
      if (activeData.stickers.length === 0) {
        gridEl.innerHTML = `<div class="sticker-empty-hint">${escapeHtml(activeData.emptyHint)}</div>`;
      } else {
        gridEl.innerHTML = activeData.stickers.map((s, idx) => `
          <button type="button" class="sticker-grid-tile" data-index="${idx}" aria-label="${escapeHtml(s.name)}" title="${escapeHtml(s.name)}">
            <img src="${s.url}" alt="${escapeHtml(s.name)}" class="sticker-img" loading="lazy" />
          </button>
        `).join('');
      }
    }

    // Bind tab switches
    tabsBar?.querySelectorAll('.sticker-tab-btn[data-tab]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeOverflowMenu();
        this.activeTab = btn.dataset.tab;
        this._renderTabsAndGrid();
      });
    });

    // Bind "+" upload sticker (saves into active chat tab or general App Stickers)
    tabsBar?.querySelector('#btn-sticker-add-custom')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeOverflowMenu();
      this.drawerEl?.querySelector('#sticker-custom-upload-input')?.click();
    });

    // Bind overflow menu (all chats with stickers -> selecting promotes chat to #1!)
    tabsBar?.querySelector('#btn-sticker-all-chats')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleOverflowMenu();
    });

    // Bind sticker tile clicks
    gridEl?.querySelectorAll('.sticker-grid-tile').forEach((tile) => {
      tile.addEventListener('click', async () => {
        const idx = parseInt(tile.dataset.index, 10);
        const selected = activeData.stickers[idx];
        if (!selected) return;

        StickerDrawer.recordStickerUsage(selected, this.currentChatId);
        this.close();

        let blob = selected.blob;
        if (!blob) {
          try {
            const resp = await fetch(selected.url);
            blob = await resp.blob();
          } catch (err) {
            console.warn('[StickerDrawer] Failed to fetch sticker blob:', err);
          }
        }
        this.onSelectSticker(blob || selected.url, selected.name, selected);
      });
    });
  }

  _closeOverflowMenu() {
    const menu = this.drawerEl?.querySelector('#sticker-chats-overflow-menu');
    if (menu) menu.style.display = 'none';
  }

  _toggleOverflowMenu() {
    const menu = this.drawerEl?.querySelector('#sticker-chats-overflow-menu');
    if (!menu || !this._state) return;
    if (menu.style.display === 'block') {
      menu.style.display = 'none';
      return;
    }

    const { allChatTabs } = this._state;
    if (allChatTabs.length === 0) return;

    menu.innerHTML = `
      <div class="sticker-overflow-header">All Chats With Stickers (${allChatTabs.length})</div>
      <div class="sticker-overflow-list">
        ${allChatTabs.map((t) => `
          <button type="button" class="sticker-overflow-item ${this.activeTab === t.tabId ? 'active' : ''}" data-pick-chat-id="${escapeHtml(t.chatId)}">
            <span class="sticker-overflow-avatar" dir="auto">${escapeHtml(t.badge)}</span>
            <span class="sticker-overflow-name" dir="auto">${escapeHtml(t.name)}</span>
            <span class="sticker-overflow-count">${t.stickers.length}</span>
          </button>
        `).join('')}
      </div>
    `;
    menu.style.display = 'block';

    menu.querySelectorAll('.sticker-overflow-item[data-pick-chat-id]').forEach((item) => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const chatId = item.dataset.pickChatId;
        if (!chatId) return;
        // Promote chosen chat to slot #1 of the 10 visible chat tabs
        StickerDrawer.promoteChatTab(chatId);
        this.activeTab = `chat:${chatId}`;
        this._closeOverflowMenu();
        this._state = await this.loadStickerState();
        this._renderTabsAndGrid();
      });
    });
  }

  async _handleCustomUpload(files = []) {
    if (!files || files.length === 0) return;
    const isChatTab = Boolean(this.activeTab && this.activeTab.startsWith('chat:'));
    const targetChatId = isChatTab ? this.activeTab.slice(5) : APP_STICKERS_CHAT_ID;

    let added = 0;
    for (const file of files) {
      if (!file) continue;
      const baseName = (file.name || 'custom_sticker.webp').replace(/\.[^.]+$/, '');
      const rec = {
        id: db.generateUUID(),
        chatId: targetChatId,
        filename: `${baseName}.webp`,
        type: 'sticker',
        mimeType: file.type || 'image/webp',
        size: file.size || 0,
        blob: file,
        timestamp: Date.now()
      };
      await db.saveMedia(rec);
      added++;
    }

    if (added > 0) {
      if (targetChatId !== APP_STICKERS_CHAT_ID) {
        StickerDrawer.promoteChatTab(targetChatId);
        this.activeTab = `chat:${targetChatId}`;
      } else {
        this.activeTab = 'app';
      }
      this._state = await this.loadStickerState();
      this._renderTabsAndGrid();
      Toast.show(added === 1 ? 'Sticker added' : `${added} stickers added`);
    }
  }

  async render() {
    const existingOverlay = document.querySelector('.sticker-drawer-overlay');
    if (existingOverlay) existingOverlay.remove();
    const existingDrawer = document.querySelector('.sticker-drawer-sheet');
    if (existingDrawer) existingDrawer.remove();

    this._state = await this.loadStickerState();

    const overlay = document.createElement('div');
    overlay.className = 'sticker-drawer-overlay';
    overlay.style.display = 'none';

    const drawer = document.createElement('div');
    drawer.className = 'sticker-drawer-sheet';
    drawer.style.display = 'none';

    drawer.innerHTML = `
      <!-- Top Drag Handle -->
      <div class="drawer-drag-header" id="drawer-drag-header">
        <div class="drawer-drag-handle-bar"></div>
        <div class="drawer-header-title" id="sticker-drawer-title">Stickers</div>
      </div>

      <!-- Fullscreen Header (active when dragged > 80%) -->
      <div class="sheet-fullscreen-header" id="sticker-fullscreen-header" style="display:none;">
        <button type="button" class="sheet-fullscreen-back-btn" id="btn-sticker-fullscreen-back" aria-label="Exit fullscreen">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>
        <div class="sheet-fullscreen-title" id="sticker-fs-title">Stickers</div>
      </div>

      <!-- WhatsApp-Style Sticker Pack Tabs Bar -->
      <div class="sticker-tabs-wrap">
        <div class="sticker-tabs-bar" id="sticker-tabs-bar" role="tablist" aria-label="Sticker packs"></div>
        <div class="sticker-chats-overflow-menu" id="sticker-chats-overflow-menu" style="display:none;"></div>
      </div>

      <!-- Hidden Sticker Import Input -->
      <input type="file" id="sticker-custom-upload-input" accept="image/*" multiple style="display:none;" />

      <!-- Sticker Grid Body -->
      <div class="drawer-stickers-scroll">
        <div class="stickers-grid" id="sticker-grid"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    this.container = overlay;
    this.drawerEl = drawer;

    drawer.addEventListener('click', (e) => {
      if (!e.target.closest('#sticker-chats-overflow-menu') && !e.target.closest('#btn-sticker-all-chats')) {
        this._closeOverflowMenu();
      }
    });

    const uploadInput = drawer.querySelector('#sticker-custom-upload-input');
    uploadInput?.addEventListener('change', async (e) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = '';
      await this._handleCustomUpload(files);
    });

    this.resizer = new DrawerResizer({
      sheet: drawer,
      handle: drawer.querySelector('#drawer-drag-header'),
      backdrop: overlay,
      fullscreenHeader: drawer.querySelector('#sticker-fullscreen-header'),
      overlayId: 'sticker-drawer',
      defaultHeightVh: 44,
      minVh: 22,
      maxVh: 80,
      onClose: () => {
        this._cleanupDOM();
        this.isOpen = false;
      },
      onResize: (px, vh) => {
        this.currentHeightVh = Math.round(vh);
      }
    });

    this.resizer.open(44);
    this._renderTabsAndGrid();
  }
}
