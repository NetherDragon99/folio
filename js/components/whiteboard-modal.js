/**
 * Full-Screen Interactive Infinite-Canvas Vector Whiteboard Modal ("الصبورة")
 * - Dynamic infinite canvas (+1 viewport margin in all 4 directions, auto-expanding on pan/zoom)
 * - 4 Brushes (Thin Pen, Thick Felt-Tip/Fomaster, Wide Marker, Translucent Highlighter)
 * - Geometric Shapes & Arrows (Arrow, Double Arrow, Line, Rect, Circle, Diamond, Triangle, Star + Filled toggle)
 * - Direct Canvas Text placement + Downscaled Image insertion (board quality <= 960px)
 * - Silky 60fps Pinch-to-Zoom, 2-Finger Pan, Wheel Zoom, Object Select/Move/Delete, Eraser, Undo/Redo, BG Color Picker
 * - Supports both creating new whiteboards and re-opening existing messages for in-place editing
 */
import { Icons } from '../icons.js';
import {
  WHITEBOARD_BRUSHES,
  WHITEBOARD_SHAPES,
  WHITEBOARD_BG_PRESETS,
  WHITEBOARD_INK_COLORS,
  nextWbId,
  createEmptyScene,
  cloneScene,
  deserializeScene,
  screenToWorld,
  zoomCameraAtPoint,
  computeSceneBounds,
  computeDynamicCanvasBounds,
  hitTestObject,
  moveObject,
  renderSceneToContext,
  preloadSceneImages,
  exportSceneToBlob,
  downscaleImageFileToBoardDataUrl
} from '../utils/whiteboard-engine.js';
import { Toast } from './toast.js';

export class WhiteboardModal {
  constructor() {
    this.overlay = null;
    this.canvas = null;
    this.ctx = null;
    this.scene = createEmptyScene();
    this.imageCache = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.activeTool = 'pen'; // 'select' | 'hand' | 'pen' | 'felt' | 'marker' | 'highlighter' | 'eraser' | 'shape' | 'text'
    this.activeShape = 'arrow';
    this.shapeFilled = false;
    this.activeColor = '#ffffff';
    this.activeWidth = 3;
    this.activeFontSize = 24;
    this.selectedObjectId = null;
    this.draftObject = null;
    this._rafId = null;
    this._needsRender = true;
    this._onDone = null;
    this._isEditing = false;
    this._pointers = new Map();
    this._pinchPrevDist = null;
    this._pinchPrevMid = null;
    this._dragState = null;
    this._resizeObserver = null;
    this._keyHandler = null;
  }

  open({ initialScene = null, isEditing = false, onDone = () => {} } = {}) {
    this.close(false);
    this._onDone = onDone;
    this._isEditing = Boolean(isEditing);
    this.scene = initialScene ? deserializeScene(initialScene) : createEmptyScene('#111b21');
    this.imageCache = new Map();
    this.undoStack = [cloneScene(this.scene)];
    this.redoStack = [];
    this.selectedObjectId = null;
    this.draftObject = null;
    this.activeTool = 'pen';
    this.activeWidth = WHITEBOARD_BRUSHES.pen.defaultWidth;
    this.activeColor = /^#([fFeEdD])/.test(this.scene.backgroundColor || '') ? '#111b21' : '#ffffff';

    this._buildDom();
    preloadSceneImages(this.scene, this.imageCache).then(() => {
      this._requestRender();
    });

    window.router?.pushOverlay('whiteboard-modal', () => this.close(false));
  }

  _buildDom() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'whiteboard-modal-overlay';
    this.overlay.innerHTML = `
      <header class="wb-topbar">
        <div class="wb-top-left">
          <button type="button" class="wb-icon-btn" id="wb-btn-close" aria-label="Close whiteboard">${Icons.arrowBack('', 22)}</button>
          <span class="wb-title">${this._isEditing ? 'Edit Whiteboard' : 'Whiteboard'}</span>
        </div>
        <div class="wb-top-center">
          <button type="button" class="wb-icon-btn" id="wb-btn-undo" title="Undo">${Icons.undo('', 20)}</button>
          <button type="button" class="wb-icon-btn" id="wb-btn-redo" title="Redo">${Icons.redo('', 20)}</button>
          <button type="button" class="wb-zoom-pill" id="wb-btn-zoom-reset" title="Reset zoom & fit">100%</button>
          <button type="button" class="wb-bg-btn" id="wb-btn-bg" title="Board background color">
            <span class="wb-bg-swatch" id="wb-bg-swatch" style="background:${this.scene.backgroundColor};"></span>
          </button>
        </div>
        <div class="wb-top-right">
          <button type="button" class="wb-send-btn" id="wb-btn-send">
            ${this._isEditing ? 'Save' : 'Send'}
            ${Icons.send('', 18)}
          </button>
        </div>
      </header>

      <div class="wb-stage" id="wb-stage">
        <canvas class="wb-canvas" id="wb-canvas"></canvas>
        <div class="wb-popover" id="wb-popover" style="display:none;"></div>
        <div class="wb-selection-bar" id="wb-selection-bar" style="display:none;">
          <button type="button" class="wb-sel-btn" id="wb-sel-scale-down" title="Smaller">A-</button>
          <button type="button" class="wb-sel-btn" id="wb-sel-scale-up" title="Larger">A+</button>
          <button type="button" class="wb-sel-btn danger" id="wb-sel-delete" title="Delete selected">${Icons.trash('', 16)}</button>
        </div>
      </div>

      <footer class="wb-bottombar">
        <div class="wb-color-strip" id="wb-color-strip">
          ${WHITEBOARD_INK_COLORS.map((hex) => `
            <button type="button" class="wb-ink-dot ${hex === this.activeColor ? 'active' : ''}" data-ink="${hex}" style="background:${hex};" aria-label="Color ${hex}"></button>
          `).join('')}
          <label class="wb-ink-custom" title="Custom color">
            <span>+</span>
            <input type="color" id="wb-custom-ink" value="${this.activeColor}" style="display:none;" />
          </label>
          <div class="wb-width-wrap">
            <input type="range" id="wb-width-slider" min="1" max="52" value="${this.activeWidth}" aria-label="Stroke width" />
          </div>
        </div>

        <div class="wb-tools-row" id="wb-tools-row">
          <button type="button" class="wb-tool-btn active" data-tool="pen" title="Thin Pen"><span>✎</span><small>Pen</small></button>
          <button type="button" class="wb-tool-btn" data-tool="felt" title="Felt-Tip Fomaster"><span>🖊</span><small>Felt</small></button>
          <button type="button" class="wb-tool-btn" data-tool="marker" title="Wide Marker"><span>🖍</span><small>Marker</small></button>
          <button type="button" class="wb-tool-btn" data-tool="highlighter" title="Highlighter">${Icons.highlight('', 18)}<small>Hi-Lite</small></button>
          <button type="button" class="wb-tool-btn" data-tool="shape" title="Shapes & Arrows">${Icons.shapes('', 18)}<small>Shapes</small></button>
          <button type="button" class="wb-tool-btn" data-tool="text" title="Add Text"><span style="font-weight:700;font-size:17px;">T</span><small>Text</small></button>
          <button type="button" class="wb-tool-btn" data-tool="image" title="Add Image">${Icons.gallery('', 18)}<small>Image</small></button>
          <button type="button" class="wb-tool-btn" data-tool="eraser" title="Eraser">${Icons.eraser('', 18)}<small>Erase</small></button>
          <button type="button" class="wb-tool-btn" data-tool="select" title="Select & Move"><span>↖</span><small>Move</small></button>
          <button type="button" class="wb-tool-btn" data-tool="hand" title="Pan Canvas">${Icons.handPan('', 18)}<small>Pan</small></button>
        </div>
        <input type="file" id="wb-image-file-input" accept="image/*" style="display:none;" />
      </footer>
    `;

    document.body.appendChild(this.overlay);
    this.canvas = this.overlay.querySelector('#wb-canvas');
    this.ctx = this.canvas.getContext('2d');

    this._resizeCanvas();
    this._bindEvents();
    this._startLoop();
  }

  _resizeCanvas() {
    if (!this.canvas || !this.overlay) return;
    const stage = this.overlay.querySelector('#wb-stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this._viewW = Math.max(1, Math.round(rect.width));
    this._viewH = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this._viewW * dpr);
    this.canvas.height = Math.round(this._viewH * dpr);
    this.canvas.style.width = `${this._viewW}px`;
    this.canvas.style.height = `${this._viewH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._requestRender();
  }

  _pushUndo() {
    this.undoStack.push(cloneScene(this.scene));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this._syncHistoryButtons();
  }

  _syncHistoryButtons() {
    const uBtn = this.overlay?.querySelector('#wb-btn-undo');
    const rBtn = this.overlay?.querySelector('#wb-btn-redo');
    if (uBtn) uBtn.disabled = this.undoStack.length <= 1;
    if (rBtn) rBtn.disabled = this.redoStack.length === 0;
  }

  _syncZoomBadge() {
    const pill = this.overlay?.querySelector('#wb-btn-zoom-reset');
    if (pill) {
      pill.textContent = `${Math.round((this.scene.camera?.zoom || 1) * 100)}%`;
    }
  }

  _syncSelectionBar() {
    const bar = this.overlay?.querySelector('#wb-selection-bar');
    if (bar) {
      bar.style.display = this.selectedObjectId ? 'flex' : 'none';
    }
  }

  _requestRender() {
    this._needsRender = true;
  }

  _startLoop() {
    const tick = () => {
      if (!this.overlay) return;
      if (this._needsRender && this.ctx) {
        this._needsRender = false;
        // Dynamically track infinite canvas bounds (+1 viewport buffer in every direction)
        this._dynamicBounds = computeDynamicCanvasBounds(this.scene, this.scene.camera, this._viewW || 800, this._viewH || 600);
        const renderScene = this.draftObject
          ? { ...this.scene, objects: [...this.scene.objects, this.draftObject] }
          : this.scene;
        renderSceneToContext(this.ctx, renderScene, {
          width: this._viewW || 800,
          height: this._viewH || 600,
          camera: this.scene.camera,
          showGrid: true,
          selectedId: this.selectedObjectId,
          imageCache: this.imageCache
        });
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _openPopover(html) {
    const pop = this.overlay?.querySelector('#wb-popover');
    if (!pop) return;
    pop.innerHTML = html;
    pop.style.display = 'block';
  }

  _closePopover() {
    const pop = this.overlay?.querySelector('#wb-popover');
    if (pop) pop.style.display = 'none';
  }

  _openInlineTextBox(sx, sy, wx, wy) {
    const stage = this.overlay?.querySelector('#wb-stage');
    if (!stage) return;
    stage.querySelector('.wb-inline-text-editor')?.remove();

    const ta = document.createElement('textarea');
    ta.className = 'wb-inline-text-editor';
    ta.placeholder = 'Type text...';
    ta.dir = 'auto';
    ta.style.left = `${Math.max(12, Math.min(this._viewW - 180, sx))}px`;
    ta.style.top = `${Math.max(12, Math.min(this._viewH - 60, sy))}px`;
    ta.style.color = this.activeColor;
    ta.style.fontSize = `${Math.max(14, Math.round(this.activeFontSize * (this.scene.camera?.zoom || 1)))}px`;
    stage.appendChild(ta);

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const val = ta.value.trim();
      ta.remove();
      if (val) {
        const obj = {
          id: nextWbId('txt'),
          type: 'text',
          x: wx,
          y: wy,
          text: val,
          color: this.activeColor,
          fontSize: this.activeFontSize,
          fontWeight: 600
        };
        this.scene.objects.push(obj);
        this.selectedObjectId = obj.id;
        this._pushUndo();
        this._syncSelectionBar();
        this._requestRender();
      }
    };

    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        committed = true;
        ta.remove();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commit();
      }
    });
    setTimeout(() => ta.focus(), 10);
  }

  _bindEvents() {
    const closeBtn = this.overlay.querySelector('#wb-btn-close');
    const undoBtn = this.overlay.querySelector('#wb-btn-undo');
    const redoBtn = this.overlay.querySelector('#wb-btn-redo');
    const zoomBtn = this.overlay.querySelector('#wb-btn-zoom-reset');
    const bgBtn = this.overlay.querySelector('#wb-btn-bg');
    const sendBtn = this.overlay.querySelector('#wb-btn-send');
    const widthSlider = this.overlay.querySelector('#wb-width-slider');
    const customInk = this.overlay.querySelector('#wb-custom-ink');
    const imgInput = this.overlay.querySelector('#wb-image-file-input');

    closeBtn.addEventListener('click', () => this.close(true));

    undoBtn.addEventListener('click', () => {
      if (this.undoStack.length <= 1) return;
      this.redoStack.push(this.undoStack.pop());
      this.scene = cloneScene(this.undoStack[this.undoStack.length - 1]);
      this.selectedObjectId = null;
      this._syncSelectionBar();
      this._syncHistoryButtons();
      this._syncZoomBadge();
      const sw = this.overlay.querySelector('#wb-bg-swatch');
      if (sw) sw.style.background = this.scene.backgroundColor;
      this._requestRender();
    });

    redoBtn.addEventListener('click', () => {
      if (this.redoStack.length === 0) return;
      const next = this.redoStack.pop();
      this.undoStack.push(cloneScene(next));
      this.scene = cloneScene(next);
      this.selectedObjectId = null;
      this._syncSelectionBar();
      this._syncHistoryButtons();
      this._syncZoomBadge();
      const sw = this.overlay.querySelector('#wb-bg-swatch');
      if (sw) sw.style.background = this.scene.backgroundColor;
      this._requestRender();
    });

    zoomBtn.addEventListener('click', () => {
      if (this.scene.objects.length > 0) {
        const b = computeSceneBounds(this.scene, 40);
        const fitZoom = Math.min(1.5, Math.max(0.25, Math.min((this._viewW - 40) / b.width, (this._viewH - 40) / b.height)));
        this.scene.camera = {
          x: (this._viewW - b.width * fitZoom) / 2 - b.minX * fitZoom,
          y: (this._viewH - b.height * fitZoom) / 2 - b.minY * fitZoom,
          zoom: fitZoom
        };
      } else {
        this.scene.camera = { x: 0, y: 0, zoom: 1 };
      }
      this._syncZoomBadge();
      this._requestRender();
    });

    bgBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = this.overlay.querySelector('#wb-popover');
      if (pop.style.display !== 'none' && pop.dataset.kind === 'bg') {
        this._closePopover();
        return;
      }
      pop.dataset.kind = 'bg';
      this._openPopover(`
        <div class="wb-pop-title">Board Color (لون السبورة)</div>
        <div class="wb-pop-swatches">
          ${WHITEBOARD_BG_PRESETS.map((hex) => `
            <button type="button" class="wb-bg-opt ${hex === this.scene.backgroundColor ? 'active' : ''}" data-bg="${hex}" style="background:${hex};"></button>
          `).join('')}
          <label class="wb-bg-opt custom" title="Custom board color">+
            <input type="color" id="wb-custom-bg" value="${this.scene.backgroundColor}" style="display:none;" />
          </label>
        </div>
      `);
      pop.querySelectorAll('.wb-bg-opt[data-bg]').forEach((b) => {
        b.addEventListener('click', () => {
          this.scene.backgroundColor = b.dataset.bg;
          this.overlay.querySelector('#wb-bg-swatch').style.background = this.scene.backgroundColor;
          this._pushUndo();
          this._requestRender();
          this._closePopover();
        });
      });
      pop.querySelector('#wb-custom-bg')?.addEventListener('input', (ev) => {
        this.scene.backgroundColor = ev.target.value;
        this.overlay.querySelector('#wb-bg-swatch').style.background = this.scene.backgroundColor;
        this._requestRender();
      });
      pop.querySelector('#wb-custom-bg')?.addEventListener('change', () => {
        this._pushUndo();
        this._closePopover();
      });
    });

    // Ink colors
    this.overlay.querySelectorAll('.wb-ink-dot[data-ink]').forEach((dot) => {
      dot.addEventListener('click', () => {
        this.activeColor = dot.dataset.ink;
        this.overlay.querySelectorAll('.wb-ink-dot').forEach((d) => d.classList.toggle('active', d === dot));
        if (this.selectedObjectId) {
          const obj = this.scene.objects.find((o) => o.id === this.selectedObjectId);
          if (obj && obj.type !== 'image') {
            obj.color = this.activeColor;
            this._pushUndo();
            this._requestRender();
          }
        }
      });
    });

    customInk.addEventListener('input', (e) => {
      this.activeColor = e.target.value;
      this.overlay.querySelectorAll('.wb-ink-dot').forEach((d) => d.classList.remove('active'));
    });

    widthSlider.addEventListener('input', (e) => {
      this.activeWidth = Number(e.target.value) || 3;
      if (this.activeTool === 'text') {
        this.activeFontSize = Math.max(14, Math.min(64, this.activeWidth + 14));
      }
    });

    // Tool buttons
    this.overlay.querySelectorAll('.wb-tool-btn[data-tool]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tool = btn.dataset.tool;
        if (tool === 'image') {
          this._closePopover();
          imgInput.click();
          return;
        }
        if (tool === 'shape') {
          this.activeTool = 'shape';
          this._highlightActiveTool('shape');
          const pop = this.overlay.querySelector('#wb-popover');
          if (pop.style.display !== 'none' && pop.dataset.kind === 'shape') {
            this._closePopover();
            return;
          }
          pop.dataset.kind = 'shape';
          this._openPopover(`
            <div class="wb-pop-title">Shapes & Arrows (الأشكال الهندسية والأسهم)</div>
            <div class="wb-shape-grid">
              ${WHITEBOARD_SHAPES.map((s) => `
                <button type="button" class="wb-shape-opt ${s.id === this.activeShape ? 'active' : ''}" data-shape="${s.id}">${s.label}</button>
              `).join('')}
            </div>
            <label class="wb-shape-fill-row">
              <input type="checkbox" id="wb-shape-filled" ${this.shapeFilled ? 'checked' : ''} />
              <span>Soft fill (تعبئة خفيفة)</span>
            </label>
          `);
          pop.querySelectorAll('.wb-shape-opt[data-shape]').forEach((sb) => {
            sb.addEventListener('click', () => {
              this.activeShape = sb.dataset.shape;
              this._closePopover();
            });
          });
          pop.querySelector('#wb-shape-filled')?.addEventListener('change', (ev) => {
            this.shapeFilled = ev.target.checked;
          });
          return;
        }

        this._closePopover();
        this.activeTool = tool;
        this._highlightActiveTool(tool);
        if (WHITEBOARD_BRUSHES[tool]) {
          this.activeWidth = WHITEBOARD_BRUSHES[tool].defaultWidth;
          widthSlider.value = String(this.activeWidth);
        }
        if (tool !== 'select') {
          this.selectedObjectId = null;
          this._syncSelectionBar();
          this._requestRender();
        }
      });
    });

    // Image insert (auto-downscaled to board quality <= 960px)
    imgInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      imgInput.value = '';
      if (!file) return;
      try {
        const { dataUrl, width, height } = await downscaleImageFileToBoardDataUrl(file, 960, 0.82);
        const centerWorld = screenToWorld((this._viewW || 600) / 2, (this._viewH || 500) / 2, this.scene.camera);
        const displayScale = Math.min(1, 360 / Math.max(width, height, 1));
        const w = Math.round(width * displayScale);
        const h = Math.round(height * displayScale);
        const obj = {
          id: nextWbId('img'),
          type: 'image',
          x: centerWorld.x - w / 2,
          y: centerWorld.y - h / 2,
          w,
          h,
          dataUrl
        };
        this.scene.objects.push(obj);
        await preloadSceneImages(this.scene, this.imageCache);
        this.activeTool = 'select';
        this._highlightActiveTool('select');
        this.selectedObjectId = obj.id;
        this._pushUndo();
        this._syncSelectionBar();
        this._requestRender();
      } catch (err) {
        console.error('[Whiteboard] Image insert failed:', err);
        Toast.show('Could not insert image');
      }
    });

    // Selection actions (scale / delete)
    this.overlay.querySelector('#wb-sel-delete').addEventListener('click', () => {
      if (!this.selectedObjectId) return;
      this.scene.objects = this.scene.objects.filter((o) => o.id !== this.selectedObjectId);
      this.selectedObjectId = null;
      this._pushUndo();
      this._syncSelectionBar();
      this._requestRender();
    });
    const scaleSelected = (factor) => {
      const obj = this.scene.objects.find((o) => o.id === this.selectedObjectId);
      if (!obj) return;
      if (obj.type === 'text') {
        obj.fontSize = Math.max(12, Math.min(96, Math.round((obj.fontSize || 24) * factor)));
      } else if (obj.type === 'image' || obj.type === 'shape') {
        obj.w = Math.round((obj.w || 100) * factor);
        obj.h = Math.round((obj.h || 100) * factor);
      }
      this._pushUndo();
      this._requestRender();
    };
    this.overlay.querySelector('#wb-sel-scale-up').addEventListener('click', () => scaleSelected(1.18));
    this.overlay.querySelector('#wb-sel-scale-down').addEventListener('click', () => scaleSelected(0.84));

    // Send / Save
    sendBtn.addEventListener('click', async () => {
      if (this.scene.objects.length === 0) {
        Toast.show('Draw or add something to the whiteboard first');
        return;
      }
      sendBtn.disabled = true;
      try {
        const exported = await exportSceneToBlob(this.scene, { maxEdge: 2048, padding: 48, dpr: 2 });
        const sceneCopy = cloneScene(this.scene);
        const doneCb = this._onDone;
        this.close(true);
        if (typeof doneCb === 'function') {
          await doneCb({
            blob: exported.blob,
            whiteboardData: sceneCopy,
            width: exported.width,
            height: exported.height
          });
        }
      } catch (err) {
        console.error('[Whiteboard] Export failed:', err);
        Toast.show('Failed to export whiteboard');
        sendBtn.disabled = false;
      }
    });

    // Canvas wheel zoom anchored at cursor
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.scene.camera = zoomCameraAtPoint(this.scene.camera, factor, sx, sy, 0.2, 4.5);
      this._syncZoomBadge();
      this._requestRender();
    }, { passive: false });

    // Multi-touch pinch-to-zoom, 2-finger pan, and single-pointer drawing/shapes/select/erase
    this.canvas.addEventListener('pointerdown', (e) => {
      this._closePopover();
      this.canvas.setPointerCapture(e.pointerId);
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      this._pointers.set(e.pointerId, { sx, sy });

      // 2-finger pinch / pan takes priority immediately!
      if (this._pointers.size === 2) {
        this.draftObject = null;
        this._dragState = null;
        const pts = Array.from(this._pointers.values());
        this._pinchPrevDist = Math.hypot(pts[1].sx - pts[0].sx, pts[1].sy - pts[0].sy);
        this._pinchPrevMid = { x: (pts[0].sx + pts[1].sx) / 2, y: (pts[0].sy + pts[1].sy) / 2 };
        this._requestRender();
        return;
      }
      if (this._pointers.size > 2) return;

      const world = screenToWorld(sx, sy, this.scene.camera);

      if (this.activeTool === 'hand' || e.button === 1) {
        this._dragState = { mode: 'pan', lastSx: sx, lastSy: sy };
        return;
      }

      if (this.activeTool === 'text') {
        this._openInlineTextBox(sx, sy, world.x, world.y);
        return;
      }

      if (this.activeTool === 'eraser') {
        this._dragState = { mode: 'erase', erasedAny: false };
        this._eraseAt(world.x, world.y);
        return;
      }

      if (this.activeTool === 'select') {
        const hitIdx = hitTestObject(this.scene, world.x, world.y, 12 / (this.scene.camera?.zoom || 1));
        if (hitIdx !== -1) {
          this.selectedObjectId = this.scene.objects[hitIdx].id;
          this._dragState = { mode: 'move-obj', objIndex: hitIdx, lastWx: world.x, lastWy: world.y, moved: false };
        } else {
          this.selectedObjectId = null;
          this._dragState = { mode: 'pan', lastSx: sx, lastSy: sy };
        }
        this._syncSelectionBar();
        this._requestRender();
        return;
      }

      if (this.activeTool === 'shape') {
        this.draftObject = {
          id: nextWbId('shp'),
          type: 'shape',
          kind: this.activeShape,
          x: world.x,
          y: world.y,
          w: 0,
          h: 0,
          color: this.activeColor,
          strokeWidth: Math.max(2, Math.min(18, this.activeWidth)),
          filled: this.shapeFilled
        };
        this._dragState = { mode: 'shape', startWx: world.x, startWy: world.y };
        this._requestRender();
        return;
      }

      if (WHITEBOARD_BRUSHES[this.activeTool]) {
        const brush = WHITEBOARD_BRUSHES[this.activeTool];
        this.draftObject = {
          id: nextWbId('str'),
          type: 'stroke',
          tool: this.activeTool,
          color: this.activeColor,
          width: this.activeWidth,
          opacity: brush.opacity,
          points: [[world.x, world.y]]
        };
        this._dragState = { mode: 'stroke' };
        this._requestRender();
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      this._pointers.set(e.pointerId, { sx, sy });

      if (this._pointers.size === 2 && this._pinchPrevDist && this._pinchPrevMid) {
        const pts = Array.from(this._pointers.values());
        const dist = Math.hypot(pts[1].sx - pts[0].sx, pts[1].sy - pts[0].sy);
        const mid = { x: (pts[0].sx + pts[1].sx) / 2, y: (pts[0].sy + pts[1].sy) / 2 };

        // Pan first by midpoint delta
        this.scene.camera.x += mid.x - this._pinchPrevMid.x;
        this.scene.camera.y += mid.y - this._pinchPrevMid.y;
        // Then pinch zoom anchored at midpoint
        if (this._pinchPrevDist > 10 && dist > 10) {
          this.scene.camera = zoomCameraAtPoint(this.scene.camera, dist / this._pinchPrevDist, mid.x, mid.y, 0.2, 4.5);
        }
        this._pinchPrevDist = dist;
        this._pinchPrevMid = mid;
        this._syncZoomBadge();
        this._requestRender();
        return;
      }

      if (!this._dragState) return;
      const world = screenToWorld(sx, sy, this.scene.camera);

      if (this._dragState.mode === 'pan') {
        this.scene.camera.x += sx - this._dragState.lastSx;
        this.scene.camera.y += sy - this._dragState.lastSy;
        this._dragState.lastSx = sx;
        this._dragState.lastSy = sy;
        this._requestRender();
      } else if (this._dragState.mode === 'stroke' && this.draftObject) {
        const pts = this.draftObject.points;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(world.x - last[0], world.y - last[1]) >= 1.5 / (this.scene.camera?.zoom || 1)) {
          pts.push([world.x, world.y]);
          this._requestRender();
        }
      } else if (this._dragState.mode === 'shape' && this.draftObject) {
        this.draftObject.w = world.x - this._dragState.startWx;
        this.draftObject.h = world.y - this._dragState.startWy;
        this._requestRender();
      } else if (this._dragState.mode === 'move-obj') {
        const obj = this.scene.objects[this._dragState.objIndex];
        if (obj) {
          const dx = world.x - this._dragState.lastWx;
          const dy = world.y - this._dragState.lastWy;
          if (Math.hypot(dx, dy) > 0.2) {
            moveObject(obj, dx, dy);
            this._dragState.lastWx = world.x;
            this._dragState.lastWy = world.y;
            this._dragState.moved = true;
            this._requestRender();
          }
        }
      } else if (this._dragState.mode === 'erase') {
        this._eraseAt(world.x, world.y);
      }
    });

    const finishPointer = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) {
        this._pinchPrevDist = null;
        this._pinchPrevMid = null;
      }
      if (!this._dragState) return;
      const st = this._dragState;
      this._dragState = null;

      if (st.mode === 'stroke' && this.draftObject) {
        this.scene.objects.push(this.draftObject);
        this.draftObject = null;
        this._pushUndo();
        this._requestRender();
      } else if (st.mode === 'shape' && this.draftObject) {
        if (Math.hypot(this.draftObject.w, this.draftObject.h) > 4) {
          this.scene.objects.push(this.draftObject);
          this._pushUndo();
        }
        this.draftObject = null;
        this._requestRender();
      } else if (st.mode === 'move-obj' && st.moved) {
        this._pushUndo();
      } else if (st.mode === 'erase' && st.erasedAny) {
        this._pushUndo();
      }
    };

    this.canvas.addEventListener('pointerup', finishPointer);
    this.canvas.addEventListener('pointercancel', finishPointer);

    // Resize handling
    this._onResize = () => this._resizeCanvas();
    window.addEventListener('resize', this._onResize);

    // Keyboard shortcuts (Ctrl+Z / Ctrl+Y / Delete)
    this._keyHandler = (e) => {
      if (!this.overlay) return;
      if (document.activeElement?.classList?.contains('wb-inline-text-editor')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoBtn.click();
        else undoBtn.click();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoBtn.click();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedObjectId) {
        e.preventDefault();
        this.overlay.querySelector('#wb-sel-delete')?.click();
      }
    };
    document.addEventListener('keydown', this._keyHandler);

    this._syncHistoryButtons();
    this._syncZoomBadge();
  }

  _eraseAt(wx, wy) {
    const idx = hitTestObject(this.scene, wx, wy, 14 / (this.scene.camera?.zoom || 1));
    if (idx !== -1) {
      const removed = this.scene.objects.splice(idx, 1)[0];
      if (removed && removed.id === this.selectedObjectId) {
        this.selectedObjectId = null;
        this._syncSelectionBar();
      }
      if (this._dragState) this._dragState.erasedAny = true;
      this._requestRender();
    }
  }

  _highlightActiveTool(tool) {
    this.overlay?.querySelectorAll('.wb-tool-btn[data-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
  }

  close(notifyRouter = true) {
    if (notifyRouter && window.router) {
      window.router.removeOverlay('whiteboard-modal');
    }
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.canvas = null;
    this.ctx = null;
    this._pointers.clear();
    this._dragState = null;
  }
}

export const whiteboardModal = new WhiteboardModal();
