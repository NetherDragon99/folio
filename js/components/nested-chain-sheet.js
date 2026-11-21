/**
 * Multi-Level Nested Tree Sheet (System A — Independent of List Numbering)
 * Displays the complete hierarchical tree of nested messages from root ancestor down to all depths,
 * supporting fluid 2D pointer drag-and-drop (vertical gap-opening reorder + horizontal snap stops),
 * immediate child promotion on lift, automatic tree rank rebalancing, and authentic time display.
 */
import { DrawerResizer } from '../utils/drawer-resizer.js';
import { Icons } from '../icons.js';
import { escapeHtml, stripRichMarkup } from '../utils/rich-text.js';
import {
  flattenNestedTree,
  removeDraggedNodeFromFlatList,
  getValidDepthRangeAtSlot,
  snapHorizontalDepth,
  findParentPreviewAtSlot,
  applyTreeDragDrop
} from '../utils/nested-tree-dnd.js';

const TREE_STEP_PX = 22;
const TREE_MAX_DEPTH = 6;
const DRAG_ACTIVATION_PX = 4;

export class NestedChainSheet {
  constructor() {
    this.overlayEl = null;
    this.sheetEl = null;
    this.handleEl = null;
    this.fsHeaderEl = null;
    this.bodyEl = null;
    this.resizer = null;
    this._built = false;
  }

  _ensureBuilt() {
    if (this._built) return;
    this._built = true;

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'nested-tree-overlay wa-sheet-overlay';
    this.overlayEl.style.display = 'none';

    this.sheetEl = document.createElement('div');
    this.sheetEl.className = 'nested-tree-sheet wa-bottom-sheet';
    this.sheetEl.style.display = 'none';

    this.handleEl = document.createElement('div');
    this.handleEl.className = 'sheet-handle-area';
    this.handleEl.innerHTML = `
      <div class="sheet-dash"></div>
      <div class="nested-tree-title" id="nested-tree-title">Nested Message Tree</div>
    `;
    this.sheetEl.appendChild(this.handleEl);

    this.fsHeaderEl = document.createElement('div');
    this.fsHeaderEl.className = 'sheet-fullscreen-header';
    this.fsHeaderEl.style.display = 'none';
    this.fsHeaderEl.innerHTML = `
      <button type="button" class="app-bar-icon-btn sheet-fullscreen-back-btn" aria-label="Back">${Icons.arrowBack('', 24)}</button>
      <span class="fs-header-title">Nested Message Tree</span>
    `;
    this.sheetEl.appendChild(this.fsHeaderEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'nested-tree-body';
    this.sheetEl.appendChild(this.bodyEl);

    document.body.appendChild(this.overlayEl);
    document.body.appendChild(this.sheetEl);

    this.resizer = new DrawerResizer({
      sheet: this.sheetEl,
      handle: this.handleEl,
      backdrop: this.overlayEl,
      fullscreenHeader: this.fsHeaderEl,
      overlayId: 'nested-tree-sheet',
      mode: 'bottom',
      defaultHeightVh: 55,
      minVh: 20,
      maxVh: 80,
      onClose: () => {
        this.overlayEl.style.display = 'none';
      }
    });
  }

  _findTopAncestor(startMsg, msgById) {
    let cur = startMsg;
    const visited = new Set();
    while (cur && cur.nestedParent && cur.nestedParent.id) {
      const curId = String(cur.id);
      if (visited.has(curId)) break;
      visited.add(curId);
      const parent = msgById.get(String(cur.nestedParent.id));
      if (!parent) break;
      cur = parent;
    }
    return cur;
  }

  _getMessageSnippet(msg) {
    if (!msg) return '';
    if (msg.isDeleted) return 'This message was deleted';
    const clean = stripRichMarkup(msg.text || '');
    if (clean) return clean.slice(0, 110);
    if (msg.mediaName) return msg.mediaName;
    if (msg.mediaType) return `[${msg.mediaType}]`;
    return 'Message';
  }

  _formatTime(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (_) {
      return '';
    }
  }

  open({
    rootMsg,
    focusMsg = null,
    allMessages = [],
    nestedChildrenByParentId = new Map(),
    listPositionByMsgId = new Map(),
    getTreeState = null,
    onJumpToMessage = () => {},
    onAddNestedChild = () => {},
    onUnlinkNested = async () => {},
    onReparentNested = async () => {},
    onCommitTreeChange = null
  }) {
    if (!rootMsg) return;
    this._ensureBuilt();

    let anchorMsgId = String(rootMsg.id);
    const focusId = focusMsg ? String(focusMsg.id) : String(rootMsg.id);

    const resolveState = () => {
      if (typeof getTreeState === 'function') {
        const fresh = getTreeState();
        if (fresh) return fresh;
      }
      return { allMessages, nestedChildrenByParentId, listPositionByMsgId };
    };

    const renderBody = () => {
      const state = resolveState();
      const curMessages = state.allMessages || [];
      const curChildrenMap = state.nestedChildrenByParentId || new Map();
      const curListPosMap = state.listPositionByMsgId || new Map();

      const msgById = new Map(curMessages.map((m) => [String(m.id), m]));
      const anchorMsg = msgById.get(anchorMsgId) || msgById.get(focusId) || curMessages.find((m) => String(m.id) === String(rootMsg.id)) || rootMsg;
      const topAncestor = this._findTopAncestor(anchorMsg, msgById) || anchorMsg;
      anchorMsgId = String(topAncestor.id);

      this.bodyEl.innerHTML = '';
      const visited = new Set();
      let renderedCount = 0;

      const listEl = document.createElement('div');
      listEl.className = 'nested-tree-list';

      const appendNode = (msg, depth, siblingIndex = 0, siblingsArray = []) => {
        const idStr = String(msg.id);
        if (visited.has(idStr)) return;
        visited.add(idStr);
        renderedCount++;

        const row = document.createElement('div');
        row.className = `nested-tree-node${idStr === focusId ? ' is-focused' : ''}`;
        row.dataset.msgId = idStr;
        row.dataset.depth = String(depth);
        row.style.setProperty('--tree-depth', String(Math.min(TREE_MAX_DEPTH, depth)));

        const senderName = msg.isOutgoing ? 'You' : (msg.sender || 'Contact');
        const listInfo = curListPosMap.get(idStr);
        const listBadgeHtml = listInfo
          ? `<span class="nested-tree-list-badge">${listInfo.style === 'ordered' ? `${listInfo.index}` : '•'}</span>`
          : '';
        const depthTag = depth > 0
          ? `<span class="nested-tree-depth-tag">L${depth}</span>`
          : '<span class="nested-tree-root-tag">Root</span>';

        row.innerHTML = `
          <div class="nested-tree-branch-guide">${depth > 0 ? '└─' : ''}</div>
          <button type="button" class="nested-tree-drag-handle" title="Hold & drag in any direction to reorder or change level" aria-label="Drag to reorder or indent">☰</button>
          <div class="nested-tree-card" role="button" tabindex="0">
            <div class="nested-tree-card-top">
              <div class="nested-tree-sender-group">
                ${listBadgeHtml}
                <span class="nested-tree-sender">${escapeHtml(senderName)}</span>
                ${depthTag}
              </div>
              <span class="nested-tree-time">${escapeHtml(this._formatTime(msg.displayTimestamp ?? msg.timestamp))}</span>
            </div>
            <div class="nested-tree-snippet" dir="auto">${escapeHtml(this._getMessageSnippet(msg))}</div>
          </div>
          <div class="nested-tree-actions">
            ${depth > 0 ? `<button type="button" class="nested-tree-btn outdent-btn" title="Move level up (-)">-</button>` : ''}
            ${siblingIndex > 0 ? `<button type="button" class="nested-tree-btn indent-btn" title="Nest under above sibling (+)">+</button>` : ''}
            <button type="button" class="nested-tree-btn add-child" title="Add nested message under this">${Icons.treeBranch('', 16)}</button>
            ${depth > 0 ? `<button type="button" class="nested-tree-btn unlink-child" title="Unnest this message">${Icons.close('', 16)}</button>` : ''}
          </div>
        `;

        // Fluid 2D Pointer Drag-and-Drop (vertical reorder with gap animation + horizontal level snap stops)
        const dragHandle = row.querySelector('.nested-tree-drag-handle');
        if (dragHandle) {
          dragHandle.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startY = e.clientY;
            let dragActive = false;
            let flatItems = null;
            let liftState = null;
            let dragRect = null;
            let remainingRows = [];
            let placeholderEl = null;
            let guidesEl = null;
            let pillEl = null;
            let currentSlotIndex = 0;
            let currentSnappedDepth = depth;
            let autoScrollRaf = null;
            let latestClientY = startY;

            const updateTagAndDepthOnRow = (r, dVal) => {
              r.style.setProperty('--tree-depth', String(Math.min(TREE_MAX_DEPTH, dVal)));
              const guide = r.querySelector('.nested-tree-branch-guide');
              if (guide) guide.textContent = dVal > 0 ? '└─' : '';
              const tagEl = r.querySelector('.nested-tree-root-tag, .nested-tree-depth-tag');
              if (tagEl) {
                if (dVal > 0) {
                  tagEl.className = 'nested-tree-depth-tag';
                  tagEl.textContent = `L${dVal}`;
                } else {
                  tagEl.className = 'nested-tree-root-tag';
                  tagEl.textContent = 'Root';
                }
              }
            };

            const flipMovePlaceholder = (newSlot) => {
              if (!placeholderEl) return;
              const beforeRects = remainingRows.map((r) => r.getBoundingClientRect().top);

              if (newSlot >= remainingRows.length) {
                listEl.appendChild(placeholderEl);
              } else {
                listEl.insertBefore(placeholderEl, remainingRows[newSlot]);
              }

              remainingRows.forEach((r, idx) => {
                const afterTop = r.getBoundingClientRect().top;
                const delta = beforeRects[idx] - afterTop;
                if (Math.abs(delta) > 0.5) {
                  r.style.transition = 'none';
                  r.style.transform = `translateY(${delta}px)`;
                  requestAnimationFrame(() => {
                    r.style.transition = 'transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1), padding-left 150ms ease';
                    r.style.transform = '';
                  });
                }
              });
            };

            const updateVisualFeedback = (slotIdx, snappedDepthVal) => {
              if (!placeholderEl || !liftState) return;
              const preview = findParentPreviewAtSlot(liftState.remaining, slotIdx, snappedDepthVal);
              const clampedPreviewDepth = Math.min(TREE_MAX_DEPTH, snappedDepthVal);
              placeholderEl.style.setProperty('--tree-depth', String(clampedPreviewDepth));
              placeholderEl.classList.toggle('is-unnest-target', preview.action === 'unnest');
              placeholderEl.classList.toggle('is-root-target', preview.action === 'new-root');

              let labelText = '';
              if (preview.action === 'new-root') {
                labelText = 'New Root (L0)';
              } else if (preview.action === 'unnest') {
                labelText = 'Unnest (Remove from tree)';
              } else {
                const pName = preview.parentMsg
                  ? (preview.parentMsg.isOutgoing ? 'You' : (preview.parentMsg.sender || 'Contact'))
                  : 'Parent';
                labelText = `L${snappedDepthVal} • under ${pName}`;
              }
              placeholderEl.textContent = labelText;
              if (pillEl) {
                pillEl.textContent = labelText;
                pillEl.classList.toggle('is-unnest', preview.action === 'unnest');
                pillEl.classList.toggle('is-root', preview.action === 'new-root');
              }

              if (guidesEl) {
                guidesEl.querySelectorAll('.nested-tree-snap-rail').forEach((rail) => {
                  const col = Number(rail.dataset.snapCol);
                  rail.classList.toggle('is-active', col === snappedDepthVal);
                });
              }
            };

            const activateDrag = () => {
              dragActive = true;
              flatItems = flattenNestedTree(topAncestor, curChildrenMap);
              liftState = removeDraggedNodeFromFlatList(flatItems, idStr, TREE_MAX_DEPTH);
              dragRect = row.getBoundingClientRect();
              currentSlotIndex = liftState.originalIndex >= 0 ? liftState.originalIndex : 0;

              listEl.classList.add('is-tree-dragging');

              // Snap rail guide lines across levels 0..MAX_DEPTH
              guidesEl = document.createElement('div');
              guidesEl.className = 'nested-tree-snap-guides';
              guidesEl.setAttribute('aria-hidden', 'true');
              const baseOffset = 14;
              for (let col = 0; col <= TREE_MAX_DEPTH; col++) {
                const rail = document.createElement('span');
                rail.className = 'nested-tree-snap-rail';
                rail.dataset.snapCol = String(col);
                rail.style.left = `${baseOffset + col * TREE_STEP_PX}px`;
                guidesEl.appendChild(rail);
              }
              listEl.prepend(guidesEl);

              // Map remaining rows in post-lift order and visually promote vacated descendants immediately
              const rowByMsgId = new Map();
              Array.from(listEl.querySelectorAll(':scope > .nested-tree-node')).forEach((r) => {
                if (r !== row && r.dataset.msgId) rowByMsgId.set(r.dataset.msgId, r);
              });
              remainingRows = liftState.remaining
                .map((it) => {
                  const r = rowByMsgId.get(String(it.id));
                  if (r) updateTagAndDepthOnRow(r, it.depth);
                  return r;
                })
                .filter(Boolean);

              // Insert gap placeholder right where dragged item lifted from
              placeholderEl = document.createElement('div');
              placeholderEl.className = 'nested-tree-drop-placeholder';
              placeholderEl.style.height = `${Math.max(46, Math.round(dragRect.height))}px`;
              if (currentSlotIndex >= remainingRows.length) {
                listEl.appendChild(placeholderEl);
              } else {
                listEl.insertBefore(placeholderEl, remainingRows[currentSlotIndex]);
              }

              // Lift dragged card into floating overlay attached smoothly near pointer
              row.style.position = 'fixed';
              row.style.left = `${Math.round(dragRect.left)}px`;
              row.style.top = `${Math.round(dragRect.top - 4)}px`;
              row.style.width = `${Math.round(dragRect.width)}px`;
              row.style.height = `${Math.round(dragRect.height)}px`;
              row.classList.add('is-dragged', 'is-floating-drag');

              pillEl = document.createElement('div');
              pillEl.className = 'nested-tree-drag-pill';
              row.appendChild(pillEl);

              const initRange = getValidDepthRangeAtSlot(liftState.remaining, currentSlotIndex, TREE_MAX_DEPTH);
              currentSnappedDepth = snapHorizontalDepth(liftState.draggedItem?.depth || depth, 0, TREE_STEP_PX, initRange);
              updateVisualFeedback(currentSlotIndex, currentSnappedDepth);
            };

            const runAutoScroll = () => {
              if (!dragActive || !this.bodyEl) return;
              const bodyRect = this.bodyEl.getBoundingClientRect();
              const edgeZone = 44;
              if (latestClientY < bodyRect.top + edgeZone) {
                this.bodyEl.scrollTop -= 8;
              } else if (latestClientY > bodyRect.bottom - edgeZone) {
                this.bodyEl.scrollTop += 8;
              }
              autoScrollRaf = requestAnimationFrame(runAutoScroll);
            };

            const onPointerMove = (ev) => {
              latestClientY = ev.clientY;
              const dx = ev.clientX - startX;
              const dy = ev.clientY - startY;

              if (!dragActive) {
                if (Math.hypot(dx, dy) < DRAG_ACTIVATION_PX) return;
                activateDrag();
                autoScrollRaf = requestAnimationFrame(runAutoScroll);
              }

              const floatTop = dragRect.top + dy - 4;
              const floatCenterY = floatTop + dragRect.height / 2;

              // Determine vertical insertion slot against remaining rows' midpoints
              let nextSlot = remainingRows.length;
              for (let j = 0; j < remainingRows.length; j++) {
                const rRect = remainingRows[j].getBoundingClientRect();
                const midY = rRect.top + rRect.height / 2;
                if (floatCenterY < midY) {
                  nextSlot = j;
                  break;
                }
              }

              if (nextSlot !== currentSlotIndex) {
                flipMovePlaceholder(nextSlot);
                currentSlotIndex = nextSlot;
              }

              const baseD = liftState.draggedItem?.depth || depth;
              const validRange = getValidDepthRangeAtSlot(liftState.remaining, currentSlotIndex, TREE_MAX_DEPTH);
              currentSnappedDepth = snapHorizontalDepth(baseD, dx, TREE_STEP_PX, validRange);

              // Magnetic horizontal snap feel toward discrete level stops
              const minDx = (validRange.minDepth - baseD) * TREE_STEP_PX - 14;
              const maxDx = (validRange.maxDepth - baseD) * TREE_STEP_PX + 14;
              const boundedDx = Math.max(minDx, Math.min(maxDx, dx));
              const snappedShiftX = (currentSnappedDepth - baseD) * TREE_STEP_PX;
              const blendedLeft = dragRect.left + boundedDx * 0.45 + snappedShiftX * 0.55;

              row.style.left = `${Math.round(blendedLeft)}px`;
              row.style.top = `${Math.round(floatTop)}px`;

              updateVisualFeedback(currentSlotIndex, currentSnappedDepth);
            };

            const cleanupDragDom = () => {
              if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
              autoScrollRaf = null;
              window.removeEventListener('pointermove', onPointerMove);
              window.removeEventListener('pointerup', onPointerUp);
              window.removeEventListener('pointercancel', onPointerUp);
              listEl.classList.remove('is-tree-dragging');
              guidesEl?.remove();
              placeholderEl?.remove();
              pillEl?.remove();
              remainingRows.forEach((r) => {
                r.style.transition = '';
                r.style.transform = '';
              });
              row.classList.remove('is-dragged', 'is-floating-drag');
              row.style.position = '';
              row.style.left = '';
              row.style.top = '';
              row.style.width = '';
              row.style.height = '';
            };

            const onPointerUp = async (ev) => {
              const wasActive = dragActive;
              const isCancel = ev.type === 'pointercancel';
              const finalSlot = currentSlotIndex;
              const finalDepth = currentSnappedDepth;
              const capturedFlat = flatItems;

              cleanupDragDom();

              if (!wasActive || isCancel || !capturedFlat) return;

              const result = applyTreeDragDrop(capturedFlat, idStr, finalSlot, finalDepth, TREE_MAX_DEPTH);
              if (!result || result.action === 'noop') {
                renderBody();
                return;
              }

              // Detect actual change in order, depth, parent, or unnest
              let changed = result.action === 'unnest' || result.orderedNodes.length !== capturedFlat.length;
              if (!changed) {
                for (let k = 0; k < result.orderedNodes.length; k++) {
                  const n = result.orderedNodes[k];
                  const orig = capturedFlat[k];
                  const origParentId = orig.msg?.nestedParent?.id ? String(orig.msg.nestedParent.id) : null;
                  if (n.id !== orig.id || n.depth !== orig.depth || n.newParentId !== origParentId) {
                    changed = true;
                    break;
                  }
                }
              }

              if (!changed) {
                renderBody();
                return;
              }

              if (typeof onCommitTreeChange === 'function') {
                await onCommitTreeChange(result);
                if (result.newRootId) {
                  anchorMsgId = String(result.newRootId);
                }
                renderBody();
                return;
              }

              // Legacy fallback if caller didn't pass onCommitTreeChange
              if (result.action === 'unnest') {
                await onUnlinkNested(msg);
              } else {
                const movedNode = result.orderedNodes.find((n) => n.id === idStr);
                const newParentObj = movedNode?.newParentId ? msgById.get(String(movedNode.newParentId)) : null;
                if (newParentObj) {
                  await onReparentNested(msg, newParentObj);
                }
              }
              renderBody();
            };

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
          });
        }

        row.querySelector('.indent-btn')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (siblingsArray && siblingIndex > 0) {
            const priorSibling = siblingsArray[siblingIndex - 1];
            if (priorSibling) {
              await onReparentNested(msg, priorSibling);
              renderBody();
            }
          }
        });

        row.querySelector('.outdent-btn')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (depth > 0 && msg.nestedParent?.id) {
            const curParent = msgById.get(String(msg.nestedParent.id));
            if (curParent?.nestedParent?.id) {
              const grandParent = msgById.get(String(curParent.nestedParent.id));
              if (grandParent) {
                await onReparentNested(msg, grandParent);
                renderBody();
                return;
              }
            }
            await onUnlinkNested(msg);
            renderBody();
          }
        });

        row.querySelector('.nested-tree-card')?.addEventListener('click', () => {
          this.close();
          onJumpToMessage(msg.id);
        });

        row.querySelector('.add-child')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close();
          onAddNestedChild(msg);
        });

        row.querySelector('.unlink-child')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          await onUnlinkNested(msg);
          renderBody();
        });

        listEl.appendChild(row);

        const children = curChildrenMap.get(idStr) || [];
        children.forEach((child, idx) => {
          appendNode(child, depth + 1, idx, children);
        });
      };

      appendNode(topAncestor, 0, 0, [topAncestor]);

      const titleEl = this.sheetEl.querySelector('#nested-tree-title');
      if (titleEl) {
        titleEl.textContent = `Nested Message Tree (${renderedCount})`;
      }

      if (renderedCount <= 1) {
        const emptyHint = document.createElement('div');
        emptyHint.className = 'nested-tree-empty-hint';
        emptyHint.textContent = 'No remaining nested messages in this tree.';
        listEl.appendChild(emptyHint);
      }

      this.bodyEl.appendChild(listEl);
    };

    renderBody();
    this.overlayEl.style.display = 'block';
    this.resizer.open(55);
  }

  close() {
    if (this.resizer) this.resizer.close();
  }

  destroy() {
    if (this.resizer) this.close();
    if (this.sheetEl?.parentNode) this.sheetEl.parentNode.removeChild(this.sheetEl);
    if (this.overlayEl?.parentNode) this.overlayEl.parentNode.removeChild(this.overlayEl);
  }
}
