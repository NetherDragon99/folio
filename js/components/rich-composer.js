/**
 * Real-Time WYSIWYG Rich Composer (contenteditable)
 * - Auto-applies WhatsApp and custom unique shortcuts immediately without showing raw markup symbols
 * - Supports interactive checklist editing, nested lists (Tab / Shift+Tab), headers H1-H3,
 *   6 highlight colors, underline, spoiler, superscript/subscript, code, blockquotes, and word hyperlinks
 * - Serializes cleanly to canonical markup for unlimited-length storage, search, and editing
 */
import {
  HIGHLIGHT_COLORS,
  escapeHtml,
  sanitizeUrl,
  extractLineLayoutDirectives,
  formatLineLayoutPrefix,
  parseEmbedDirective
} from '../utils/rich-text.js';

export class RichComposer {
  constructor(editorEl, {
    onChange = () => {},
    onSelectionChange = () => {},
    onSubmit = null,
    shouldEnterSend = null,
    onEditInlineWhiteboard = null
  } = {}) {
    this.el = editorEl;
    this.onChange = onChange;
    this.onSelectionChange = onSelectionChange;
    this.onSubmit = onSubmit;
    this.shouldEnterSend = shouldEnterSend;
    this.onEditInlineWhiteboard = onEditInlineWhiteboard;

    this._isComposing = false;
    this._suppressInput = false;
    this._savedRange = null;
    this._lastBulletType = 'bullet';
    this._embedPreviewUrls = new Map();
    this._undoStack = [''];
    this._undoIdx = 0;
    this._maxHistory = 60;

    this._bindEvents();
    this._ensureAtLeastOneBlock();
  }

  _bindEvents() {
    this._onCompositionStart = () => { this._isComposing = true; };
    this._onCompositionEnd = () => {
      this._isComposing = false;
      this._handleInput();
    };
    this._onInput = () => {
      if (this._suppressInput || this._isComposing) return;
      this._handleInput();
    };
    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._onPaste = (e) => this._handlePaste(e);
    this._onClick = (e) => {
      const toggle = e.target.closest?.('.rc-check-toggle');
      if (toggle && this.el.contains(toggle)) {
        e.preventDefault();
        e.stopPropagation();
        const block = toggle.closest('.rc-block[data-block="check"]');
        if (block) {
          const isChecked = block.dataset.checked === 'true';
          block.dataset.checked = isChecked ? 'false' : 'true';
          this._pushHistory();
          this.onChange(this.getValue());
        }
        return;
      }
      const foldToggle = e.target.closest?.('.rc-fold-toggle');
      if (foldToggle && this.el.contains(foldToggle)) {
        e.preventDefault();
        e.stopPropagation();
        const foldEl = foldToggle.closest('.rc-block[data-block="fold"]');
        if (foldEl) {
          const nextOpen = foldEl.dataset.open !== 'false' ? 'false' : 'true';
          foldEl.dataset.open = nextOpen;
          foldToggle.textContent = nextOpen === 'true' ? '▼' : '▶';
        }
        return;
      }
      const foldRemove = e.target.closest?.('.rc-fold-remove');
      if (foldRemove && this.el.contains(foldRemove)) {
        e.preventDefault();
        e.stopPropagation();
        const foldEl = foldRemove.closest('.rc-block[data-block="fold"]');
        if (foldEl) {
          this._unwrapFoldBlock(foldEl);
        }
        return;
      }
      const embedLayoutBtn = e.target.closest?.('.rc-embed-layout-btn');
      if (embedLayoutBtn && this.el.contains(embedLayoutBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const emb = embedLayoutBtn.closest('.rc-block[data-block="embed"]');
        const nextLayout = embedLayoutBtn.dataset.layout;
        if (emb && nextLayout) {
          emb.dataset.embedLayout = nextLayout;
          emb.classList.remove('is-layout-full', 'is-layout-left', 'is-layout-right');
          emb.classList.add(`is-layout-${nextLayout}`);
          emb.querySelectorAll('.rc-embed-layout-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.layout === nextLayout);
          });
          this._pushHistory();
          this.onChange(this.getValue());
        }
        return;
      }
      const embedEditBtn = e.target.closest?.('.rc-embed-edit-btn');
      if (embedEditBtn && this.el.contains(embedEditBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const emb = embedEditBtn.closest('.rc-block[data-block="embed"]');
        if (emb && typeof this.onEditInlineWhiteboard === 'function') {
          this.onEditInlineWhiteboard(emb.dataset.embedMediaId, emb);
        }
        return;
      }
      const embedRemoveBtn = e.target.closest?.('.rc-embed-remove-btn');
      if (embedRemoveBtn && this.el.contains(embedRemoveBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const emb = embedRemoveBtn.closest('.rc-block[data-block="embed"]');
        if (emb) {
          emb.remove();
          this._ensureAtLeastOneBlock();
          this._pushHistory();
          this.onChange(this.getValue());
          this.onSelectionChange(this.getActiveFormats());
        }
        return;
      }
      this._saveSelection();
      this.onSelectionChange(this.getActiveFormats());
    };
    this._onKeyUp = () => {
      this._saveSelection();
      this.onSelectionChange(this.getActiveFormats());
    };
    this._onBlur = () => {
      this._saveSelection();
    };

    this.el.addEventListener('compositionstart', this._onCompositionStart);
    this.el.addEventListener('compositionend', this._onCompositionEnd);
    this.el.addEventListener('input', this._onInput);
    this.el.addEventListener('keydown', this._onKeyDown);
    this.el.addEventListener('paste', this._onPaste);
    this.el.addEventListener('click', this._onClick);
    this.el.addEventListener('keyup', this._onKeyUp);
    this.el.addEventListener('blur', this._onBlur);
  }

  destroy() {
    if (!this.el) return;
    this.el.removeEventListener('compositionstart', this._onCompositionStart);
    this.el.removeEventListener('compositionend', this._onCompositionEnd);
    this.el.removeEventListener('input', this._onInput);
    this.el.removeEventListener('keydown', this._onKeyDown);
    this.el.removeEventListener('paste', this._onPaste);
    this.el.removeEventListener('click', this._onClick);
    this.el.removeEventListener('keyup', this._onKeyUp);
    this.el.removeEventListener('blur', this._onBlur);
  }

  focus() {
    this.el?.focus();
  }

  isEmpty() {
    return this.getValue().length === 0;
  }

  clear() {
    this.setValue('');
  }

  // --- Selection Helpers ---
  _saveSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (this.el.contains(range.commonAncestorContainer)) {
      this._savedRange = range.cloneRange();
    }
  }

  restoreSelection() {
    const sel = window.getSelection();
    if (!sel) return;
    if (this._savedRange && this.el.contains(this._savedRange.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(this._savedRange);
    } else {
      this.focus();
      const targetBody = this._getBlockBodyEl(this.el.lastElementChild) || this.el;
      if (targetBody) {
        this._placeCaretAtEnd(targetBody);
      }
    }
  }

  _normalizeBlockContainer(containerEl) {
    if (!containerEl) return;
    if (!containerEl.firstChild) {
      const p = document.createElement('div');
      p.className = 'rc-block rc-p';
      p.dataset.block = 'p';
      p.appendChild(document.createElement('br'));
      containerEl.appendChild(p);
      return;
    }
    const children = Array.from(containerEl.childNodes);
    for (const node of children) {
      if (node.nodeType === 3 || (node.nodeType === 1 && !node.classList?.contains('rc-block'))) {
        if (node.nodeType === 1 && node.tagName === 'DIV' && !node.dataset?.block) {
          node.className = 'rc-block rc-p';
          node.dataset.block = 'p';
        } else {
          const p = document.createElement('div');
          p.className = 'rc-block rc-p';
          p.dataset.block = 'p';
          node.parentNode.insertBefore(p, node);
          p.appendChild(node);
        }
      }
    }
  }

  _ensureAtLeastOneBlock() {
    if (!this.el) return;
    this._normalizeBlockContainer(this.el);
    this.el.querySelectorAll?.('.rc-fold-body').forEach((bodyEl) => {
      this._normalizeBlockContainer(bodyEl);
    });
    this._syncEmptyState();
    this._syncOrderedNumbers();
  }

  _syncEmptyState() {
    const val = this.getValue();
    const hasFold = Boolean(this.el.querySelector?.('.rc-fold'));
    const hasEmbed = Boolean(this.el.querySelector?.('.rc-embed'));
    this.el.classList.toggle('is-empty', val.length === 0 && !hasFold && !hasEmbed);
  }

  scrollCaretIntoView() {
    if (!this.el || typeof this.el.getBoundingClientRect !== 'function') return;
    const run = () => {
      if (!this.el) return;
      const sel = window.getSelection?.();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!this.el.contains(range.startContainer)) return;

      let targetRect = null;
      const rects = range.getClientRects ? range.getClientRects() : [];
      if (rects && rects.length > 0) {
        targetRect = rects[rects.length - 1];
      } else if (range.getBoundingClientRect) {
        const br = range.getBoundingClientRect();
        if (br && (br.height > 0 || br.top > 0 || br.bottom > 0)) {
          targetRect = br;
        }
      }
      if (!targetRect || (targetRect.top === 0 && targetRect.bottom === 0)) {
        const blk = this._getBlockElement(range.startContainer);
        if (blk && blk.getBoundingClientRect) {
          targetRect = blk.getBoundingClientRect();
        }
      }
      if (!targetRect) return;

      const elRect = this.el.getBoundingClientRect();
      const padBottom = 18;
      const padTop = 10;
      if (targetRect.bottom > elRect.bottom - padBottom) {
        this.el.scrollTop += (targetRect.bottom - (elRect.bottom - padBottom));
      } else if (targetRect.top < elRect.top + padTop) {
        this.el.scrollTop -= ((elRect.top + padTop) - targetRect.top);
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run);
    } else {
      run();
    }
  }

  _syncOrderedNumbersInContainer(containerEl) {
    if (!containerEl) return;
    const counters = new Map();
    const blocks = Array.from(containerEl.querySelectorAll(':scope > .rc-block'));
    for (const blk of blocks) {
      if (blk.dataset.block === 'ol') {
        const indent = Number(blk.dataset.indent || 0);
        for (const k of Array.from(counters.keys())) {
          if (k > indent) counters.delete(k);
        }
        const nextNum = (counters.get(indent) || 0) + 1;
        counters.set(indent, nextNum);
        blk.dataset.olNum = String(nextNum);
        const badge = blk.querySelector(':scope > .rc-ol-marker');
        if (badge) badge.textContent = `${nextNum}.`;
      } else if (blk.dataset.block !== 'ul' && blk.dataset.block !== 'check') {
        counters.clear();
      }
    }
  }

  _syncOrderedNumbers() {
    if (!this.el) return;
    this._syncOrderedNumbersInContainer(this.el);
    this.el.querySelectorAll?.('.rc-fold-body').forEach((bodyEl) => {
      this._syncOrderedNumbersInContainer(bodyEl);
    });
  }

  _getBlockElement(node) {
    let cur = node;
    while (cur && cur !== this.el) {
      if (cur.nodeType === 1 && cur.classList?.contains('rc-block')) {
        return cur;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  _getEnclosingFold(node) {
    let cur = node;
    while (cur && cur !== this.el) {
      if (cur.nodeType === 1 && cur.classList?.contains('rc-fold')) {
        return cur;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  _getFoldTitleEl(node) {
    let cur = node;
    while (cur && cur !== this.el) {
      if (cur.nodeType === 1 && cur.classList?.contains('rc-fold-title')) {
        return cur;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  _getBlockBodyEl(blockEl) {
    if (!blockEl) return null;
    if (blockEl.dataset.block === 'check' || blockEl.dataset.block === 'ol' || blockEl.dataset.block === 'ul') {
      return blockEl.querySelector(':scope > .rc-item-body') || blockEl;
    }
    if (blockEl.dataset.block === 'fold') {
      return blockEl.querySelector(':scope > .rc-fold-body') || blockEl;
    }
    return blockEl;
  }

  _makeBlockEl(type, options = {}) {
    const indent = Math.max(0, Math.min(3, Number(options.indent) || 0));
    if (type === 'codeblock') {
      const pre = document.createElement('pre');
      pre.className = 'rc-block rc-codeblock';
      pre.dataset.block = 'codeblock';
      if (options.text !== undefined) {
        pre.textContent = options.text;
      }
      if (!pre.firstChild) pre.appendChild(document.createElement('br'));
      return pre;
    }

    if (type === 'fold') {
      const div = document.createElement('div');
      div.className = 'rc-block rc-fold';
      div.dataset.block = 'fold';
      const isOpen = options.open !== false;
      div.dataset.open = isOpen ? 'true' : 'false';

      const header = document.createElement('div');
      header.className = 'rc-fold-header';

      const toggle = document.createElement('span');
      toggle.className = 'rc-fold-toggle';
      toggle.setAttribute('contenteditable', 'false');
      toggle.setAttribute('role', 'button');
      toggle.title = 'Toggle fold preview';
      toggle.textContent = isOpen ? '▼' : '▶';

      const titleEl = document.createElement('div');
      titleEl.className = 'rc-fold-title';
      titleEl.dataset.placeholder = 'عنوان القسم القابل للطي...';
      titleEl.setAttribute('dir', 'auto');
      this._populateInlineNodes(titleEl, options.title || '');

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'rc-fold-remove';
      removeBtn.setAttribute('contenteditable', 'false');
      removeBtn.title = 'Remove fold block';
      removeBtn.setAttribute('aria-label', 'Remove fold block');
      removeBtn.textContent = '×';

      header.appendChild(toggle);
      header.appendChild(titleEl);
      header.appendChild(removeBtn);

      const bodyEl = document.createElement('div');
      bodyEl.className = 'rc-fold-body';
      bodyEl.setAttribute('dir', 'auto');
      this._renderMarkupToContainer(bodyEl, options.bodyMarkup || '');

      div.appendChild(header);
      div.appendChild(bodyEl);
      return div;
    }

    if (type === 'embed') {
      const kind = options.kind || 'file';
      const mediaId = String(options.mediaId || '');
      const layout = options.layout || 'full';
      const label = options.label || (kind === 'image' ? 'Photo' : (kind === 'audio' ? 'Voice note' : (kind === 'whiteboard' ? 'Whiteboard' : 'File')));
      const previewUrl = options.previewUrl || this._embedPreviewUrls.get(mediaId) || '';
      if (previewUrl && mediaId) this._embedPreviewUrls.set(mediaId, previewUrl);

      const div = document.createElement('div');
      div.className = `rc-block rc-embed is-layout-${layout}`;
      div.dataset.block = 'embed';
      div.dataset.embedKind = kind;
      div.dataset.embedMediaId = mediaId;
      div.dataset.embedLayout = layout;
      div.dataset.embedLabel = label;
      div.setAttribute('contenteditable', 'false');

      const thumbHtml = (kind === 'image' || kind === 'whiteboard') && previewUrl
        ? `<img src="${escapeHtml(previewUrl)}" class="rc-embed-thumb" alt="${escapeHtml(label)}" />`
        : `<span class="rc-embed-icon">${kind === 'audio' ? '🎤' : (kind === 'whiteboard' ? '🎨' : (kind === 'image' ? '🖼' : '📎'))}</span>`;

      div.innerHTML = `
        <div class="rc-embed-drag-grip" title="Hold & drag to reorder">☰</div>
        <div class="rc-embed-preview">${thumbHtml}<span class="rc-embed-label">${escapeHtml(label)}</span></div>
        <div class="rc-embed-controls">
          <button type="button" class="rc-embed-layout-btn ${layout === 'full' ? 'active' : ''}" data-layout="full" title="Full width">Full</button>
          <button type="button" class="rc-embed-layout-btn ${layout === 'left' ? 'active' : ''}" data-layout="left" title="Float Left">L</button>
          <button type="button" class="rc-embed-layout-btn ${layout === 'right' ? 'active' : ''}" data-layout="right" title="Float Right">R</button>
          ${kind === 'whiteboard' ? `<button type="button" class="rc-embed-edit-btn" title="Edit Whiteboard">✎</button>` : ''}
          <button type="button" class="rc-embed-remove-btn" title="Remove">×</button>
        </div>
      `;

      this._attachEmbedDragReorder(div);
      return div;
    }

    const div = document.createElement('div');
    div.className = `rc-block rc-${type}`;
    div.dataset.block = type;
    this._applyBlockLayoutAttrs(div, options.align || null, options.dir || null);
    if (type === 'ul' || type === 'ol' || type === 'check') {
      div.dataset.indent = String(indent);
    }
    if (type === 'check') {
      div.dataset.checked = options.checked ? 'true' : 'false';
      const box = document.createElement('span');
      box.className = 'rc-check-toggle';
      box.setAttribute('contenteditable', 'false');
      const body = document.createElement('span');
      body.className = 'rc-item-body';
      body.appendChild(document.createElement('br'));
      div.appendChild(box);
      div.appendChild(body);
    } else if (type === 'ul' || type === 'ol') {
      const marker = document.createElement('span');
      marker.setAttribute('contenteditable', 'false');
      if (type === 'ol') {
        marker.className = 'rc-ol-marker';
        marker.textContent = '1.';
      } else {
        const shape = options.bulletType || 'bullet';
        div.dataset.bulletType = shape;
        marker.className = `rc-ul-marker is-${shape}`;
        marker.textContent = shape === 'arrow' ? '→' : (shape === 'branch' ? '↳' : '•');
      }
      const body = document.createElement('span');
      body.className = 'rc-item-body';
      body.appendChild(document.createElement('br'));
      div.appendChild(marker);
      div.appendChild(body);
    } else {
      div.appendChild(document.createElement('br'));
    }
    return div;
  }

  _applyBlockLayoutAttrs(blockEl, align = null, dir = null) {
    if (!blockEl) return;
    blockEl.classList.remove('rc-align-left', 'rc-align-center', 'rc-align-right');
    if (align === 'left' || align === 'center' || align === 'right') {
      blockEl.dataset.align = align;
      blockEl.classList.add(`rc-align-${align}`);
    } else {
      delete blockEl.dataset.align;
    }
    if (dir === 'ltr' || dir === 'rtl') {
      blockEl.dataset.dir = dir;
      blockEl.setAttribute('dir', dir);
    } else {
      delete blockEl.dataset.dir;
      blockEl.setAttribute('dir', 'auto');
    }
  }

  _attachEmbedDragReorder(embedEl) {
    if (!embedEl) return;
    let holdTimer = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let placeholder = null;
    let siblingBlocks = [];
    let currentSlot = 0;
    let dragRect = null;
    let autoScrollRaf = null;
    let latestClientY = 0;

    const flipMovePlaceholder = (nextSlot, parentContainer) => {
      if (!placeholder || !parentContainer) return;
      const beforeTops = siblingBlocks.map((b) => b.getBoundingClientRect().top);
      if (nextSlot >= siblingBlocks.length) {
        parentContainer.appendChild(placeholder);
      } else {
        parentContainer.insertBefore(placeholder, siblingBlocks[nextSlot]);
      }
      siblingBlocks.forEach((b, idx) => {
        const delta = beforeTops[idx] - b.getBoundingClientRect().top;
        if (Math.abs(delta) > 0.5) {
          b.style.transition = 'none';
          b.style.transform = `translateY(${delta}px)`;
          requestAnimationFrame(() => {
            b.style.transition = 'transform 190ms cubic-bezier(0.2, 0.9, 0.3, 1)';
            b.style.transform = '';
          });
        }
      });
    };

    embedEl.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest('button')) return;
      const parentContainer = embedEl.parentNode;
      if (!parentContainer) return;

      startX = e.clientX;
      startY = e.clientY;
      latestClientY = startY;
      const isGrip = Boolean(e.target.closest('.rc-embed-drag-grip'));
      const delayMs = isGrip ? 60 : 280;

      const startDrag = () => {
        dragging = true;
        dragRect = embedEl.getBoundingClientRect();
        const allChildren = Array.from(parentContainer.querySelectorAll(':scope > .rc-block'));
        currentSlot = Math.max(0, allChildren.indexOf(embedEl));
        siblingBlocks = allChildren.filter((b) => b !== embedEl);

        placeholder = document.createElement('div');
        placeholder.className = 'rc-embed-drop-gap';
        placeholder.style.height = `${Math.max(44, Math.round(dragRect.height))}px`;
        if (currentSlot >= siblingBlocks.length) {
          parentContainer.appendChild(placeholder);
        } else {
          parentContainer.insertBefore(placeholder, siblingBlocks[currentSlot]);
        }

        embedEl.classList.add('is-embed-dragging');
        embedEl.style.position = 'fixed';
        embedEl.style.left = `${Math.round(dragRect.left)}px`;
        embedEl.style.top = `${Math.round(dragRect.top - 4)}px`;
        embedEl.style.width = `${Math.round(dragRect.width)}px`;
        embedEl.style.zIndex = '1200';

        const scrollLoop = () => {
          if (!dragging || !this.el) return;
          const r = this.el.getBoundingClientRect();
          if (latestClientY < r.top + 36) this.el.scrollTop -= 7;
          else if (latestClientY > r.bottom - 36) this.el.scrollTop += 7;
          autoScrollRaf = requestAnimationFrame(scrollLoop);
        };
        autoScrollRaf = requestAnimationFrame(scrollLoop);
      };

      holdTimer = setTimeout(startDrag, delayMs);

      const onMove = (ev) => {
        latestClientY = ev.clientY;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging) {
          if (Math.hypot(dx, dy) > 8) {
            clearTimeout(holdTimer);
            holdTimer = null;
            if (isGrip) startDrag();
            else cleanup(true);
          }
          return;
        }
        ev.preventDefault();
        const floatTop = dragRect.top + dy - 4;
        embedEl.style.top = `${Math.round(floatTop)}px`;
        embedEl.style.left = `${Math.round(dragRect.left + dx * 0.15)}px`;

        const centerY = floatTop + dragRect.height / 2;
        let nextSlot = siblingBlocks.length;
        for (let i = 0; i < siblingBlocks.length; i++) {
          const r = siblingBlocks[i].getBoundingClientRect();
          if (centerY < r.top + r.height / 2) {
            nextSlot = i;
            break;
          }
        }
        if (nextSlot !== currentSlot) {
          flipMovePlaceholder(nextSlot, parentContainer);
          currentSlot = nextSlot;
        }
      };

      const cleanup = (cancelled = false) => {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);

        if (!dragging) return;
        dragging = false;

        const targetRect = placeholder ? placeholder.getBoundingClientRect() : dragRect;
        const finishSettle = () => {
          embedEl.classList.remove('is-embed-dragging');
          embedEl.style.position = '';
          embedEl.style.left = '';
          embedEl.style.top = '';
          embedEl.style.width = '';
          embedEl.style.zIndex = '';
          embedEl.style.transition = '';
          siblingBlocks.forEach((b) => { b.style.transition = ''; b.style.transform = ''; });
          if (placeholder && placeholder.parentNode) {
            if (!cancelled) {
              placeholder.replaceWith(embedEl);
            } else {
              placeholder.remove();
            }
          }
          placeholder = null;
          this._ensureAtLeastOneBlock();
          if (!cancelled) {
            this._pushHistory();
            this.onChange(this.getValue());
          }
        };

        if (!cancelled && targetRect) {
          embedEl.style.transition = 'top 190ms cubic-bezier(0.22, 1, 0.36, 1), left 190ms cubic-bezier(0.22, 1, 0.36, 1), transform 190ms ease';
          embedEl.style.top = `${Math.round(targetRect.top)}px`;
          embedEl.style.left = `${Math.round(targetRect.left)}px`;
          setTimeout(finishSettle, 195);
        } else {
          finishSettle();
        }
      };

      const onUp = () => cleanup(false);
      const onCancel = () => cleanup(true);
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    });
  }

  _placeCaretAtEnd(node) {
    const sel = window.getSelection();
    if (!sel || !node) return;
    const range = document.createRange();
    if (node.nodeType === 3) {
      range.setStart(node, node.nodeValue.length);
    } else {
      const last = node.lastChild;
      if (last && last.nodeType === 1 && last.tagName === 'BR') {
        if (node.childNodes.length === 1) {
          range.setStart(node, 0);
        } else {
          range.setStartBefore(last);
        }
      } else {
        range.selectNodeContents(node);
        range.collapse(false);
      }
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    this._saveSelection();
  }

  _placeCaretAtStart(node) {
    const sel = window.getSelection();
    if (!sel || !node) return;
    const range = document.createRange();
    range.setStart(node, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    this._saveSelection();
  }

  // --- Canonical Serialization (DOM -> Markup) ---
  _serializeBlockContainer(containerEl) {
    if (!containerEl) return '';
    const blocks = Array.from(containerEl.childNodes);
    const outLines = [];
    const olCounters = new Map();

    for (const node of blocks) {
      if (node.nodeType === 3) {
        const txt = node.nodeValue.replace(/\u200B/g, '').replace(/\u00A0/g, ' ');
        if (txt) outLines.push(txt);
        continue;
      }
      if (node.nodeType !== 1) continue;

      const blockType = node.dataset?.block || (node.tagName === 'PRE' ? 'codeblock' : 'p');
      if (blockType === 'codeblock') {
        olCounters.clear();
        const rawCode = (node.innerText || node.textContent || '').replace(/\u200B/g, '').replace(/\u00A0/g, ' ').replace(/\n+$/, '');
        outLines.push(`\`\`\`\n${rawCode}\n\`\`\``);
        continue;
      }

      if (blockType === 'fold') {
        olCounters.clear();
        const titleEl = node.querySelector(':scope > .rc-fold-header > .rc-fold-title');
        const bodyEl = node.querySelector(':scope > .rc-fold-body');
        const rawTitle = this._serializeChildren(titleEl)
          .replace(/\u200B/g, '')
          .replace(/\u00A0/g, ' ')
          .replace(/[\r\n]+/g, ' ')
          .replace(/\]/g, '')
          .trim();
        const bodyStr = this._serializeBlockContainer(bodyEl);
        if (!rawTitle && !bodyStr) continue;
        const finalTitle = rawTitle || 'اضغط لعرض التفاصيل';
        outLines.push(bodyStr ? `[fold:${finalTitle}]\n${bodyStr}\n[/fold]` : `[fold:${finalTitle}][/fold]`);
        continue;
      }

      if (blockType === 'embed') {
        olCounters.clear();
        const kind = node.dataset?.embedKind || 'file';
        const mediaId = node.dataset?.embedMediaId || '';
        const layout = node.dataset?.embedLayout || 'full';
        const label = (node.dataset?.embedLabel || '').replace(/[\]\r\n]/g, '').trim();
        if (mediaId) {
          outLines.push(label ? `[embed:${kind}:${mediaId}:${layout}|${label}]` : `[embed:${kind}:${mediaId}:${layout}]`);
        }
        continue;
      }

      const body = this._getBlockBodyEl(node);
      const inlineStr = this._serializeChildren(body).replace(/\u200B/g, '').replace(/\u00A0/g, ' ').replace(/\n+$/, '');
      const indent = Number(node.dataset?.indent || 0);
      const pad = '  '.repeat(Math.max(0, indent));
      const layoutPrefix = formatLineLayoutPrefix(node.dataset?.align || null, node.dataset?.dir || null);

      if (blockType === 'h1') {
        olCounters.clear();
        outLines.push(`${layoutPrefix}# ${inlineStr}`);
      } else if (blockType === 'h2') {
        olCounters.clear();
        outLines.push(`${layoutPrefix}## ${inlineStr}`);
      } else if (blockType === 'h3') {
        olCounters.clear();
        outLines.push(`${layoutPrefix}### ${inlineStr}`);
      } else if (blockType === 'quote') {
        olCounters.clear();
        outLines.push(`${layoutPrefix}> ${inlineStr}`);
      } else if (blockType === 'ul') {
        const shape = node.dataset?.bulletType || 'bullet';
        const prefix = shape === 'arrow' ? '-> ' : (shape === 'branch' ? '↳ ' : '- ');
        outLines.push(`${layoutPrefix}${pad}${prefix}${inlineStr}`);
      } else if (blockType === 'ol') {
        for (const k of Array.from(olCounters.keys())) {
          if (k > indent) olCounters.delete(k);
        }
        const num = (olCounters.get(indent) || 0) + 1;
        olCounters.set(indent, num);
        outLines.push(`${layoutPrefix}${pad}${num}. ${inlineStr}`);
      } else if (blockType === 'check') {
        const checked = node.dataset?.checked === 'true';
        outLines.push(`${layoutPrefix}${pad}[${checked ? 'x' : ' '}] ${inlineStr}`);
      } else {
        olCounters.clear();
        outLines.push(`${layoutPrefix}${inlineStr}`);
      }
    }

    const joined = outLines.join('\n').replace(/\u200B/g, '').replace(/\u00A0/g, ' ');
    return joined.replace(/\n+$/, '');
  }

  getValue() {
    if (!this.el) return '';
    return this._serializeBlockContainer(this.el);
  }

  _serializeChildren(parent) {
    if (!parent) return '';
    let result = '';
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 3) {
        result += child.nodeValue.replace(/\u200B/g, '').replace(/\u00A0/g, ' ');
      } else if (child.nodeType === 1) {
        if (child.tagName === 'BR') continue;
        if (child.getAttribute('contenteditable') === 'false') continue;

        const inner = this._serializeChildren(child);
        if (!inner) continue;

        const tag = child.tagName;
        if (tag === 'STRONG' || tag === 'B') {
          result += `*${inner}*`;
        } else if (tag === 'EM' || tag === 'I') {
          result += `_${inner}_`;
        } else if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') {
          result += `~${inner}~`;
        } else if (tag === 'U' || child.dataset?.fmt === 'underline') {
          result += `++${inner}++`;
        } else if (tag === 'CODE') {
          const plainCode = (child.textContent || '').replace(/\u200B/g, '').replace(/\u00A0/g, ' ').replace(/`/g, '');
          if (plainCode) result += `\`${plainCode}\``;
        } else if (tag === 'MARK') {
          const code = child.dataset?.hlColor || 'y';
          result += code === 'y' ? `==${inner}==` : `==${code}:${inner}==`;
        } else if (child.dataset?.fmt === 'spoiler' || child.classList?.contains('wa-spoiler')) {
          result += `||${inner}||`;
        } else if (tag === 'SUP') {
          result += `^^${inner}^^`;
        } else if (tag === 'SUB') {
          result += `,,${inner},,`;
        } else if (tag === 'A') {
          const href = child.dataset?.href || child.getAttribute('href') || '';
          const safe = sanitizeUrl(href);
          result += safe ? `[${inner}](${safe})` : inner;
        } else {
          result += inner;
        }
      }
    }
    return result;
  }

  // --- Canonical Hydrator (Markup -> Live WYSIWYG DOM) ---
  _renderMarkupToContainer(containerEl, markup = '') {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    const raw = String(markup || '').replace(/\r\n?/g, '\n');
    if (!raw) {
      this._normalizeBlockContainer(containerEl);
      return;
    }

    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i];

      const embedMeta = parseEmbedDirective(originalLine);
      if (embedMeta) {
        const blk = this._makeBlockEl('embed', embedMeta);
        containerEl.appendChild(blk);
        continue;
      }

      const layoutMeta = extractLineLayoutDirectives(originalLine);
      const line = layoutMeta.content;
      const layoutOpts = { align: layoutMeta.align, dir: layoutMeta.dir };

      const foldMatch = line.match(/^(\s*)\[fold:([^\]\n]+)\](.*)$/);
      if (foldMatch && containerEl === this.el) {
        const title = foldMatch[2].trim();
        const firstRest = foldMatch[3].trim();
        const foldLines = [];
        if (firstRest) {
          if (firstRest.includes('[/fold]')) {
            const oneLineBody = firstRest.replace('[/fold]', '').trim();
            const blk = this._makeBlockEl('fold', { title, bodyMarkup: oneLineBody, open: true });
            containerEl.appendChild(blk);
            continue;
          }
          foldLines.push(firstRest);
        }
        let j = i + 1;
        while (j < lines.length && !lines[j].includes('[/fold]')) {
          foldLines.push(lines[j]);
          j++;
        }
        if (j < lines.length) {
          const lastRest = lines[j].replace('[/fold]', '').trim();
          if (lastRest) foldLines.push(lastRest);
          i = j;
        } else {
          i = lines.length - 1;
        }
        const blk = this._makeBlockEl('fold', { title, bodyMarkup: foldLines.join('\n'), open: true });
        containerEl.appendChild(blk);
        continue;
      }

      if (/^\s*```/.test(line)) {
        const codeLines = [];
        let j = i + 1;
        while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) {
          codeLines.push(lines[j]);
          j++;
        }
        i = j < lines.length ? j : lines.length - 1;
        const blk = this._makeBlockEl('codeblock', { text: codeLines.join('\n') });
        containerEl.appendChild(blk);
        continue;
      }

      const checkMatch = line.match(/^(\s*)\[([ xX])\]\s+(.*)$/);
      if (checkMatch) {
        const indent = Math.min(3, Math.floor(checkMatch[1].replace(/\t/g, '  ').length / 2));
        const blk = this._makeBlockEl('check', {
          ...layoutOpts,
          indent,
          checked: checkMatch[2].toLowerCase() === 'x'
        });
        this._populateInlineNodes(this._getBlockBodyEl(blk), checkMatch[3]);
        containerEl.appendChild(blk);
        continue;
      }

      const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headerMatch) {
        const type = `h${headerMatch[1].length}`;
        const blk = this._makeBlockEl(type, layoutOpts);
        this._populateInlineNodes(blk, headerMatch[2]);
        containerEl.appendChild(blk);
        continue;
      }

      const quoteMatch = line.match(/^\s*>\s?(.*)$/);
      if (quoteMatch && /^\s*>/.test(line)) {
        const blk = this._makeBlockEl('quote', layoutOpts);
        this._populateInlineNodes(blk, quoteMatch[1]);
        containerEl.appendChild(blk);
        continue;
      }

      const ulMatch = line.match(/^(\s*)(?:(->|=>|→)|(\\>|\|->|↳)|(?:-|\*))\s+(.*)$/);
      if (ulMatch) {
        const indent = Math.min(3, Math.floor(ulMatch[1].replace(/\t/g, '  ').length / 2));
        const shape = ulMatch[2] ? 'arrow' : (ulMatch[3] ? 'branch' : 'bullet');
        const blk = this._makeBlockEl('ul', { ...layoutOpts, indent, bulletType: shape });
        this._populateInlineNodes(this._getBlockBodyEl(blk), ulMatch[4]);
        containerEl.appendChild(blk);
        continue;
      }

      const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
      if (olMatch) {
        const indent = Math.min(3, Math.floor(olMatch[1].replace(/\t/g, '  ').length / 2));
        const blk = this._makeBlockEl('ol', { ...layoutOpts, indent });
        this._populateInlineNodes(this._getBlockBodyEl(blk), olMatch[3]);
        containerEl.appendChild(blk);
        continue;
      }

      const blk = this._makeBlockEl('p', layoutOpts);
      this._populateInlineNodes(blk, line);
      containerEl.appendChild(blk);
    }

    this._normalizeBlockContainer(containerEl);
  }

  setValue(markup = '') {
    if (!this.el) return;
    this._suppressInput = true;
    try {
      this._renderMarkupToContainer(this.el, markup);
      this._ensureAtLeastOneBlock();
      this._resetHistory(this.getValue());
    } finally {
      this._suppressInput = false;
      this.onChange(this.getValue());
    }
  }

  _populateInlineNodes(container, rawInline) {
    container.innerHTML = '';
    if (!rawInline) {
      container.appendChild(document.createElement('br'));
      return;
    }

    const fragment = this._parseInlineFragment(rawInline);
    if (!fragment.firstChild) {
      container.appendChild(document.createElement('br'));
    } else {
      container.appendChild(fragment);
    }
  }

  _parseInlineFragment(rawStr) {
    const frag = document.createDocumentFragment();
    if (!rawStr) return frag;

    const pattern = /(`[^`\n]+?`|\[[^\]\n]+?\]\((?:https?:\/\/|mailto:)[^\s)\n]+\)|==(?:[ygbpov]:)?[^\s=\n](?:[^=\n]*?[^\s=\n])?==|\+\+[^\s+\n](?:[^+\n]*?[^\s+\n])?\+\+|\|\|[^\s|\n](?:[^|\n]*?[^\s|\n])?\|\||\^\^[^\s^\n](?:[^\^\n]*?[^\s^\n])?\^\^|,,[^\s,\n](?:[^,\n]*?[^\s,\n])?,,|\*[^\s*\n](?:[^*\n]*?[^\s*\n])?\*|_[^\s_\n](?:[^_\n]*?[^\s_\n])?_|~[^\s~\n](?:[^~\n]*?[^\s~\n])?~)/;

    let remaining = rawStr;
    while (remaining.length > 0) {
      const m = remaining.match(pattern);
      if (!m) {
        frag.appendChild(document.createTextNode(remaining));
        break;
      }

      const idx = m.index;
      // Check word-boundary for single-char markers (* _ ~)
      const token = m[0];
      if ((token.startsWith('*') || token.startsWith('_') || token.startsWith('~')) && idx > 0) {
        const prevCh = remaining[idx - 1];
        if (!/[\s(\[{.,!?:;>*_~+=|]/.test(prevCh)) {
          frag.appendChild(document.createTextNode(remaining.slice(0, idx + 1)));
          remaining = remaining.slice(idx + 1);
          continue;
        }
      }

      if (idx > 0) {
        frag.appendChild(document.createTextNode(remaining.slice(0, idx)));
      }

      const el = this._tokenToElement(token);
      if (el) {
        frag.appendChild(el);
      } else {
        frag.appendChild(document.createTextNode(token));
      }

      remaining = remaining.slice(idx + token.length);
    }

    return frag;
  }

  _tokenToElement(token) {
    if (token.startsWith('`') && token.endsWith('`')) {
      const code = document.createElement('code');
      code.className = 'chat-inline-code';
      code.textContent = token.slice(1, -1);
      return code;
    }

    if (token.startsWith('[')) {
      const lm = token.match(/^\[([^\]\n]+?)\]\(([^\s)\n]+)\)$/);
      if (lm) {
        const safe = sanitizeUrl(lm[2]);
        if (safe) {
          const a = document.createElement('a');
          a.className = 'chat-link chat-word-link';
          a.href = safe;
          a.dataset.href = safe;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.appendChild(this._parseInlineFragment(lm[1]));
          return a;
        }
      }
      return null;
    }

    if (token.startsWith('==') && token.endsWith('==')) {
      const inner = token.slice(2, -2);
      const cm = inner.match(/^([ygbpov]):(.*)$/);
      const colorCode = cm ? cm[1] : 'y';
      const body = cm ? cm[2] : inner;
      const colorDef = HIGHLIGHT_COLORS[colorCode] || HIGHLIGHT_COLORS.y;
      const mark = document.createElement('mark');
      mark.className = `wa-hl wa-hl-${colorDef.name}`;
      mark.dataset.hlColor = colorCode;
      mark.appendChild(this._parseInlineFragment(body));
      return mark;
    }

    if (token.startsWith('++') && token.endsWith('++')) {
      const u = document.createElement('u');
      u.className = 'wa-underline';
      u.appendChild(this._parseInlineFragment(token.slice(2, -2)));
      return u;
    }

    if (token.startsWith('||') && token.endsWith('||')) {
      const span = document.createElement('span');
      span.className = 'wa-spoiler rc-spoiler-edit';
      span.dataset.fmt = 'spoiler';
      span.appendChild(this._parseInlineFragment(token.slice(2, -2)));
      return span;
    }

    if (token.startsWith('^^') && token.endsWith('^^')) {
      const sup = document.createElement('sup');
      sup.className = 'wa-sup';
      sup.appendChild(this._parseInlineFragment(token.slice(2, -2)));
      return sup;
    }

    if (token.startsWith(',,') && token.endsWith(',,')) {
      const sub = document.createElement('sub');
      sub.className = 'wa-sub';
      sub.appendChild(this._parseInlineFragment(token.slice(2, -2)));
      return sub;
    }

    if (token.startsWith('*') && token.endsWith('*')) {
      const strong = document.createElement('strong');
      strong.appendChild(this._parseInlineFragment(token.slice(1, -1)));
      return strong;
    }

    if (token.startsWith('_') && token.endsWith('_')) {
      const em = document.createElement('em');
      em.appendChild(this._parseInlineFragment(token.slice(1, -1)));
      return em;
    }

    if (token.startsWith('~') && token.endsWith('~')) {
      const del = document.createElement('del');
      del.appendChild(this._parseInlineFragment(token.slice(1, -1)));
      return del;
    }

    return null;
  }

  // --- Live Shortcut Auto-Conversion ---
  _handleInput() {
    this._ensureAtLeastOneBlock();
    this._tryAutoFormatAtCaret();
    this._ensureAtLeastOneBlock();
    this._pushHistory();
    this._saveSelection();
    this.scrollCaretIntoView();
    const val = this.getValue();
    this.onChange(val);
    this.onSelectionChange(this.getActiveFormats());
  }

  _tryAutoFormatAtCaret() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (!node || node.nodeType !== 3 || !this.el.contains(node)) return;

    const blockEl = this._getBlockElement(node);
    if (!blockEl || blockEl.dataset.block === 'codeblock') return;

    // Skip if caret is inside inline code
    if (node.parentNode?.closest?.('code')) return;

    const foldTitleEl = this._getFoldTitleEl(node);
    const insideFold = Boolean(this._getEnclosingFold(node));
    const bodyEl = foldTitleEl || this._getBlockBodyEl(blockEl);
    const text = node.nodeValue || '';
    const offset = range.startOffset;

    // 1. Block prefix shortcuts when typing in a plain block (skip inside fold title)
    if (!foldTitleEl && blockEl.dataset.block === 'p' && bodyEl.firstChild === node) {
      const prefix = text.slice(0, offset);

      // Live Fold shortcuts: >>> + Space OR [fold:Title] + Space (top-level only)
      if (!insideFold) {
        const foldShortcutMatch =
          prefix.match(/^(>>>)[ \u00A0]$/) ||
          prefix.match(/^\[fold:([^\]\n]+)\][ \u00A0]$/);
        if (foldShortcutMatch) {
          const isBracketForm = foldShortcutMatch[0].startsWith('[');
          const restInNode = text.slice(offset);
          const foldTitle = isBracketForm ? foldShortcutMatch[1].trim() : restInNode.trim();
          const foldBodyMarkup = isBracketForm ? restInNode : '';
          const foldEl = this._makeBlockEl('fold', {
            title: foldTitle,
            bodyMarkup: foldBodyMarkup,
            open: true
          });
          blockEl.replaceWith(foldEl);
          if (!foldEl.nextElementSibling) {
            foldEl.after(this._makeBlockEl('p'));
          }
          if (isBracketForm) {
            const firstBodyBlk = foldEl.querySelector(':scope > .rc-fold-body > .rc-block') || foldEl;
            const target = this._getBlockBodyEl(firstBodyBlk);
            this._placeCaretAtStart(target.firstChild || target);
          } else {
            const tEl = foldEl.querySelector(':scope > .rc-fold-header > .rc-fold-title');
            this._placeCaretAtStart(tEl?.firstChild || tEl);
          }
          this._syncOrderedNumbers();
          return;
        }
      }

      const blockMatch =
        prefix.match(/^(#{1,3})[ \u00A0]$/) ||
        prefix.match(/^(\[[ \u00A0]?\]|\[[xX]\])[ \u00A0]$/) ||
        prefix.match(/^([-*]|->|=>|→|↳|\\>|\|->)[ \u00A0]$/) ||
        prefix.match(/^(\d+\.)[ \u00A0]$/) ||
        prefix.match(/^(>)[ \u00A0]$/) ||
        prefix.match(/^(```)$/);

      if (blockMatch) {
        const trigger = blockMatch[1];
        const restInNode = text.slice(offset);
        const remainingNodes = Array.from(bodyEl.childNodes).slice(1);

        let newBlockType = 'p';
        let opts = {};
        if (trigger === '#') newBlockType = 'h1';
        else if (trigger === '##') newBlockType = 'h2';
        else if (trigger === '###') newBlockType = 'h3';
        else if (trigger === '>') newBlockType = 'quote';
        else if (trigger === '-' || trigger === '*') {
          newBlockType = 'ul';
          opts.bulletType = 'bullet';
          this._lastBulletType = 'bullet';
        } else if (trigger === '->' || trigger === '=>' || trigger === '→') {
          newBlockType = 'ul';
          opts.bulletType = 'arrow';
          this._lastBulletType = 'arrow';
        } else if (trigger === '↳' || trigger === '\\>' || trigger === '|->') {
          newBlockType = 'ul';
          opts.bulletType = 'branch';
          this._lastBulletType = 'branch';
        } else if (/^\d+\.$/.test(trigger)) newBlockType = 'ol';
        else if (/^\[[ \u00A0xX]?\]$/.test(trigger)) {
          newBlockType = 'check';
          opts.checked = trigger.toLowerCase() === '[x]';
        } else if (trigger === '```') {
          newBlockType = 'codeblock';
        }

        const newBlock = this._makeBlockEl(newBlockType, opts);
        const targetBody = this._getBlockBodyEl(newBlock);
        targetBody.innerHTML = '';

        const firstTextNode = document.createTextNode(restInNode || '');
        if (newBlockType === 'codeblock') {
          targetBody.textContent = restInNode || '';
          blockEl.replaceWith(newBlock);
          this._placeCaretAtStart(targetBody.firstChild || targetBody);
          return;
        }

        targetBody.appendChild(firstTextNode);
        for (const extra of remainingNodes) {
          if (extra.nodeType === 1 && extra.tagName === 'BR') continue;
          targetBody.appendChild(extra);
        }
        if (!firstTextNode.nodeValue && targetBody.childNodes.length === 1) {
          targetBody.appendChild(document.createElement('br'));
        }

        blockEl.replaceWith(newBlock);
        this._syncOrderedNumbers();
        this._placeCaretAtStart(firstTextNode);
        return;
      }
    }

    // 2. Inline paired shortcuts up to caret
    const before = text.slice(0, offset);
    const after = text.slice(offset);

    const inlineRules = [
      {
        regex: /\[([^\]\n]+?)\]\(((?:https?:\/\/|mailto:)[^\s)\n]+)\)$/,
        build: (m) => {
          const safe = sanitizeUrl(m[2]);
          if (!safe) return null;
          const a = document.createElement('a');
          a.className = 'chat-link chat-word-link';
          a.href = safe;
          a.dataset.href = safe;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = m[1];
          return { el: a, keepPrefix: '' };
        }
      },
      {
        regex: /==(?:([ygbpov]):)?([^\s=\n](?:[^=\n]*?[^\s=\n])?)==$/,
        build: (m) => {
          const code = m[1] || 'y';
          const colorDef = HIGHLIGHT_COLORS[code] || HIGHLIGHT_COLORS.y;
          const mark = document.createElement('mark');
          mark.className = `wa-hl wa-hl-${colorDef.name}`;
          mark.dataset.hlColor = code;
          mark.textContent = m[2];
          return { el: mark, keepPrefix: '' };
        }
      },
      {
        regex: /\+\+([^\s+\n](?:[^+\n]*?[^\s+\n])?)\+\+$/,
        build: (m) => {
          const u = document.createElement('u');
          u.className = 'wa-underline';
          u.textContent = m[1];
          return { el: u, keepPrefix: '' };
        }
      },
      {
        regex: /\|\|([^\s|\n](?:[^|\n]*?[^\s|\n])?)\|\|$/,
        build: (m) => {
          const span = document.createElement('span');
          span.className = 'wa-spoiler rc-spoiler-edit';
          span.dataset.fmt = 'spoiler';
          span.textContent = m[1];
          return { el: span, keepPrefix: '' };
        }
      },
      {
        regex: /\^\^([^\s^\n](?:[^\^\n]*?[^\s^\n])?)\^\^$/,
        build: (m) => {
          const sup = document.createElement('sup');
          sup.className = 'wa-sup';
          sup.textContent = m[1];
          return { el: sup, keepPrefix: '' };
        }
      },
      {
        regex: /,,([^\s,\n](?:[^,\n]*?[^\s,\n])?),,$/,
        build: (m) => {
          const sub = document.createElement('sub');
          sub.className = 'wa-sub';
          sub.textContent = m[1];
          return { el: sub, keepPrefix: '' };
        }
      },
      {
        regex: /`([^`\n]+?)`$/,
        build: (m) => {
          const code = document.createElement('code');
          code.className = 'chat-inline-code';
          code.textContent = m[1];
          return { el: code, keepPrefix: '' };
        }
      },
      {
        regex: /(^|[\s(\[{.,!?:;>])\*([^\s*\n](?:[^*\n]*?[^\s*\n])?)\*$/,
        build: (m) => {
          const strong = document.createElement('strong');
          strong.textContent = m[2];
          return { el: strong, keepPrefix: m[1] || '' };
        }
      },
      {
        regex: /(^|[\s(\[{.,!?:;>])_([^\s_\n](?:[^_\n]*?[^\s_\n])?)_$/,
        build: (m) => {
          const em = document.createElement('em');
          em.textContent = m[2];
          return { el: em, keepPrefix: m[1] || '' };
        }
      },
      {
        regex: /(^|[\s(\[{.,!?:;>])~([^\s~\n](?:[^~\n]*?[^\s~\n])?)~$/,
        build: (m) => {
          const del = document.createElement('del');
          del.textContent = m[2];
          return { el: del, keepPrefix: m[1] || '' };
        }
      }
    ];

    for (const rule of inlineRules) {
      const m = before.match(rule.regex);
      if (!m) continue;
      const built = rule.build(m);
      if (!built) continue;

      const leadLen = before.length - m[0].length;
      const beforeLeadText = before.slice(0, leadLen) + built.keepPrefix;
      const parent = node.parentNode;

      const frag = document.createDocumentFragment();
      if (beforeLeadText) {
        frag.appendChild(document.createTextNode(beforeLeadText));
      }
      frag.appendChild(built.el);

      const exitNode = document.createTextNode(after ? after : '\u200B');
      frag.appendChild(exitNode);

      parent.replaceChild(frag, node);

      const newRange = document.createRange();
      newRange.setStart(exitNode, after ? 0 : 1);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
      return;
    }
  }

  // --- Keyboard Behavior (Lists, Checklists, Headings, Indent, Undo/Redo) ---
  _handleKeyDown(e) {
    // Ctrl/Cmd shortcuts
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (key === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }
      if (key === 'b') {
        e.preventDefault();
        this.toggleInline('bold');
        return;
      }
      if (key === 'i') {
        e.preventDefault();
        this.toggleInline('italic');
        return;
      }
      if (key === 'u') {
        e.preventDefault();
        this.toggleInline('underline');
        return;
      }
    }

    const sel = window.getSelection();
    const anchorNode = (sel && sel.rangeCount) ? sel.getRangeAt(0).startContainer : null;
    const blockEl = anchorNode ? this._getBlockElement(anchorNode) : null;
    const enclosingFold = anchorNode ? this._getEnclosingFold(anchorNode) : null;
    const foldTitleEl = anchorNode ? this._getFoldTitleEl(anchorNode) : null;

    // Tab / Shift+Tab indents lists and checklists
    if (e.key === 'Tab' && blockEl) {
      const bType = blockEl.dataset?.block;
      if (bType === 'ul' || bType === 'ol' || bType === 'check') {
        e.preventDefault();
        this.indent(e.shiftKey ? -1 : 1);
        return;
      }
    }

    // Enter handling: Desktop Enter-to-send vs Shift+Enter newline, plus alignment/direction inheritance
    if (e.key === 'Enter' && !this._isComposing && !e.isComposing) {
      const bType = blockEl?.dataset?.block || 'p';

      // Ctrl+Enter / Cmd+Enter always submits if callback present
      if ((e.ctrlKey || e.metaKey) && typeof this.onSubmit === 'function') {
        e.preventDefault();
        this.onSubmit();
        return;
      }

      // Desktop Enter-to-send (when enabled, Shift NOT held, outside codeblock/foldTitle, and not typing raw [fold:...])
      const isRawFoldLine = !enclosingFold && bType === 'p' && blockEl && /^\[fold:([^\]\n]+)\]$/.test(
        this._serializeChildren(blockEl).replace(/\u200B/g, '').replace(/\u00A0/g, ' ').trim()
      );
      if (
        !e.shiftKey &&
        !foldTitleEl &&
        bType !== 'codeblock' &&
        !isRawFoldLine &&
        typeof this.shouldEnterSend === 'function' &&
        this.shouldEnterSend() &&
        typeof this.onSubmit === 'function'
      ) {
        e.preventDefault();
        this.onSubmit();
        return;
      }
    }

    if (e.key === 'Enter' && blockEl) {
      const bType = blockEl.dataset?.block;
      const inheritedLayout = {
        align: blockEl.dataset?.align || null,
        dir: blockEl.dataset?.dir || null
      };

      if (bType === 'codeblock') {
        this.scrollCaretIntoView();
        return; // Allow newlines natively inside code block
      }

      // Enter inside fold title moves caret cleanly into fold body
      if (foldTitleEl && enclosingFold) {
        e.preventDefault();
        enclosingFold.dataset.open = 'true';
        const toggleGlyph = enclosingFold.querySelector(':scope > .rc-fold-header > .rc-fold-toggle');
        if (toggleGlyph) toggleGlyph.textContent = '▼';
        const foldBody = enclosingFold.querySelector(':scope > .rc-fold-body');
        this._normalizeBlockContainer(foldBody);
        const firstBlk = foldBody?.firstElementChild;
        const firstTarget = this._getBlockBodyEl(firstBlk) || foldBody;
        this._placeCaretAtStart(firstTarget?.firstChild || firstTarget);
        this.scrollCaretIntoView();
        this.onSelectionChange(this.getActiveFormats());
        return;
      }

      // Enter on a raw `[fold:Title]` line converts immediately into a live Fold card
      if (!enclosingFold && bType === 'p') {
        const plainLine = this._serializeChildren(blockEl).replace(/\u200B/g, '').replace(/\u00A0/g, ' ').trim();
        const rawFoldLine = plainLine.match(/^\[fold:([^\]\n]+)\]$/);
        if (rawFoldLine) {
          e.preventDefault();
          const foldEl = this._makeBlockEl('fold', { title: rawFoldLine[1].trim(), open: true });
          blockEl.replaceWith(foldEl);
          if (!foldEl.nextElementSibling) {
            foldEl.after(this._makeBlockEl('p'));
          }
          const firstBlk = foldEl.querySelector(':scope > .rc-fold-body > .rc-block') || foldEl;
          const target = this._getBlockBodyEl(firstBlk);
          this._placeCaretAtStart(target.firstChild || target);
          this._syncOrderedNumbers();
          this._pushHistory();
          this.scrollCaretIntoView();
          this.onChange(this.getValue());
          this.onSelectionChange(this.getActiveFormats());
          return;
        }
      }

      // Enter on a `.rc-p` paragraph inside `.rc-fold-body` keeps paragraphs cleanly scoped or exits after trailing blank line
      if (enclosingFold && bType === 'p' && blockEl.parentNode?.classList?.contains('rc-fold-body')) {
        e.preventDefault();
        const foldBody = blockEl.parentNode;
        const cleanText = this._serializeChildren(blockEl).replace(/\u200B/g, '').trim();
        if (!cleanText && foldBody.children.length > 1 && blockEl === foldBody.lastElementChild) {
          blockEl.remove();
          let outsideP = enclosingFold.nextElementSibling;
          const isOutsideEmptyP = outsideP && outsideP.dataset?.block === 'p' && !this._serializeChildren(outsideP).replace(/\u200B/g, '').trim();
          if (!isOutsideEmptyP) {
            outsideP = this._makeBlockEl('p', inheritedLayout);
            enclosingFold.after(outsideP);
          }
          this._placeCaretAtStart(outsideP.firstChild || outsideP);
          this._pushHistory();
          this.scrollCaretIntoView();
          this.onChange(this.getValue());
          this.onSelectionChange(this.getActiveFormats());
          return;
        }

        let tailFrag = null;
        if (sel && sel.rangeCount) {
          const curRange = sel.getRangeAt(0);
          if (!curRange.collapsed && blockEl.contains(curRange.commonAncestorContainer)) {
            curRange.deleteContents();
          }
          if (blockEl.contains(curRange.endContainer)) {
            const tailRange = document.createRange();
            tailRange.selectNodeContents(blockEl);
            tailRange.setStart(curRange.endContainer, curRange.endOffset);
            tailFrag = tailRange.extractContents();
          }
        }
        const hasBodyContent = Array.from(blockEl.childNodes).some((n) =>
          (n.nodeType === 1 && n.tagName !== 'BR') ||
          (n.nodeType === 3 && n.nodeValue.replace(/\u200B/g, '').length > 0)
        );
        if (!hasBodyContent) {
          blockEl.innerHTML = '';
          blockEl.appendChild(document.createElement('br'));
        }
        const nextP = this._makeBlockEl('p', inheritedLayout);
        const hasTailContent = Boolean(
          tailFrag &&
          Array.from(tailFrag.childNodes).some((n) =>
            (n.nodeType === 1 && n.tagName !== 'BR') ||
            (n.nodeType === 3 && n.nodeValue.replace(/\u200B/g, '').length > 0)
          )
        );
        if (hasTailContent) {
          Array.from(tailFrag.childNodes).forEach((n) => {
            if (n.nodeType === 1 && n.tagName === 'BR') n.remove();
          });
          nextP.innerHTML = '';
          nextP.appendChild(tailFrag);
        }
        blockEl.after(nextP);
        this._placeCaretAtStart(nextP.firstChild || nextP);
        this._pushHistory();
        this.scrollCaretIntoView();
        this.onChange(this.getValue());
        this.onSelectionChange(this.getActiveFormats());
        return;
      }

      if (bType === 'ul' || bType === 'ol' || bType === 'check' || bType === 'h1' || bType === 'h2' || bType === 'h3' || bType === 'quote' || bType === 'p') {
        e.preventDefault();
        const body = this._getBlockBodyEl(blockEl);
        const cleanText = this._serializeChildren(body).replace(/\u200B/g, '').trim();

        // Empty list/quote item exits back to normal paragraph (preserving align/dir)
        if (!cleanText && (bType === 'ul' || bType === 'ol' || bType === 'check' || bType === 'quote')) {
          const p = this._makeBlockEl('p', inheritedLayout);
          blockEl.replaceWith(p);
          this._syncOrderedNumbers();
          this._placeCaretAtStart(p);
          this._pushHistory();
          this.scrollCaretIntoView();
          this.onChange(this.getValue());
          this.onSelectionChange(this.getActiveFormats());
          return;
        }

        let tailFrag = null;
        if (sel && sel.rangeCount) {
          const curRange = sel.getRangeAt(0);
          if (!curRange.collapsed && body.contains(curRange.commonAncestorContainer)) {
            curRange.deleteContents();
          }
          if (body.contains(curRange.endContainer)) {
            const tailRange = document.createRange();
            tailRange.selectNodeContents(body);
            tailRange.setStart(curRange.endContainer, curRange.endOffset);
            tailFrag = tailRange.extractContents();
          }
        }

        const hasBodyContent = Array.from(body.childNodes).some((n) =>
          (n.nodeType === 1 && n.tagName !== 'BR') ||
          (n.nodeType === 3 && n.nodeValue.replace(/\u200B/g, '').length > 0)
        );
        if (!hasBodyContent) {
          body.innerHTML = '';
          body.appendChild(document.createElement('br'));
        }

        const nextType = (bType === 'ul' || bType === 'ol' || bType === 'check') ? bType : 'p';
        const indent = Number(blockEl.dataset.indent || 0);
        const bulletType = bType === 'ul' ? (blockEl.dataset.bulletType || this._lastBulletType || 'bullet') : undefined;
        const nextBlock = this._makeBlockEl(nextType, { ...inheritedLayout, indent, checked: false, bulletType });
        const nextBody = this._getBlockBodyEl(nextBlock);

        const hasTailContent = Boolean(
          tailFrag &&
          Array.from(tailFrag.childNodes).some((n) =>
            (n.nodeType === 1 && n.tagName !== 'BR') ||
            (n.nodeType === 3 && n.nodeValue.replace(/\u200B/g, '').length > 0)
          )
        );
        if (hasTailContent) {
          Array.from(tailFrag.childNodes).forEach((n) => {
            if (n.nodeType === 1 && n.tagName === 'BR') n.remove();
          });
          nextBody.innerHTML = '';
          nextBody.appendChild(tailFrag);
        }

        blockEl.after(nextBlock);
        this._syncOrderedNumbers();
        this._placeCaretAtStart(nextBody);
        this._pushHistory();
        this.scrollCaretIntoView();
        this.onChange(this.getValue());
        this.onSelectionChange(this.getActiveFormats());
        return;
      }
    }

    // Backspace inside fold title / first fold body block or offset 0 of a formatted block
    if (e.key === 'Backspace' && sel && sel.rangeCount && sel.isCollapsed && blockEl) {
      const range = sel.getRangeAt(0);
      if (foldTitleEl && enclosingFold && this._isCaretAtStartOf(range, foldTitleEl)) {
        const bodyContent = this._serializeBlockContainer(enclosingFold.querySelector(':scope > .rc-fold-body')).trim();
        if (!bodyContent) {
          e.preventDefault();
          this._unwrapFoldBlock(enclosingFold);
        }
        return;
      }

      if (enclosingFold && blockEl.parentNode?.classList?.contains('rc-fold-body') && blockEl === blockEl.parentNode.firstElementChild) {
        const innerBody = this._getBlockBodyEl(blockEl);
        if (blockEl.dataset?.block === 'p' && this._isCaretAtStartOf(range, innerBody)) {
          e.preventDefault();
          const titleTarget = enclosingFold.querySelector(':scope > .rc-fold-header > .rc-fold-title');
          if (titleTarget) this._placeCaretAtEnd(titleTarget);
          this.onSelectionChange(this.getActiveFormats());
          return;
        }
      }

      const bType = blockEl.dataset?.block;
      if (bType && bType !== 'p' && bType !== 'fold') {
        const body = this._getBlockBodyEl(blockEl);
        const atStart = this._isCaretAtStartOf(range, body);
        if (atStart) {
          e.preventDefault();
          const curIndent = Number(blockEl.dataset.indent || 0);
          if ((bType === 'ul' || bType === 'ol' || bType === 'check') && curIndent > 0) {
            blockEl.dataset.indent = String(curIndent - 1);
            this._syncOrderedNumbers();
          } else {
            const p = this._makeBlockEl('p');
            p.innerHTML = '';
            while (body.firstChild) {
              const ch = body.firstChild;
              if (ch.nodeType === 1 && ch.getAttribute('contenteditable') === 'false') {
                ch.remove();
              } else {
                p.appendChild(ch);
              }
            }
            if (!p.firstChild) p.appendChild(document.createElement('br'));
            blockEl.replaceWith(p);
            this._syncOrderedNumbers();
            this._placeCaretAtStart(p.firstChild || p);
          }
          this._pushHistory();
          this.onChange(this.getValue());
          this.onSelectionChange(this.getActiveFormats());
        }
      }
    }
  }

  _isCaretAtStartOf(range, container) {
    if (!container || !container.contains(range.startContainer)) return false;
    const probe = document.createRange();
    probe.selectNodeContents(container);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().replace(/\u200B/g, '').length === 0;
  }

  _handlePaste(e) {
    e.preventDefault();
    const plain = e.clipboardData?.getData('text/plain') || '';
    if (!plain) return;
    this.insertText(plain);
  }

  insertText(text) {
    if (!text) return;
    this.restoreSelection();
    const normalized = String(text).replace(/\r\n?/g, '\n');

    if (normalized.includes('\n')) {
      // Multi-line paste/insert hydrates cleanly using canonical markup if formatted lines exist
      const beforeVal = this.getValue();
      if (!beforeVal) {
        this.setValue(normalized);
        return;
      }
    }

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(normalized);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    this._handleInput();
  }

  // --- Toolbar Commands ---
  _createInlineTag(type, param = null) {
    if (type === 'bold') return document.createElement('strong');
    if (type === 'italic') return document.createElement('em');
    if (type === 'strike') return document.createElement('del');
    if (type === 'underline') {
      const el = document.createElement('u');
      el.className = 'wa-underline';
      return el;
    }
    if (type === 'code') {
      const el = document.createElement('code');
      el.className = 'chat-inline-code';
      return el;
    }
    if (type === 'spoiler') {
      const el = document.createElement('span');
      el.className = 'wa-spoiler rc-spoiler-edit';
      el.dataset.fmt = 'spoiler';
      return el;
    }
    if (type === 'sup') {
      const el = document.createElement('sup');
      el.className = 'wa-sup';
      return el;
    }
    if (type === 'sub') {
      const el = document.createElement('sub');
      el.className = 'wa-sub';
      return el;
    }
    if (type === 'highlight') {
      const code = param && HIGHLIGHT_COLORS[param] ? param : 'y';
      const colorDef = HIGHLIGHT_COLORS[code];
      const el = document.createElement('mark');
      el.className = `wa-hl wa-hl-${colorDef.name}`;
      el.dataset.hlColor = code;
      return el;
    }
    return null;
  }

  _matchesInlineType(el, type) {
    if (!el || el.nodeType !== 1) return false;
    const t = el.tagName;
    if (type === 'bold') return t === 'STRONG' || t === 'B';
    if (type === 'italic') return t === 'EM' || t === 'I';
    if (type === 'strike') return t === 'DEL' || t === 'S';
    if (type === 'underline') return t === 'U' || el.dataset?.fmt === 'underline';
    if (type === 'code') return t === 'CODE';
    if (type === 'spoiler') return el.dataset?.fmt === 'spoiler' || el.classList?.contains('wa-spoiler');
    if (type === 'sup') return t === 'SUP';
    if (type === 'sub') return t === 'SUB';
    if (type === 'highlight') return t === 'MARK';
    return false;
  }

  _findMatchingInlineTagsIn(rootEl, type) {
    const matches = [];
    if (!rootEl) return matches;
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 1) {
        if (this._matchesInlineType(node, type)) {
          matches.push(node);
        }
        for (const ch of Array.from(node.childNodes)) {
          walk(ch);
        }
      } else if (node.childNodes && node.childNodes.length) {
        for (const ch of Array.from(node.childNodes)) {
          walk(ch);
        }
      }
    };
    walk(rootEl);
    return matches;
  }

  _hasUnformattedText(node, type, insideMatch = false) {
    if (!node) return false;
    if (node.nodeType === 3) {
      const clean = (node.nodeValue || '').replace(/[\u200B\u00A0\s]/g, '');
      return clean.length > 0 && !insideMatch;
    }
    if (node.nodeType === 1) {
      if (node.tagName === 'BR' || node.getAttribute?.('contenteditable') === 'false') return false;
      const nowInside = insideMatch || this._matchesInlineType(node, type);
      for (const ch of Array.from(node.childNodes)) {
        if (this._hasUnformattedText(ch, type, nowInside)) return true;
      }
      return false;
    }
    if (node.childNodes) {
      for (const ch of Array.from(node.childNodes)) {
        if (this._hasUnformattedText(ch, type, insideMatch)) return true;
      }
    }
    return false;
  }

  _cleanupEmptyInlineTags(container) {
    if (!container) return;
    const inlineTags = new Set(['STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'STRIKE', 'U', 'CODE', 'MARK', 'SUP', 'SUB', 'SPAN']);
    let changed = true;
    while (changed) {
      changed = false;
      const els = Array.from(container.querySelectorAll('*'));
      for (const el of els) {
        if (el.getAttribute('contenteditable') === 'false') continue;
        if (el.classList?.contains('rc-block') || el.classList?.contains('rc-item-body') || el.classList?.contains('rc-fold-body') || el.classList?.contains('rc-fold-title') || el.classList?.contains('rc-fold-header')) continue;
        if (!inlineTags.has(el.tagName)) continue;
        const cleanTxt = (el.textContent || '').replace(/\u200B/g, '');
        if (!cleanTxt && !el.querySelector('br')) {
          el.remove();
          changed = true;
        }
      }
    }
  }

  _wrapLeafTextNodesWithCode(fragment) {
    const textNodes = [];
    const collect = (n) => {
      if (!n) return;
      if (n.nodeType === 3) {
        if ((n.nodeValue || '').replace(/\u200B/g, '').length > 0) textNodes.push(n);
      } else if (n.childNodes) {
        for (const ch of Array.from(n.childNodes)) collect(ch);
      }
    };
    collect(fragment);
    for (const tn of textNodes) {
      const codeEl = this._createInlineTag('code');
      tn.parentNode.insertBefore(codeEl, tn);
      codeEl.appendChild(tn);
    }
  }

  toggleInline(type, param = null) {
    this.restoreSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!this.el.contains(range.commonAncestorContainer)) return;

    const foldTitleEl = this._getFoldTitleEl(range.startContainer);
    const blockEl = this._getBlockElement(range.startContainer);
    const bodyEl = foldTitleEl || (blockEl?.dataset?.block === 'fold' || blockEl?.dataset?.block === 'embed' ? null : this._getBlockBodyEl(blockEl));
    if (!bodyEl) return;

    const finishToggle = (selectNodeOrRange = null) => {
      this._cleanupEmptyInlineTags(bodyEl);
      if (selectNodeOrRange) {
        try {
          if (selectNodeOrRange instanceof Range) {
            sel.removeAllRanges();
            sel.addRange(selectNodeOrRange);
          } else if (selectNodeOrRange.isConnected) {
            const r = document.createRange();
            r.selectNodeContents(selectNodeOrRange);
            sel.removeAllRanges();
            sel.addRange(r);
          }
        } catch (_) {}
      }
      this._saveSelection();
      this._pushHistory();
      this.scrollCaretIntoView();
      this.onChange(this.getValue());
      this.onSelectionChange(this.getActiveFormats());
    };

    // 1. Check ancestor inline tag matching `type`
    let ancestor = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentNode;
    let existingTag = null;
    while (ancestor && ancestor !== this.el && ancestor !== bodyEl) {
      if (this._matchesInlineType(ancestor, type)) {
        existingTag = ancestor;
        break;
      }
      ancestor = ancestor.parentNode;
    }

    if (existingTag) {
      if (type === 'highlight' && param && param !== 'none' && existingTag.dataset.hlColor !== param) {
        const colorDef = HIGHLIGHT_COLORS[param] || HIGHLIGHT_COLORS.y;
        existingTag.className = `wa-hl wa-hl-${colorDef.name}`;
        existingTag.dataset.hlColor = param;
        finishToggle(existingTag);
        return;
      }

      const cleanTagText = (existingTag.textContent || '').replace(/\u200B/g, '');
      const cleanSelText = range.collapsed ? '' : range.toString().replace(/\u200B/g, '');
      // Partial selection inside existingTag -> split into [before][unwrappedSel][after]
      if (!range.collapsed && cleanSelText.length > 0 && cleanSelText.length < cleanTagText.length) {
        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(existingTag);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        const beforeFrag = beforeRange.cloneContents();

        const afterRange = document.createRange();
        afterRange.selectNodeContents(existingTag);
        afterRange.setStart(range.endContainer, range.endOffset);
        const afterFrag = afterRange.cloneContents();

        const midFrag = range.cloneContents();
        this._findMatchingInlineTagsIn(midFrag, type).forEach((m) => this._unwrapElement(m));

        const parent = existingTag.parentNode;
        const markerStart = document.createTextNode('');
        const markerEnd = document.createTextNode('');

        if ((beforeFrag.textContent || '').replace(/\u200B/g, '').length > 0) {
          const bWrap = existingTag.cloneNode(false);
          bWrap.appendChild(beforeFrag);
          parent.insertBefore(bWrap, existingTag);
        }
        parent.insertBefore(markerStart, existingTag);
        parent.insertBefore(midFrag, existingTag);
        parent.insertBefore(markerEnd, existingTag);
        if ((afterFrag.textContent || '').replace(/\u200B/g, '').length > 0) {
          const aWrap = existingTag.cloneNode(false);
          aWrap.appendChild(afterFrag);
          parent.insertBefore(aWrap, existingTag);
        }
        parent.removeChild(existingTag);

        const newR = document.createRange();
        newR.setStartAfter(markerStart);
        newR.setEndBefore(markerEnd);
        markerStart.remove();
        markerEnd.remove();
        finishToggle(newR);
        return;
      }

      // Full unwrap of existingTag + any duplicate nested matching tags inside it
      const firstChild = existingTag.firstChild;
      const lastChild = existingTag.lastChild;
      this._findMatchingInlineTagsIn(existingTag, type).forEach((m) => {
        if (m !== existingTag) this._unwrapElement(m);
      });
      this._unwrapElement(existingTag);
      if (firstChild && lastChild && firstChild.isConnected && lastChild.isConnected) {
        const newR = document.createRange();
        newR.setStartBefore(firstChild);
        newR.setEndAfter(lastChild);
        if (range.collapsed) newR.collapse(false);
        finishToggle(newR);
      } else {
        finishToggle();
      }
      return;
    }

    // 2. Build target range (selected text, OR entire line body if collapsed)
    const targetRange = range.cloneRange();
    if (range.collapsed) {
      const textLen = (bodyEl.textContent || '').replace(/\u200B/g, '').trim().length;
      if (textLen === 0) {
        if (type === 'highlight' && param === 'none') return;
        const wrapper = this._createInlineTag(type, param);
        if (!wrapper) return;
        const innerText = document.createTextNode('text');
        wrapper.appendChild(innerText);
        range.insertNode(wrapper);
        const trail = document.createTextNode('\u200B');
        wrapper.after(trail);
        finishToggle(wrapper);
        return;
      }
      targetRange.selectNodeContents(bodyEl);
      if (bodyEl.lastChild && bodyEl.lastChild.nodeName === 'BR') {
        targetRange.setEndBefore(bodyEl.lastChild);
      }
    }

    // 3. Inspect descendants inside targetRange: if ALREADY fully formatted with `type`, UNWRAP cleanly!
    const probeFrag = targetRange.cloneContents();
    const descendantMatches = this._findMatchingInlineTagsIn(probeFrag, type);
    const hasPlainText = this._hasUnformattedText(probeFrag, type, false);

    if (descendantMatches.length > 0 && (!hasPlainText || (type === 'highlight' && param === 'none'))) {
      const extracted = targetRange.extractContents();
      const liveMatches = this._findMatchingInlineTagsIn(extracted, type);
      if (type === 'highlight' && param && param !== 'none' && liveMatches.some((m) => m.dataset.hlColor !== param)) {
        const colorDef = HIGHLIGHT_COLORS[param] || HIGHLIGHT_COLORS.y;
        liveMatches.forEach((m) => {
          m.className = `wa-hl wa-hl-${colorDef.name}`;
          m.dataset.hlColor = param;
        });
      } else {
        // Unwrap bottom-up
        liveMatches.reverse().forEach((m) => this._unwrapElement(m));
      }
      const startPin = document.createTextNode('');
      const endPin = document.createTextNode('');
      targetRange.insertNode(endPin);
      targetRange.insertNode(extracted);
      targetRange.insertNode(startPin);
      const newR = document.createRange();
      newR.setStartAfter(startPin);
      newR.setEndBefore(endPin);
      startPin.remove();
      endPin.remove();
      finishToggle(newR);
      return;
    }

    if (type === 'highlight' && param === 'none') return;

    // 4. Apply format cleanly (stripping any inner duplicates so double-wrapping is impossible!)
    const contents = targetRange.extractContents();
    this._findMatchingInlineTagsIn(contents, type).reverse().forEach((m) => this._unwrapElement(m));

    if (type === 'code') {
      // Keep <code> at leaf text level so bold/italic/highlight wrap OUTSIDE backticks (`*`text`*`) with zero stray markers!
      this._wrapLeafTextNodesWithCode(contents);
      const startPin = document.createTextNode('');
      const endPin = document.createTextNode('');
      targetRange.insertNode(endPin);
      targetRange.insertNode(contents);
      targetRange.insertNode(startPin);
      const newR = document.createRange();
      newR.setStartAfter(startPin);
      newR.setEndBefore(endPin);
      startPin.remove();
      endPin.remove();
      finishToggle(newR);
      return;
    }

    const wrapper = this._createInlineTag(type, param);
    if (!wrapper) return;
    wrapper.appendChild(contents);
    targetRange.insertNode(wrapper);
    finishToggle(wrapper);
  }

  _unwrapElement(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
  }

  _unwrapFoldBlock(foldEl) {
    if (!foldEl || !foldEl.parentNode) return;
    const titleEl = foldEl.querySelector(':scope > .rc-fold-header > .rc-fold-title');
    const bodyEl = foldEl.querySelector(':scope > .rc-fold-body');
    const rawTitle = titleEl
      ? this._serializeChildren(titleEl).replace(/\u200B/g, '').replace(/\u00A0/g, ' ').trim()
      : '';

    const parent = foldEl.parentNode;
    let firstInserted = null;

    if (rawTitle) {
      const tp = this._makeBlockEl('p');
      this._populateInlineNodes(tp, rawTitle);
      parent.insertBefore(tp, foldEl);
      if (!firstInserted) firstInserted = tp;
    }

    if (bodyEl) {
      const bodyBlocks = Array.from(bodyEl.querySelectorAll(':scope > .rc-block'));
      for (const blk of bodyBlocks) {
        const blkText = this._serializeBlockContainer({ childNodes: [blk] }).trim();
        if (!blkText && (rawTitle || bodyBlocks.length > 1)) continue;
        parent.insertBefore(blk, foldEl);
        if (!firstInserted) firstInserted = blk;
      }
    }

    if (!firstInserted) {
      firstInserted = this._makeBlockEl('p');
      parent.insertBefore(firstInserted, foldEl);
    }

    foldEl.remove();
    this._ensureAtLeastOneBlock();
    const targetBody = this._getBlockBodyEl(firstInserted);
    this._placeCaretAtStart(targetBody?.firstChild || targetBody);
    this._pushHistory();
    this.onChange(this.getValue());
    this.onSelectionChange(this.getActiveFormats());
  }

  toggleBlock(blockType, options = {}) {
    this.restoreSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const startNode = sel.getRangeAt(0).startContainer;
    if (this._getFoldTitleEl(startNode)) return;
    const blockEl = this._getBlockElement(startNode) || this.el.firstElementChild;
    if (!blockEl || blockEl.dataset?.block === 'fold') return;

    const currentType = blockEl.dataset?.block || 'p';
    const currentShape = blockEl.dataset?.bulletType || 'bullet';
    let nextType = currentType;
    let bulletType = options.bulletType || this._lastBulletType || 'bullet';

    if (blockType === 'ul') {
      if (options.bulletType) this._lastBulletType = options.bulletType;
      if (currentType === 'ul' && (!options.bulletType || currentShape === options.bulletType)) {
        nextType = 'p';
      } else {
        nextType = 'ul';
      }
    } else {
      nextType = currentType === blockType ? 'p' : blockType;
    }

    const indent = (nextType === 'ul' || nextType === 'ol' || nextType === 'check')
      ? Number(blockEl.dataset?.indent || 0)
      : 0;

    const oldBody = this._getBlockBodyEl(blockEl);
    const preservedLayout = { align: blockEl.dataset?.align || null, dir: blockEl.dataset?.dir || null };
    const replacement = this._makeBlockEl(nextType, { ...preservedLayout, indent, checked: false, bulletType });
    const newBody = this._getBlockBodyEl(replacement);
    newBody.innerHTML = '';

    if (nextType === 'codeblock') {
      // Extract clean plain text so toggling codeblock ON -> OFF never leaves stray markdown markers (` or *) behind!
      newBody.textContent = (oldBody.textContent || '').replace(/\u200B/g, '').replace(/\u00A0/g, ' ');
    } else if (currentType === 'codeblock') {
      const plain = (oldBody.textContent || '').replace(/\u200B/g, '').replace(/\u00A0/g, ' ');
      newBody.appendChild(plain ? document.createTextNode(plain) : document.createElement('br'));
    } else {
      while (oldBody.firstChild) {
        const ch = oldBody.firstChild;
        if (ch.nodeType === 1 && ch.getAttribute('contenteditable') === 'false') {
          ch.remove();
        } else {
          newBody.appendChild(ch);
        }
      }
      if (!newBody.firstChild) newBody.appendChild(document.createElement('br'));
    }

    blockEl.replaceWith(replacement);
    this._syncOrderedNumbers();
    this._placeCaretAtEnd(newBody);
    this._pushHistory();
    this.scrollCaretIntoView();
    this.onChange(this.getValue());
    this.onSelectionChange(this.getActiveFormats());
  }

  _getTargetBlocksForSelection() {
    this.restoreSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      return this.el.firstElementChild ? [this.el.firstElementChild] : [];
    }
    const range = sel.getRangeAt(0);
    const startBlk = this._getBlockElement(range.startContainer);
    const endBlk = this._getBlockElement(range.endContainer);
    if (!startBlk) return this.el.firstElementChild ? [this.el.firstElementChild] : [];
    if (!endBlk || startBlk === endBlk) return [startBlk];

    const allBlocks = Array.from(this.el.querySelectorAll('.rc-block'));
    const i1 = allBlocks.indexOf(startBlk);
    const i2 = allBlocks.indexOf(endBlk);
    if (i1 === -1 || i2 === -1) return [startBlk];
    const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
    return allBlocks.slice(lo, hi + 1);
  }

  setBlockAlignment(align) {
    const blocks = this._getTargetBlocksForSelection();
    if (blocks.length === 0) return;
    for (const blk of blocks) {
      if (blk.dataset?.block === 'embed' || blk.dataset?.block === 'codeblock') continue;
      const nextAlign = blk.dataset?.align === align ? null : align;
      this._applyBlockLayoutAttrs(blk, nextAlign, blk.dataset?.dir || null);
    }
    this._pushHistory();
    this.scrollCaretIntoView();
    this.onChange(this.getValue());
    this.onSelectionChange(this.getActiveFormats());
  }

  setBlockDirection(dir) {
    const blocks = this._getTargetBlocksForSelection();
    if (blocks.length === 0) return;
    for (const blk of blocks) {
      if (blk.dataset?.block === 'embed' || blk.dataset?.block === 'codeblock') continue;
      const nextDir = (dir === 'auto' || blk.dataset?.dir === dir) ? null : dir;
      this._applyBlockLayoutAttrs(blk, blk.dataset?.align || null, nextDir);
    }
    this._pushHistory();
    this.scrollCaretIntoView();
    this.onChange(this.getValue());
    this.onSelectionChange(this.getActiveFormats());
  }

  insertEmbed({ kind = 'file', mediaId = '', layout = 'full', label = '', previewUrl = '' } = {}) {
    if (!mediaId || !this.el) return null;
    this.restoreSelection();
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const anchorBlock = range ? this._getBlockElement(range.startContainer) : null;

    const embedEl = this._makeBlockEl('embed', { kind, mediaId, layout, label, previewUrl });
    if (anchorBlock && this.el.contains(anchorBlock)) {
      const isEmptyP = anchorBlock.dataset?.block === 'p' &&
        !this._serializeChildren(anchorBlock).replace(/\u200B/g, '').trim();
      if (isEmptyP) {
        anchorBlock.replaceWith(embedEl);
      } else {
        anchorBlock.after(embedEl);
      }
    } else {
      this.el.appendChild(embedEl);
    }

    // Ensure there is always a tappable paragraph right after the embed so user can keep typing below
    let nextP = embedEl.nextElementSibling;
    if (!nextP || nextP.dataset?.block === 'embed') {
      nextP = this._makeBlockEl('p');
      embedEl.after(nextP);
    }
    this._ensureAtLeastOneBlock();
    const targetBody = this._getBlockBodyEl(nextP);
    this._placeCaretAtStart(targetBody?.firstChild || targetBody || nextP);
    this._pushHistory();
    this.scrollCaretIntoView();
    this.onChange(this.getValue());
    this.onSelectionChange(this.getActiveFormats());
    return embedEl;
  }

  updateEmbedPreview(mediaId, previewUrl, label = null) {
    if (!mediaId || !this.el) return;
    if (previewUrl) this._embedPreviewUrls.set(String(mediaId), previewUrl);
    this.el.querySelectorAll(`.rc-block[data-block="embed"][data-embed-media-id="${CSS.escape ? CSS.escape(String(mediaId)) : String(mediaId)}"]`).forEach((emb) => {
      if (label !== null) {
        emb.dataset.embedLabel = label;
        const lbl = emb.querySelector('.rc-embed-label');
        if (lbl) lbl.textContent = label;
      }
      if (previewUrl) {
        const img = emb.querySelector('.rc-embed-thumb');
        if (img) img.src = previewUrl;
      }
    });
  }

  indent(delta = 1) {
    this.restoreSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const blockEl = this._getBlockElement(sel.getRangeAt(0).startContainer);
    if (!blockEl || blockEl.dataset?.block === 'fold') return;
    const bType = blockEl.dataset?.block;
    if (bType !== 'ul' && bType !== 'ol' && bType !== 'check') {
      if (delta > 0) this.toggleBlock('ul', { bulletType: this._lastBulletType });
      return;
    }
    const cur = Number(blockEl.dataset.indent || 0);
    const next = Math.max(0, Math.min(3, cur + delta));
    blockEl.dataset.indent = String(next);
    this._syncOrderedNumbers();
    this._pushHistory();
    this.onChange(this.getValue());
    this.onSelectionChange(this.getActiveFormats());
  }

  getSelectedText() {
    this.restoreSelection();
    const sel = window.getSelection();
    return sel ? sel.toString().replace(/\u200B/g, '').trim() : '';
  }

  insertWordLink(label, rawUrl) {
    const safeUrl = sanitizeUrl(rawUrl);
    if (!safeUrl) return false;
    const visibleLabel = (label || '').trim() || safeUrl;

    this.restoreSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    if (!this.el.contains(range.commonAncestorContainer)) return false;

    range.deleteContents();
    const a = document.createElement('a');
    a.className = 'chat-link chat-word-link';
    a.href = safeUrl;
    a.dataset.href = safeUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = visibleLabel;
    range.insertNode(a);

    const trail = document.createTextNode('\u200B ');
    a.after(trail);
    const nextRange = document.createRange();
    nextRange.setStart(trail, trail.nodeValue.length);
    nextRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nextRange);

    this._ensureAtLeastOneBlock();
    this._pushHistory();
    this.onChange(this.getValue());
    this.onSelectionChange(this.getActiveFormats());
    return true;
  }

  insertFoldBlock(title = '') {
    this.restoreSelection();
    const sel = window.getSelection();
    const range = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
    const anchorNode = range ? range.startContainer : null;
    const existingFold = anchorNode ? this._getEnclosingFold(anchorNode) : null;

    if (existingFold) {
      const existingTitleEl = existingFold.querySelector(':scope > .rc-fold-header > .rc-fold-title');
      const existingBodyEl = existingFold.querySelector(':scope > .rc-fold-body');
      const hasContent = Boolean(
        this._serializeChildren(existingTitleEl).replace(/\u200B/g, '').trim() ||
        this._serializeBlockContainer(existingBodyEl).trim()
      );
      if (!hasContent) {
        this._unwrapFoldBlock(existingFold);
        return;
      }
    }

    let initialBodyMarkup = '';
    let anchorBlock = anchorNode ? this._getBlockElement(anchorNode) : null;
    if (existingFold) anchorBlock = existingFold;

    if (range && !range.collapsed && this.el.contains(range.commonAncestorContainer)) {
      const selected = range.toString().replace(/\u200B/g, '').trim();
      if (selected) {
        initialBodyMarkup = selected;
        range.deleteContents();
      }
    } else if (anchorBlock && anchorBlock.dataset?.block === 'p' && !existingFold) {
      const currentLine = this._serializeChildren(anchorBlock).replace(/\u200B/g, '').trim();
      if (currentLine) {
        initialBodyMarkup = currentLine;
      }
    }

    const foldEl = this._makeBlockEl('fold', {
      title: (title || '').trim(),
      bodyMarkup: initialBodyMarkup,
      open: true
    });

    if (anchorBlock && this.el.contains(anchorBlock)) {
      const anchorIsEmptyP = anchorBlock.dataset?.block === 'p' &&
        !this._serializeChildren(anchorBlock).replace(/\u200B/g, '').trim();
      if (anchorIsEmptyP || (!existingFold && anchorBlock.dataset?.block === 'p' && initialBodyMarkup)) {
        anchorBlock.replaceWith(foldEl);
      } else {
        anchorBlock.after(foldEl);
      }
    } else {
      this.el.appendChild(foldEl);
    }

    // Always keep a tappable trailing paragraph below a bottom fold so user can type outside
    if (!foldEl.nextElementSibling) {
      foldEl.after(this._makeBlockEl('p'));
    }

    if ((title || '').trim()) {
      const firstBlk = foldEl.querySelector(':scope > .rc-fold-body > .rc-block') || foldEl;
      const bodyTarget = this._getBlockBodyEl(firstBlk);
      this._placeCaretAtStart(bodyTarget?.firstChild || bodyTarget);
    } else {
      const titleEl = foldEl.querySelector(':scope > .rc-fold-header > .rc-fold-title');
      this._placeCaretAtStart(titleEl?.firstChild || titleEl);
    }

    this._ensureAtLeastOneBlock();
    this._pushHistory();
    this.onChange(this.getValue());
    this.onSelectionChange(this.getActiveFormats());
  }

  clearFormatting() {
    this.restoreSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);

    if (range.collapsed) {
      const foldTitleEl = this._getFoldTitleEl(range.startContainer);
      if (foldTitleEl) {
        const plain = (foldTitleEl.textContent || '').replace(/\u200B/g, '');
        foldTitleEl.innerHTML = '';
        foldTitleEl.appendChild(plain ? document.createTextNode(plain) : document.createElement('br'));
        this._placeCaretAtEnd(foldTitleEl);
      } else {
        // Clear formatting on current block/whole line
        const blockEl = this._getBlockElement(range.startContainer);
        if (blockEl && blockEl.dataset?.block !== 'fold') {
          const plain = (this._getBlockBodyEl(blockEl).textContent || '').replace(/\u200B/g, '');
          const p = this._makeBlockEl('p');
          p.innerHTML = '';
          p.appendChild(plain ? document.createTextNode(plain) : document.createElement('br'));
          blockEl.replaceWith(p);
          this._placeCaretAtEnd(p);
        }
      }
    } else {
      const plain = range.toString().replace(/\u200B/g, '');
      range.deleteContents();
      const tn = document.createTextNode(plain);
      range.insertNode(tn);
      range.setStartAfter(tn);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    this._syncOrderedNumbers();
    this._pushHistory();
    this.onChange(this.getValue());
    this.onSelectionChange(this.getActiveFormats());
  }

  getActiveFormats() {
    const active = {
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      code: false,
      highlight: false,
      hlColor: null,
      spoiler: false,
      sup: false,
      sub: false,
      block: 'p',
      align: null,
      dir: null
    };

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return active;
    const range = sel.getRangeAt(0);
    let node = range.startContainer;
    if (!this.el.contains(node)) return active;

    let currentBlock = null;
    while (node && node !== this.el) {
      if (node.nodeType === 1) {
        if (node.classList?.contains('rc-block')) {
          currentBlock = node;
          active.block = node.dataset?.block || 'p';
          active.align = node.dataset?.align || null;
          active.dir = node.dataset?.dir || null;
          break;
        }
        if (this._matchesInlineType(node, 'bold')) active.bold = true;
        if (this._matchesInlineType(node, 'italic')) active.italic = true;
        if (this._matchesInlineType(node, 'underline')) active.underline = true;
        if (this._matchesInlineType(node, 'strike')) active.strike = true;
        if (this._matchesInlineType(node, 'code')) active.code = true;
        if (this._matchesInlineType(node, 'spoiler')) active.spoiler = true;
        if (this._matchesInlineType(node, 'sup')) active.sup = true;
        if (this._matchesInlineType(node, 'sub')) active.sub = true;
        if (node.tagName === 'MARK') {
          active.highlight = true;
          active.hlColor = node.dataset?.hlColor || 'y';
        }
      }
      node = node.parentNode;
    }

    // Also inspect inner wrapped elements when selection spans across them
    if (!range.collapsed) {
      try {
        const frag = range.cloneContents();
        for (const fmt of ['bold', 'italic', 'underline', 'strike', 'code', 'spoiler', 'sup', 'sub', 'highlight']) {
          if (!active[fmt] && this._findMatchingInlineTagsIn(frag, fmt).length > 0 && !this._hasUnformattedText(frag, fmt, false)) {
            active[fmt] = true;
          }
        }
      } catch (_) {}
    } else if (currentBlock) {
      const body = this._getBlockBodyEl(currentBlock);
      if (body && (body.textContent || '').replace(/\u200B/g, '').trim().length > 0) {
        for (const fmt of ['bold', 'italic', 'underline', 'strike', 'code', 'spoiler', 'sup', 'sub', 'highlight']) {
          if (!active[fmt] && this._findMatchingInlineTagsIn(body, fmt).length > 0 && !this._hasUnformattedText(body, fmt, false)) {
            active[fmt] = true;
          }
        }
      }
    }

    return active;
  }

  // --- Undo / Redo Snapshot Stack ---
  _resetHistory(initialVal = '') {
    this._undoStack = [initialVal];
    this._undoIdx = 0;
  }

  _pushHistory() {
    const cur = this.getValue();
    this._syncEmptyState();
    if (this._undoStack[this._undoIdx] === cur) return;
    this._undoStack = this._undoStack.slice(0, this._undoIdx + 1);
    this._undoStack.push(cur);
    if (this._undoStack.length > this._maxHistory) {
      this._undoStack.shift();
    }
    this._undoIdx = this._undoStack.length - 1;
  }

  canUndo() { return this._undoIdx > 0; }
  canRedo() { return this._undoIdx < this._undoStack.length - 1; }

  undo() {
    if (!this.canUndo()) return;
    this._undoIdx--;
    const val = this._undoStack[this._undoIdx];
    this._applySnapshot(val);
  }

  redo() {
    if (!this.canRedo()) return;
    this._undoIdx++;
    const val = this._undoStack[this._undoIdx];
    this._applySnapshot(val);
  }

  _applySnapshot(val) {
    this._suppressInput = true;
    try {
      this._renderMarkupToContainer(this.el, val || '');
      this._ensureAtLeastOneBlock();
      this._placeCaretAtEnd(this.el.lastElementChild || this.el);
      this._syncEmptyState();
    } finally {
      this._suppressInput = false;
      this.onChange(this.getValue());
      this.onSelectionChange(this.getActiveFormats());
    }
  }
}
