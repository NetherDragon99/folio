// Component: Fullscreen Multi-Media & File Editor with Full Rich Composer Parity & Drag-Resize
import { Icons } from '../icons.js';
import { RichComposer } from './rich-composer.js';
import { HIGHLIGHT_COLORS, escapeHtml } from '../utils/rich-text.js';

const POPOVER_FORMAT_TOOLS = new Set(['highlight', 'header', 'ul', 'align']);
const TOOL_ACTION_NAMES = {
  bold: 'Bold (عريض)',
  italic: 'Italic (مائل)',
  underline: 'Underline (خط سفلي)',
  strike: 'Strikethrough (مشطوب)',
  spoiler: 'Spoiler (نص مخفي)',
  check: 'Checklist (مربعات اختيار)',
  fold: 'Fold Block (طي وفرد)',
  ol: 'Numbered List (قائمة مرقمة)',
  'indent-inc': 'Indent (إزاحة للداخل)',
  'indent-dec': 'Outdent (إزاحة للخارج)',
  link: 'Link (رابط على كلمة)',
  quote: 'Quote (اقتباس)',
  code: 'Inline Code (كود)',
  codeblock: 'Code Block (مربع كود)',
  sup: 'Superscript (أس علوي)',
  sub: 'Subscript (دليل سفلي)'
};

export class MediaEditorModal {
  constructor(options = {}) {
    this.recipientName = options.recipientName || 'Contact';
    this.onSend = options.onSend || (() => {});
    this.onCancel = options.onCancel || (() => {});
    this.onAddMore = options.onAddMore || (() => {});
    this.container = null;
    this.items = []; // Array of { file, url, type, isVideo, isImage }
    this.activeIndex = 0;
    this.isHd = false;
    this.isCaptionFullscreen = false;
    this.initialCaption = '';
    this.richComposer = null;
    this._sent = false;
    this._activePopover = null;
    this._manualCaptionHeightPx = null;
    this._isEditorFocused = false;
    this._tooltipTimer = null;
  }

  _classifyFile(file) {
    const mime = (file?.type || '').toLowerCase();
    const name = (file?.name || '').toLowerCase();
    if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(name)) {
      return { type: 'video', isVideo: true, isImage: false };
    }
    if (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name)) {
      return { type: 'image', isVideo: false, isImage: true };
    }
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|opus|m4a)$/i.test(name)) {
      return { type: 'audio', isVideo: false, isImage: false };
    }
    if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
      return { type: 'pdf', isVideo: false, isImage: false };
    }
    return { type: 'document', isVideo: false, isImage: false };
  }

  _formatFileSize(bytes = 0) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  show(initialFiles = [], options = {}) {
    this.initialCaption = typeof options.initialCaption === 'string' ? options.initialCaption : '';
    this.acceptMode = options.accept || 'image/*,video/*';
    this._sent = false;
    this.isCaptionFullscreen = false;
    this._manualCaptionHeightPx = null;
    this._activePopover = null;
    this._isEditorFocused = false;

    this.items = initialFiles.map((file) => {
      const cls = this._classifyFile(file);
      return {
        file,
        url: (cls.isImage || cls.isVideo) ? URL.createObjectURL(file) : '',
        ...cls
      };
    });

    if (this.items.length === 0) return;
    this.activeIndex = 0;
    this.isHd = false;

    if (window.router) {
      window.router.pushOverlay('media-editor-modal', () => this.close(false));
    }

    this.render();
  }

  addFiles(newFiles = []) {
    const newItems = newFiles.map((file) => {
      const cls = this._classifyFile(file);
      return {
        file,
        url: (cls.isImage || cls.isVideo) ? URL.createObjectURL(file) : '',
        ...cls
      };
    });

    this.items.push(...newItems);
    this.updateThumbnails();
  }

  render() {
    const existing = document.querySelector('.media-editor-modal');
    if (existing) existing.remove();

    this.container = document.createElement('div');
    this.container.className = 'media-editor-modal';

    const currentItem = this.items[this.activeIndex];
    const hasVisual = this.items.some((i) => i.isImage || i.isVideo);

    this.container.innerHTML = `
      <!-- Top Functional Bar -->
      <header class="media-editor-header">
        <button type="button" class="editor-icon-btn" id="btn-editor-close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
        <div class="editor-header-actions">
          ${hasVisual ? `
            <button type="button" class="editor-hd-btn ${this.isHd ? 'active' : ''}" id="btn-editor-hd" aria-label="HD quality">
              <span class="hd-box">HD</span>
            </button>
          ` : ''}
        </div>
      </header>

      <!-- Center Main Preview -->
      <div class="media-editor-preview-stage" id="editor-preview-stage">
        ${this.renderActivePreview(currentItem)}
      </div>

      <!-- Bottom Panel: Thumbnails, Resizable Rich Caption (Full Formatting Parity + Fullscreen) & Send -->
      <footer class="media-editor-footer" id="media-editor-footer">
        <div class="editor-caption-fs-header" id="editor-caption-fs-header" style="display: none;">
          <button type="button" class="editor-icon-btn" id="btn-editor-caption-fs-back" aria-label="Exit caption fullscreen">
            ${Icons.arrowBack('', 22)}
          </button>
          <span class="editor-caption-fs-title">Caption (${this.items.length} item${this.items.length > 1 ? 's' : ''})</span>
          <div class="editor-caption-fs-actions">
            <button type="button" class="editor-icon-btn" id="btn-ed-rc-undo" title="Undo">${Icons.undo('', 20)}</button>
            <button type="button" class="editor-icon-btn" id="btn-ed-rc-redo" title="Redo">${Icons.redo('', 20)}</button>
            <button type="button" class="editor-icon-btn" id="btn-ed-rc-clear" title="Clear formatting">${Icons.clearFormat('', 20)}</button>
          </div>
        </div>

        <!-- Thumbnail Strip Carousel -->
        <div class="editor-thumbnails-carousel" id="editor-thumbnails-carousel">
          ${this.renderThumbnailsHtml()}
        </div>

        <!-- Rich Caption Bar (Drag-Resizable + Full Format Toolbar + Popovers) -->
        <div class="editor-caption-wrap" id="editor-caption-wrap">
          <div class="editor-caption-pill" id="editor-caption-pill">
            <div class="editor-caption-drag-handle" id="editor-caption-drag-handle" aria-label="Drag to resize caption box">
              <div class="chat-input-drag-dash"></div>
              <button type="button" class="editor-caption-fs-btn" id="btn-editor-caption-fs" title="Fullscreen & formatting" aria-label="Fullscreen caption">
                ${Icons.formatText('', 15)}
              </button>
            </div>
            <div class="editor-caption-main-row">
              <div class="chat-rich-editor is-empty editor-rich-caption" id="editor-caption-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Add a caption..." dir="auto"></div>
            </div>
          </div>

          <div class="editor-caption-toolbar-wrap" id="editor-caption-toolbar-wrap" style="display:none;">
            <div class="composer-popover" id="me-toolbar-popover-host" style="display:none;"></div>
            <div class="editor-caption-toolbar" id="editor-caption-toolbar" role="toolbar" aria-label="Caption formatting tools">
              <button type="button" class="format-tool-btn" data-ed-fmt="align" aria-label="Alignment & Direction">${Icons.alignLeft('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="bold" title="Bold (*text*)"><strong>B</strong></button>
              <button type="button" class="format-tool-btn" data-ed-fmt="italic" title="Italic (_text_)"><em>I</em></button>
              <button type="button" class="format-tool-btn" data-ed-fmt="underline" title="Underline (++text++)"><u>U</u></button>
              <button type="button" class="format-tool-btn" data-ed-fmt="strike" title="Strikethrough (~text~)"><del>S</del></button>
              <button type="button" class="format-tool-btn" data-ed-fmt="highlight" aria-label="Highlight Color">${Icons.highlight('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="header" aria-label="Headers H1-H3"><span class="fmt-txt-icon">H</span></button>
              <button type="button" class="format-tool-btn" data-ed-fmt="spoiler" title="Spoiler (||text||)">${Icons.spoilerEye('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="check" title="Checklist ([ ] )">${Icons.checklist('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="fold" title="Fold Block ([fold:Title]...[/fold])">${Icons.collapseAll('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="ul" aria-label="List Shapes">${Icons.listBulleted('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="ol" title="Numbered List (1. )">${Icons.listNumbered('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="indent-inc" title="Increase Indent">${Icons.indentIncrease('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="indent-dec" title="Decrease Indent">${Icons.indentDecrease('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="link" title="Link on Word">${Icons.linkIcon('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="quote" title="Quote (> )">${Icons.quote('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="code" title="Inline Code (\`code\`)">${Icons.codeBlock('', 21)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="codeblock" title="Code Block (\`\`\` )"><span class="fmt-txt-icon">{ }</span></button>
              <button type="button" class="format-tool-btn" data-ed-fmt="sup" title="Superscript (^^x^^)"><span class="fmt-txt-icon">x²</span></button>
              <button type="button" class="format-tool-btn" data-ed-fmt="sub" title="Subscript (,,x,,)"><span class="fmt-txt-icon">x₂</span></button>
              <button type="button" class="format-tool-btn" data-ed-fmt="undo" title="Undo">${Icons.undo('', 19)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="redo" title="Redo">${Icons.redo('', 19)}</button>
              <button type="button" class="format-tool-btn" data-ed-fmt="clear" title="Clear formatting">${Icons.clearFormat('', 19)}</button>
            </div>
          </div>
        </div>

        <!-- Recipient & Send Row -->
        <div class="editor-bottom-action-row">
          <div class="editor-recipient-pill">
            <span class="editor-recipient-name">${escapeHtml(this.recipientName)}</span>
          </div>

          <button type="button" class="editor-send-btn" id="btn-editor-send" aria-label="Send">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </footer>

      <!-- Hidden file input for Add More -->
      <input type="file" id="editor-add-more-input" accept="${escapeHtml(this.acceptMode || '*/*')}" multiple style="display:none;" />
    `;

    document.body.appendChild(this.container);
    this.bindEvents();
  }

  renderActivePreview(item) {
    if (!item) return '';
    if (item.isVideo) {
      return `<video src="${item.url}" class="editor-main-media" controls autoplay playsinline></video>`;
    }
    if (item.isImage) {
      return `<img src="${item.url}" class="editor-main-media" alt="Preview" />`;
    }
    const sizeText = this._formatFileSize(item.file?.size || 0);
    const iconHtml = item.type === 'pdf'
      ? Icons.pdfIcon('', 52)
      : (item.type === 'audio' ? Icons.mic('', 52) : Icons.documentIcon('', 52));
    return `
      <div class="editor-file-preview-card">
        <div class="editor-file-preview-icon">${iconHtml}</div>
        <div class="editor-file-preview-name" dir="auto">${escapeHtml(item.file?.name || 'Document')}</div>
        <div class="editor-file-preview-meta">${escapeHtml(item.type.toUpperCase())}${sizeText ? ` • ${sizeText}` : ''}</div>
      </div>
    `;
  }

  renderThumbnailsHtml() {
    const thumbs = this.items.map((item, idx) => {
      const isActive = idx === this.activeIndex;
      const thumbBody = (item.isImage || item.isVideo) && item.url
        ? `<img src="${item.url}" class="editor-thumb-img" alt="thumb" />`
        : `<div class="editor-thumb-file-badge">${item.type === 'pdf' ? 'PDF' : (item.type === 'audio' ? '♪' : 'DOC')}</div>`;
      return `
        <div class="editor-thumb-box ${isActive ? 'active' : ''}" data-index="${idx}">
          ${thumbBody}
          ${isActive && this.items.length > 1 ? `
            <button type="button" class="editor-thumb-delete" data-delete-index="${idx}" title="Remove item">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          ` : ''}
        </div>
      `;
    }).join('');

    const addMoreBtn = `
      <button type="button" class="editor-thumb-add-btn" id="btn-editor-add-more" title="Add more files">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
      </button>
    `;

    return thumbs + addMoreBtn;
  }

  updateThumbnails() {
    const carousel = this.container?.querySelector('#editor-thumbnails-carousel');
    if (carousel) {
      carousel.innerHTML = this.renderThumbnailsHtml();
      this.bindThumbnailEvents();
    }
    const stage = this.container?.querySelector('#editor-preview-stage');
    if (stage) {
      stage.innerHTML = this.renderActivePreview(this.items[this.activeIndex]);
    }
  }

  _closeFormatPopover() {
    const pop = this.container?.querySelector('#me-toolbar-popover-host');
    if (pop) {
      pop.style.display = 'none';
      pop.innerHTML = '';
    }
    this._activePopover = null;
  }

  _syncCaptionLayout() {
    if (!this.container) return;
    const editorEl = this.container.querySelector('#editor-caption-editor');
    const pillEl = this.container.querySelector('#editor-caption-pill');
    const toolbarWrap = this.container.querySelector('#editor-caption-toolbar-wrap');
    const dragHandle = this.container.querySelector('#editor-caption-drag-handle');
    const val = this.richComposer ? this.richComposer.getValue() : '';
    const hasContent = val.length > 0;
    const showControls = this.isCaptionFullscreen || this._isEditorFocused || hasContent || this._manualCaptionHeightPx !== null;

    this.container.classList.toggle('is-caption-active', showControls);
    if (dragHandle) {
      dragHandle.style.display = (!this.isCaptionFullscreen && showControls) ? 'flex' : 'none';
    }
    if (toolbarWrap) {
      toolbarWrap.style.display = showControls ? 'block' : 'none';
    }

    if (pillEl && editorEl) {
      const prevScroll = editorEl.scrollTop;
      if (this.isCaptionFullscreen) {
        pillEl.style.height = '';
        editorEl.style.maxHeight = 'none';
      } else if (this._manualCaptionHeightPx !== null) {
        pillEl.style.height = `${this._manualCaptionHeightPx}px`;
        editorEl.style.maxHeight = `${Math.max(44, this._manualCaptionHeightPx - 28)}px`;
      } else {
        pillEl.style.height = '';
        editorEl.style.maxHeight = '';
      }
      editorEl.scrollTop = prevScroll;
    }
  }

  setCaptionFullscreen(enable) {
    this.isCaptionFullscreen = Boolean(enable);
    this._closeFormatPopover();
    if (!this.container) return;
    this.container.classList.toggle('is-caption-fullscreen', this.isCaptionFullscreen);
    const fsHeader = this.container.querySelector('#editor-caption-fs-header');
    if (fsHeader) fsHeader.style.display = this.isCaptionFullscreen ? 'flex' : 'none';
    if (this.isCaptionFullscreen) {
      this._manualCaptionHeightPx = null;
    }
    this._syncCaptionLayout();
    if (this.isCaptionFullscreen) {
      setTimeout(() => {
        this.richComposer?.focus();
        this.richComposer?.scrollCaretIntoView();
      }, 30);
    }
  }

  _updateToolbarActiveStates(activeFormats) {
    const toolbar = this.container?.querySelector('#editor-caption-toolbar');
    if (!toolbar || !activeFormats) return;
    toolbar.querySelectorAll('.format-tool-btn[data-ed-fmt]').forEach((btn) => {
      const fmt = btn.dataset.edFmt;
      let on = false;
      if (fmt === 'header') on = ['h1', 'h2', 'h3'].includes(activeFormats.block);
      else if (fmt === 'align') on = Boolean(activeFormats.align || activeFormats.dir);
      else if (fmt in activeFormats) on = Boolean(activeFormats[fmt]);
      else if (['ul', 'ol', 'check', 'quote', 'codeblock'].includes(fmt)) on = activeFormats.block === fmt;
      btn.classList.toggle('is-active', on);
    });
    const undoBtn = this.container?.querySelector('#btn-ed-rc-undo');
    const redoBtn = this.container?.querySelector('#btn-ed-rc-redo');
    if (undoBtn && this.richComposer) undoBtn.disabled = !this.richComposer.canUndo();
    if (redoBtn && this.richComposer) redoBtn.disabled = !this.richComposer.canRedo();
  }

  async _openWordLinkDialog() {
    if (!this.richComposer) return;
    const selectedLabel = this.richComposer.getSelectedText() || '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay custom-dialog-overlay active';
    overlay.style.zIndex = '10500';
    overlay.innerHTML = `
      <div class="custom-dialog-card" role="dialog" aria-modal="true">
        <h3 class="custom-dialog-title">Insert Word Link</h3>
        <div class="custom-dialog-body composer-modal-fields">
          <label class="composer-modal-field">
            <span>Display word / text</span>
            <input type="text" class="custom-dialog-input composer-dialog-input" id="me-wl-label" value="${escapeHtml(selectedLabel)}" placeholder="Text to link" dir="auto" />
          </label>
          <label class="composer-modal-field">
            <span>URL (https://...)</span>
            <input type="url" class="custom-dialog-input composer-dialog-input" id="me-wl-url" placeholder="https://example.com" dir="ltr" />
          </label>
        </div>
        <div class="custom-dialog-actions">
          <button type="button" class="dialog-btn dialog-btn-cancel" id="me-wl-cancel">Cancel</button>
          <button type="button" class="dialog-btn dialog-btn-confirm" id="me-wl-apply">Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const urlInput = overlay.querySelector('#me-wl-url');
    const labelInput = overlay.querySelector('#me-wl-label');
    (selectedLabel ? urlInput : labelInput)?.focus();

    const closeModal = () => overlay.remove();
    overlay.querySelector('#me-wl-cancel')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    overlay.querySelector('#me-wl-apply')?.addEventListener('click', () => {
      const lbl = (labelInput?.value || '').trim();
      let url = (urlInput?.value || '').trim();
      if (url && !/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
        url = `https://${url}`;
      }
      if (url) {
        this.richComposer?.insertWordLink(lbl || url, url);
      }
      closeModal();
    });
  }

  _showTooltip(btn, text) {
    if (!this.container || !btn || !text) return;
    clearTimeout(this._tooltipTimer);
    let el = this.container.querySelector('#me-action-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'me-action-tooltip';
      el.className = 'composer-action-tooltip';
      this.container.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
    const rect = btn.getBoundingClientRect();
    const pRect = this.container.getBoundingClientRect();
    el.style.top = `${Math.max(12, Math.round(rect.top - pRect.top - 36))}px`;
    el.style.left = `${Math.max(12, Math.min(pRect.width - 160, Math.round(rect.left - pRect.left + rect.width / 2 - 60)))}px`;
    this._tooltipTimer = setTimeout(() => {
      if (el) el.style.display = 'none';
    }, 1500);
  }

  _hideTooltip() {
    clearTimeout(this._tooltipTimer);
    const el = this.container?.querySelector('#me-action-tooltip');
    if (el) el.style.display = 'none';
  }

  bindEvents() {
    const editorEl = this.container.querySelector('#editor-caption-editor');
    const pillEl = this.container.querySelector('#editor-caption-pill');
    const dragHandle = this.container.querySelector('#editor-caption-drag-handle');
    const fsHeader = this.container.querySelector('#editor-caption-fs-header');
    const popoverHost = this.container.querySelector('#me-toolbar-popover-host');

    const triggerSend = () => {
      const caption = (this.richComposer ? this.richComposer.getValue() : '').trim();
      const files = this.items.map((i) => i.file);
      this._sent = true;
      this.close(true);
      this.onSend({ files, caption, isHd: this.isHd });
    };

    this.richComposer = new RichComposer(editorEl, {
      onChange: () => {
        this._syncCaptionLayout();
        this.richComposer?.scrollCaretIntoView();
      },
      onSelectionChange: (activeFormats) => {
        this._updateToolbarActiveStates(activeFormats);
      },
      onSubmit: triggerSend,
      shouldEnterSend: () => !this.isCaptionFullscreen && localStorage.getItem('wa_enter_to_send') !== 'false' && window.matchMedia?.('(pointer: fine)')?.matches
    });

    if (this.initialCaption) {
      this.richComposer.setValue(this.initialCaption);
    }

    // Immediate focus/touch reveal for drag handle + full format toolbar
    let blurTimer = null;
    const onFocusActivate = () => {
      clearTimeout(blurTimer);
      if (!this._isEditorFocused) {
        this._isEditorFocused = true;
        this._syncCaptionLayout();
      }
    };
    editorEl.addEventListener('pointerdown', onFocusActivate);
    editorEl.addEventListener('focus', () => {
      onFocusActivate();
      this.richComposer?.scrollCaretIntoView();
    });
    editorEl.addEventListener('blur', () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!this.container) return;
        const ae = document.activeElement;
        const insideCaptionUi = Boolean(ae && this.container.querySelector('#editor-caption-wrap')?.contains(ae));
        if (!insideCaptionUi) {
          this._isEditorFocused = false;
          this._syncCaptionLayout();
        }
      }, 90);
    });

    // Free drag-resize of caption pill (pull up to expand freely or snap into fullscreen >= 78%)
    const startCaptionDrag = (e) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.target.closest('button')) return;
      if (!pillEl) return;

      const startY = e.clientY;
      const modalH = Math.max(320, this.container.getBoundingClientRect().height || window.innerHeight || 640);
      const startH = this.isCaptionFullscreen ? Math.round(modalH * 0.85) : pillEl.getBoundingClientRect().height;
      let dragging = false;
      let latestH = startH;

      const onMove = (ev) => {
        const dy = startY - ev.clientY;
        if (!dragging) {
          if (Math.abs(dy) < 6) return;
          dragging = true;
          this.container.classList.add('is-caption-dragging');
        }
        ev.preventDefault();
        latestH = Math.max(52, Math.min(modalH * 0.9, startH + dy));
        const ratio = latestH / modalH;
        if (ratio >= 0.78) {
          if (!this.isCaptionFullscreen) this.setCaptionFullscreen(true);
        } else {
          if (this.isCaptionFullscreen) this.setCaptionFullscreen(false);
          this._manualCaptionHeightPx = Math.round(latestH);
          this._syncCaptionLayout();
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        this.container?.classList.remove('is-caption-dragging');
        if (!dragging) return;
        if (latestH <= 76 && !this.isCaptionFullscreen) {
          this._manualCaptionHeightPx = null;
          this._syncCaptionLayout();
        }
      };

      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

    if (dragHandle) dragHandle.addEventListener('pointerdown', startCaptionDrag);
    if (fsHeader) fsHeader.addEventListener('pointerdown', startCaptionDrag);

    // Close
    this.container.querySelector('#btn-editor-close').addEventListener('click', () => {
      this.close(true);
    });

    // Fullscreen toggle & header undo/redo/clear
    this.container.querySelector('#btn-editor-caption-fs')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setCaptionFullscreen(!this.isCaptionFullscreen);
    });
    this.container.querySelector('#btn-editor-caption-fs-back')?.addEventListener('click', () => {
      this.setCaptionFullscreen(false);
    });
    this.container.querySelector('#btn-ed-rc-undo')?.addEventListener('click', () => this.richComposer?.undo());
    this.container.querySelector('#btn-ed-rc-redo')?.addEventListener('click', () => this.richComposer?.redo());
    this.container.querySelector('#btn-ed-rc-clear')?.addEventListener('click', () => this.richComposer?.clearFormatting());

    // Full Rich Formatting Toolbar + Popovers
    this.container.querySelectorAll('.format-tool-btn[data-ed-fmt]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.richComposer) return;
        const fmt = btn.dataset.edFmt;

        if (POPOVER_FORMAT_TOOLS.has(fmt)) {
          this._hideTooltip();
        } else if (TOOL_ACTION_NAMES[fmt]) {
          this._showTooltip(btn, TOOL_ACTION_NAMES[fmt]);
        }

        if (fmt === 'align' && popoverHost) {
          if (this._activePopover === 'align') { this._closeFormatPopover(); return; }
          this._activePopover = 'align';
          const curFmt = this.richComposer.getActiveFormats();
          popoverHost.innerHTML = `
            <div class="composer-popover-title">Alignment & Direction (المحاذاة والاتجاه)</div>
            <div class="composer-align-grid">
              <button type="button" class="composer-align-btn ${curFmt.align === 'left' ? 'is-active' : ''}" data-al="left">${Icons.alignLeft('', 18)}<span>Left</span></button>
              <button type="button" class="composer-align-btn ${curFmt.align === 'center' ? 'is-active' : ''}" data-al="center">${Icons.alignCenter('', 18)}<span>Center</span></button>
              <button type="button" class="composer-align-btn ${curFmt.align === 'right' ? 'is-active' : ''}" data-al="right">${Icons.alignRight('', 18)}<span>Right</span></button>
            </div>
            <div class="composer-dir-grid">
              <button type="button" class="composer-align-btn ${!curFmt.dir ? 'is-active' : ''}" data-dir="auto">Auto</button>
              <button type="button" class="composer-align-btn ${curFmt.dir === 'ltr' ? 'is-active' : ''}" data-dir="ltr">${Icons.textDirLtr('', 16)}<span>LTR</span></button>
              <button type="button" class="composer-align-btn ${curFmt.dir === 'rtl' ? 'is-active' : ''}" data-dir="rtl">${Icons.textDirRtl('', 16)}<span>RTL</span></button>
            </div>
          `;
          popoverHost.style.display = 'block';
          popoverHost.querySelectorAll('[data-al]').forEach((ab) => {
            ab.addEventListener('mousedown', (ev) => ev.preventDefault());
            ab.addEventListener('click', (ev) => {
              ev.stopPropagation();
              this.richComposer.setBlockAlignment(ab.dataset.al);
              this._closeFormatPopover();
            });
          });
          popoverHost.querySelectorAll('[data-dir]').forEach((dbBtn) => {
            dbBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
            dbBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              this.richComposer.setBlockDirection(dbBtn.dataset.dir);
              this._closeFormatPopover();
            });
          });
          return;
        }

        if (fmt === 'highlight' && popoverHost) {
          if (this._activePopover === 'highlight') { this._closeFormatPopover(); return; }
          this._activePopover = 'highlight';
          const swatches = Object.entries(HIGHLIGHT_COLORS).map(([code, def]) => `
            <button type="button" class="hl-swatch-btn wa-hl-${def.name}" data-hl-code="${code}">
              <span class="hl-swatch-dot" style="background:${def.hex};"></span>
              <span>${def.label}</span>
            </button>
          `).join('');
          popoverHost.innerHTML = `
            <div class="composer-popover-title">Highlight Color (اختر لون التظليل)</div>
            <div class="composer-popover-row">
              ${swatches}
              <button type="button" class="hl-swatch-btn hl-clear-btn" data-hl-code="none">Remove</button>
            </div>
          `;
          popoverHost.style.display = 'block';
          popoverHost.querySelectorAll('[data-hl-code]').forEach((sw) => {
            sw.addEventListener('mousedown', (ev) => ev.preventDefault());
            sw.addEventListener('click', (ev) => {
              ev.stopPropagation();
              this.richComposer.toggleInline('highlight', sw.dataset.hlCode);
              this._closeFormatPopover();
            });
          });
          return;
        }

        if (fmt === 'header' && popoverHost) {
          if (this._activePopover === 'header') { this._closeFormatPopover(); return; }
          this._activePopover = 'header';
          const curBlock = this.richComposer.getActiveFormats().block;
          popoverHost.innerHTML = `
            <div class="composer-popover-title">Headers (اختر حجم العنوان)</div>
            <div class="composer-popover-row">
              ${['p', 'h1', 'h2', 'h3'].map((b) => `
                <button type="button" class="header-pick-btn ${curBlock === b ? 'is-active' : ''}" data-h-block="${b}">
                  ${b === 'p' ? 'Normal' : b.toUpperCase()}
                </button>
              `).join('')}
            </div>
          `;
          popoverHost.style.display = 'block';
          popoverHost.querySelectorAll('[data-h-block]').forEach((hb) => {
            hb.addEventListener('mousedown', (ev) => ev.preventDefault());
            hb.addEventListener('click', (ev) => {
              ev.stopPropagation();
              this.richComposer.toggleBlock(hb.dataset.hBlock);
              this._closeFormatPopover();
            });
          });
          return;
        }

        if (fmt === 'ul' && popoverHost) {
          if (this._activePopover === 'ul') { this._closeFormatPopover(); return; }
          this._activePopover = 'ul';
          popoverHost.innerHTML = `
            <div class="composer-popover-title">List Shapes (أشكال القوائم النقطية)</div>
            <div class="composer-popover-row">
              <button type="button" class="list-shape-pick-btn" data-ul-shape="bullet">
                <span class="shape-glyph is-bullet">•</span>
                <span>نقطة عريضة</span>
              </button>
              <button type="button" class="list-shape-pick-btn" data-ul-shape="arrow">
                <span class="shape-glyph is-arrow">→</span>
                <span>سهم عادي</span>
              </button>
              <button type="button" class="list-shape-pick-btn" data-ul-shape="branch">
                <span class="shape-glyph is-branch">↳</span>
                <span>سهم متفرع</span>
              </button>
            </div>
          `;
          popoverHost.style.display = 'block';
          popoverHost.querySelectorAll('[data-ul-shape]').forEach((sb) => {
            sb.addEventListener('mousedown', (ev) => ev.preventDefault());
            sb.addEventListener('click', (ev) => {
              ev.stopPropagation();
              this.richComposer.toggleBlock('ul', { bulletType: sb.dataset.ulShape });
              this._closeFormatPopover();
            });
          });
          return;
        }

        this._closeFormatPopover();

        if (fmt === 'fold') {
          this.richComposer.insertFoldBlock();
        } else if (fmt === 'link') {
          await this._openWordLinkDialog();
        } else if (fmt === 'indent-inc') {
          this.richComposer.indent(1);
        } else if (fmt === 'indent-dec') {
          this.richComposer.indent(-1);
        } else if (fmt === 'undo') {
          this.richComposer.undo();
        } else if (fmt === 'redo') {
          this.richComposer.redo();
        } else if (fmt === 'clear') {
          this.richComposer.clearFormatting();
        } else if (['ol', 'check', 'quote', 'codeblock'].includes(fmt)) {
          this.richComposer.toggleBlock(fmt);
        } else {
          this.richComposer.toggleInline(fmt);
        }
      });
    });

    // HD Quality Toggle
    const hdBtn = this.container.querySelector('#btn-editor-hd');
    if (hdBtn) {
      hdBtn.addEventListener('click', () => {
        this.isHd = !this.isHd;
        hdBtn.classList.toggle('active', this.isHd);
      });
    }

    // Send Button
    this.container.querySelector('#btn-editor-send').addEventListener('click', triggerSend);

    this._syncCaptionLayout();
    this.bindThumbnailEvents();
  }

  bindThumbnailEvents() {
    const thumbBoxes = this.container.querySelectorAll('.editor-thumb-box');
    thumbBoxes.forEach((box) => {
      box.addEventListener('click', (e) => {
        if (e.target.closest('.editor-thumb-delete')) return;
        const idx = parseInt(box.dataset.index, 10);
        if (this.activeIndex !== idx) {
          this.activeIndex = idx;
          this.updateThumbnails();
        }
      });
    });

    const deleteBtns = this.container.querySelectorAll('.editor-thumb-delete');
    deleteBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const delIdx = parseInt(btn.dataset.deleteIndex, 10);
        this.items.splice(delIdx, 1);
        if (this.activeIndex >= this.items.length) {
          this.activeIndex = Math.max(0, this.items.length - 1);
        }
        if (this.items.length === 0) {
          this.close(true);
        } else {
          this.updateThumbnails();
        }
      });
    });

    const addMoreBtn = this.container.querySelector('#btn-editor-add-more');
    const fileInput = this.container.querySelector('#editor-add-more-input');
    if (addMoreBtn && fileInput) {
      addMoreBtn.addEventListener('click', () => {
        fileInput.click();
      });

      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.addFiles(Array.from(e.target.files));
          fileInput.value = '';
        }
      });
    }
  }

  close(notifyRouter = true) {
    if (this.isCaptionFullscreen && !this._sent && !notifyRouter) {
      // Hardware back first exits caption fullscreen before closing modal
      this.setCaptionFullscreen(false);
      window.router?.pushOverlay('media-editor-modal', () => this.close(false));
      return;
    }

    clearTimeout(this._tooltipTimer);
    const latestCaption = this.richComposer ? this.richComposer.getValue() : this.initialCaption;
    if (!this._sent && typeof this.onCancel === 'function') {
      try {
        this.onCancel(latestCaption);
      } catch (_) {}
    }

    if (this.richComposer) {
      this.richComposer.destroy();
      this.richComposer = null;
    }

    if (notifyRouter && window.router) {
      window.router.removeOverlay('media-editor-modal');
    }
    if (this.container) {
      this.items.forEach((item) => {
        if (item.url) {
          try { URL.revokeObjectURL(item.url); } catch (e) {}
        }
      });
      const closingEl = this.container;
      closingEl.classList.add('overlay-closing');
      setTimeout(() => closingEl.remove(), 210);
      this.container = null;
    }
  }
}
