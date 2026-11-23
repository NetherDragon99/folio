// Component: Fullscreen WhatsApp Multi-Media & File Editor with Unified Rich Caption + Fullscreen Composer
import { Icons } from '../icons.js';
import { RichComposer } from './rich-composer.js';
import { HIGHLIGHT_COLORS, escapeHtml } from '../utils/rich-text.js';

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

      <!-- Bottom Panel: Thumbnails, Rich Caption (with Fullscreen Mode) & Send -->
      <footer class="media-editor-footer" id="media-editor-footer">
        <div class="editor-caption-fs-header" id="editor-caption-fs-header" style="display: none;">
          <button type="button" class="editor-icon-btn" id="btn-editor-caption-fs-back" aria-label="Exit caption fullscreen">
            ${Icons.arrowBack('', 22)}
          </button>
          <span class="editor-caption-fs-title">Caption (${this.items.length} item${this.items.length > 1 ? 's' : ''})</span>
          <div class="editor-caption-fs-actions">
            <button type="button" class="editor-icon-btn" id="btn-ed-rc-undo" title="Undo">${Icons.undo('', 20)}</button>
            <button type="button" class="editor-icon-btn" id="btn-ed-rc-redo" title="Redo">${Icons.redo('', 20)}</button>
          </div>
        </div>

        <!-- Thumbnail Strip Carousel -->
        <div class="editor-thumbnails-carousel" id="editor-thumbnails-carousel">
          ${this.renderThumbnailsHtml()}
        </div>

        <!-- Rich Caption Bar -->
        <div class="editor-caption-wrap">
          <div class="editor-caption-pill" id="editor-caption-pill">
            <div class="chat-rich-editor is-empty editor-rich-caption" id="editor-caption-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Add a caption..." dir="auto"></div>
            <button type="button" class="editor-caption-fs-btn" id="btn-editor-caption-fs" title="Fullscreen & formatting" aria-label="Fullscreen caption">
              ${Icons.formatText('', 20)}
            </button>
          </div>

          <div class="editor-caption-toolbar" id="editor-caption-toolbar" style="display:none;">
            <button type="button" class="format-tool-btn" data-ed-fmt="bold" title="Bold"><strong>B</strong></button>
            <button type="button" class="format-tool-btn" data-ed-fmt="italic" title="Italic"><em>I</em></button>
            <button type="button" class="format-tool-btn" data-ed-fmt="underline" title="Underline"><u>U</u></button>
            <button type="button" class="format-tool-btn" data-ed-fmt="strike" title="Strike"><del>S</del></button>
            <button type="button" class="format-tool-btn" data-ed-fmt="highlight" title="Highlight">${Icons.highlight('', 20)}</button>
            <button type="button" class="format-tool-btn" data-ed-fmt="code" title="Code">${Icons.codeBlock('', 20)}</button>
            <button type="button" class="format-tool-btn" data-ed-fmt="check" title="Checklist">${Icons.checklist('', 20)}</button>
            <button type="button" class="format-tool-btn" data-ed-fmt="ul" title="List">${Icons.listBulleted('', 20)}</button>
            <button type="button" class="format-tool-btn" data-ed-fmt="ol" title="Numbered">${Icons.listNumbered('', 20)}</button>
            <button type="button" class="format-tool-btn" data-ed-fmt="quote" title="Quote">${Icons.quote('', 20)}</button>
            <button type="button" class="format-tool-btn" data-ed-fmt="align-left" title="Align Left">${Icons.alignLeft('', 20)}</button>
            <button type="button" class="format-tool-btn" data-ed-fmt="align-center" title="Align Center">${Icons.alignCenter('', 20)}</button>
            <button type="button" class="format-tool-btn" data-ed-fmt="align-right" title="Align Right">${Icons.alignRight('', 20)}</button>
            <button type="button" class="format-tool-btn" data-ed-fmt="dir-rtl" title="RTL">${Icons.textDirRtl('', 20)}</button>
            <button type="button" class="format-tool-btn" data-ed-fmt="dir-ltr" title="LTR">${Icons.textDirLtr('', 20)}</button>
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

  setCaptionFullscreen(enable) {
    this.isCaptionFullscreen = Boolean(enable);
    if (!this.container) return;
    this.container.classList.toggle('is-caption-fullscreen', this.isCaptionFullscreen);
    const fsHeader = this.container.querySelector('#editor-caption-fs-header');
    const toolbar = this.container.querySelector('#editor-caption-toolbar');
    if (fsHeader) fsHeader.style.display = this.isCaptionFullscreen ? 'flex' : 'none';
    if (toolbar) toolbar.style.display = this.isCaptionFullscreen ? 'flex' : 'none';
    if (this.isCaptionFullscreen) {
      setTimeout(() => {
        this.richComposer?.focus();
        this.richComposer?.scrollCaretIntoView();
      }, 30);
    }
  }

  bindEvents() {
    const editorEl = this.container.querySelector('#editor-caption-editor');
    const triggerSend = () => {
      const caption = (this.richComposer ? this.richComposer.getValue() : '').trim();
      const files = this.items.map((i) => i.file);
      this._sent = true;
      this.close(true);
      this.onSend({ files, caption, isHd: this.isHd });
    };

    this.richComposer = new RichComposer(editorEl, {
      onSubmit: triggerSend,
      shouldEnterSend: () => !this.isCaptionFullscreen && localStorage.getItem('wa_enter_to_send') !== 'false' && window.matchMedia?.('(pointer: fine)')?.matches
    });

    if (this.initialCaption) {
      this.richComposer.setValue(this.initialCaption);
    }

    // Close
    this.container.querySelector('#btn-editor-close').addEventListener('click', () => {
      this.close(true);
    });

    // Fullscreen toggle
    this.container.querySelector('#btn-editor-caption-fs')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.setCaptionFullscreen(!this.isCaptionFullscreen);
    });
    this.container.querySelector('#btn-editor-caption-fs-back')?.addEventListener('click', () => {
      this.setCaptionFullscreen(false);
    });
    this.container.querySelector('#btn-ed-rc-undo')?.addEventListener('click', () => this.richComposer?.undo());
    this.container.querySelector('#btn-ed-rc-redo')?.addEventListener('click', () => this.richComposer?.redo());

    // Formatting buttons in fullscreen caption toolbar
    this.container.querySelectorAll('.format-tool-btn[data-ed-fmt]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const fmt = btn.dataset.edFmt;
        if (!this.richComposer) return;
        if (['bold', 'italic', 'underline', 'strike', 'code'].includes(fmt)) {
          this.richComposer.toggleInline(fmt);
        } else if (fmt === 'highlight') {
          this.richComposer.toggleInline('highlight', 'y');
        } else if (['check', 'ul', 'ol', 'quote'].includes(fmt)) {
          this.richComposer.toggleBlock(fmt);
        } else if (fmt.startsWith('align-')) {
          this.richComposer.setBlockAlignment(fmt.slice(6));
        } else if (fmt.startsWith('dir-')) {
          this.richComposer.setBlockDirection(fmt.slice(4));
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
