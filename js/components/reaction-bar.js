// Floating Reaction Bar — appears near long-pressed message
// Non-blocking: tapping any header button, overflow action, or message outside the bar
// triggers its own action immediately on the first tap while dismissing the bar automatically.

export class ReactionBar {
  constructor({ onReact, onOpenPicker } = {}) {
    this.onReact = onReact || (() => {});
    this.onOpenPicker = onOpenPicker || (() => {});
    this.currentMsgId = null;
    this.currentReaction = null;
    this.barEl = null;
    this._isVisible = false;
    this._escHandler = null;
    this._outsidePointerHandler = null;
    this._scrollHandler = null;
    this._buildDOM();
  }

  _buildDOM() {
    this.barEl = document.createElement('div');
    this.barEl.className = 'floating-reaction-bar';
    this.barEl.setAttribute('role', 'toolbar');
    this.barEl.setAttribute('aria-label', 'React to message');

    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    emojis.forEach((emoji) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reaction-emoji-btn';
      btn.dataset.emoji = emoji;
      btn.textContent = emoji;
      btn.setAttribute('aria-label', `React with ${emoji}`);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newReaction = this.currentReaction === emoji ? null : emoji;
        this.onReact(this.currentMsgId, newReaction);
        this.hide();
      });
      this.barEl.appendChild(btn);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'reaction-emoji-btn reaction-add-btn';
    addBtn.textContent = '+';
    addBtn.setAttribute('aria-label', 'More emojis');
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const msgId = this.currentMsgId;
      this.hide(true);
      this.onOpenPicker(msgId);
    });
    this.barEl.appendChild(addBtn);

    document.body.appendChild(this.barEl);
    this.barEl.style.display = 'none';
  }

  _detachGlobalListeners() {
    if (this._outsidePointerHandler) {
      document.removeEventListener('pointerdown', this._outsidePointerHandler, { capture: true });
      this._outsidePointerHandler = null;
    }
    if (this._scrollHandler) {
      window.removeEventListener('scroll', this._scrollHandler, { capture: true });
      this._scrollHandler = null;
    }
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  }

  /**
   * Show the reaction bar near rowEl.
   * @param {string|number} msgId
   * @param {HTMLElement} rowEl  - the .msg-row element
   * @param {string|null} [currentReaction] - existing emoji reaction
   */
  show(msgId, rowEl, currentReaction = null) {
    this._detachGlobalListeners();
    this.currentMsgId = msgId;
    this.currentReaction = currentReaction;
    this._isVisible = true;

    this.barEl.querySelectorAll('.reaction-emoji-btn').forEach((btn) => {
      if (btn.dataset.emoji && btn.dataset.emoji === currentReaction) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });

    const target = rowEl?.querySelector?.('.msg-bubble') || rowEl;
    const rect = target?.getBoundingClientRect ? target.getBoundingClientRect() : { top: 200, bottom: 250, left: 20, right: 200 };
    const barHeight = 52;
    const margin = 10;
    const viewH = window.innerHeight || 800;
    const viewW = window.innerWidth || 400;

    const showAbove = rect.top > viewH * 0.45;
    const barWidth = 300;

    let left = rect.left;
    if (rect.right > viewW * 0.5) {
      left = rect.right - barWidth;
    }
    if (left + barWidth > viewW - 12) left = viewW - barWidth - 12;
    if (left < 12) left = 12;

    let top = showAbove ? (rect.top - barHeight - margin) : (rect.bottom + margin);
    top = Math.max(12, Math.min(viewH - barHeight - 12, top));

    this.barEl.style.left = `${Math.round(left)}px`;
    this.barEl.style.top = `${Math.round(top)}px`;
    this.barEl.style.display = 'flex';

    this.barEl.classList.remove('reaction-bar-visible');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this._isVisible) {
          this.barEl.classList.add('reaction-bar-visible');
        }
      });
    });

    // Capture-phase passive listeners: NEVER call preventDefault() or stopPropagation()
    // so external taps (selection bar actions, overflow menu, other messages) fire immediately!
    this._outsidePointerHandler = (e) => {
      if (!this._isVisible) return;
      if (this.barEl && typeof this.barEl.contains === 'function' && this.barEl.contains(e.target)) {
        return;
      }
      this.hide();
    };
    document.addEventListener('pointerdown', this._outsidePointerHandler, { capture: true, passive: true });

    this._scrollHandler = (e) => {
      if (!this._isVisible) return;
      if (this.barEl && typeof this.barEl.contains === 'function' && this.barEl.contains(e.target)) {
        return;
      }
      this.hide();
    };
    window.addEventListener('scroll', this._scrollHandler, { capture: true, passive: true });

    this._escHandler = (e) => {
      if (e.key === 'Escape') this.hide();
    };
    document.addEventListener('keydown', this._escHandler);
  }

  hide(immediate = false) {
    this._isVisible = false;
    this._detachGlobalListeners();

    this.barEl.classList.remove('reaction-bar-visible');
    if (immediate) {
      this.barEl.style.display = 'none';
    } else {
      setTimeout(() => {
        if (!this._isVisible && !this.barEl.classList.contains('reaction-bar-visible')) {
          this.barEl.style.display = 'none';
        }
      }, 150);
    }

    this.currentMsgId = null;
    this.currentReaction = null;
  }

  destroy() {
    this.hide(true);
    if (this.barEl && this.barEl.parentNode) this.barEl.parentNode.removeChild(this.barEl);
  }
}
