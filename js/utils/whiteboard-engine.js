/**
 * Infinite-Canvas Vector Whiteboard Scene Engine
 * - Vector/object scene model (4 brushes: pen/felt/marker/highlighter, 8 geometric shapes/arrows, text, downscaled images)
 * - Dynamic infinite canvas bounds extending at least +1 viewport in all 4 directions around content & camera
 * - Smooth camera zoom/pan coordinate transforms, hit testing, movement, and crisp bounding-box PNG export
 */

export const WHITEBOARD_BRUSHES = {
  pen: { id: 'pen', label: 'Thin Pen', defaultWidth: 3, min: 1, max: 8, opacity: 1, lineCap: 'round', lineJoin: 'round' },
  felt: { id: 'felt', label: 'Felt Tip', defaultWidth: 9, min: 5, max: 18, opacity: 1, lineCap: 'round', lineJoin: 'round' },
  marker: { id: 'marker', label: 'Wide Marker', defaultWidth: 20, min: 12, max: 36, opacity: 0.94, lineCap: 'square', lineJoin: 'miter' },
  highlighter: { id: 'highlighter', label: 'Highlighter', defaultWidth: 30, min: 16, max: 52, opacity: 0.34, lineCap: 'square', lineJoin: 'round' }
};

export const WHITEBOARD_SHAPES = [
  { id: 'arrow', label: 'Arrow' },
  { id: 'doubleArrow', label: 'Double Arrow' },
  { id: 'line', label: 'Line' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'circle', label: 'Circle' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'star', label: 'Star' }
];

export const WHITEBOARD_BG_PRESETS = [
  '#111b21', '#0b141a', '#1e293b', '#1b263b',
  '#ffffff', '#f8fafc', '#fef9c3', '#ecfdf5',
  '#0f172a', '#2d1b2e', '#1a2e25', '#27272a'
];

export const WHITEBOARD_INK_COLORS = [
  '#ffffff', '#111b21', '#25d366', '#53bdeb',
  '#ef4444', '#f59e0b', '#eab308', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#94a3b8'
];

let _uidCounter = 1;
export function nextWbId(prefix = 'obj') {
  return `${prefix}_${Date.now().toString(36)}_${(_uidCounter++).toString(36)}`;
}

export function createEmptyScene(backgroundColor = '#111b21') {
  return {
    version: 1,
    backgroundColor: backgroundColor || '#111b21',
    objects: [],
    camera: { x: 0, y: 0, zoom: 1 }
  };
}

export function cloneScene(scene) {
  if (!scene) return createEmptyScene();
  return JSON.parse(JSON.stringify(scene));
}

export function serializeScene(scene) {
  return JSON.stringify(scene || createEmptyScene());
}

export function deserializeScene(raw) {
  if (!raw) return createEmptyScene();
  if (typeof raw === 'object') {
    const base = createEmptyScene(raw.backgroundColor);
    return {
      version: 1,
      backgroundColor: raw.backgroundColor || base.backgroundColor,
      objects: Array.isArray(raw.objects) ? cloneScene(raw.objects) : [],
      camera: raw.camera ? { x: Number(raw.camera.x) || 0, y: Number(raw.camera.y) || 0, zoom: Math.max(0.2, Math.min(4.5, Number(raw.camera.zoom) || 1)) } : base.camera
    };
  }
  try {
    return deserializeScene(JSON.parse(raw));
  } catch (_) {
    return createEmptyScene();
  }
}

export function screenToWorld(sx, sy, camera) {
  const z = camera?.zoom || 1;
  return {
    x: (sx - (camera?.x || 0)) / z,
    y: (sy - (camera?.y || 0)) / z
  };
}

export function worldToScreen(wx, wy, camera) {
  const z = camera?.zoom || 1;
  return {
    x: wx * z + (camera?.x || 0),
    y: wy * z + (camera?.y || 0)
  };
}

export function zoomCameraAtPoint(camera, factor, pivotSx, pivotSy, minZoom = 0.2, maxZoom = 4.5) {
  const oldZoom = camera?.zoom || 1;
  const newZoom = Math.max(minZoom, Math.min(maxZoom, oldZoom * factor));
  const wx = (pivotSx - (camera?.x || 0)) / oldZoom;
  const wy = (pivotSy - (camera?.y || 0)) / oldZoom;
  return {
    x: pivotSx - wx * newZoom,
    y: pivotSy - wy * newZoom,
    zoom: newZoom
  };
}

export function getObjectBounds(obj) {
  if (!obj) return null;
  if (obj.type === 'stroke') {
    const pts = obj.points || [];
    if (pts.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
    const pad = (obj.width || 4) / 2 + 2;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }
  if (obj.type === 'shape') {
    const x1 = obj.x || 0;
    const y1 = obj.y || 0;
    const x2 = x1 + (obj.w || 0);
    const y2 = y1 + (obj.h || 0);
    const pad = (obj.strokeWidth || 3) + 6;
    return {
      minX: Math.min(x1, x2) - pad,
      minY: Math.min(y1, y2) - pad,
      maxX: Math.max(x1, x2) + pad,
      maxY: Math.max(y1, y2) + pad
    };
  }
  if (obj.type === 'image') {
    const x = obj.x || 0;
    const y = obj.y || 0;
    const w = obj.w || 200;
    const h = obj.h || 200;
    return { minX: Math.min(x, x + w), minY: Math.min(y, y + h), maxX: Math.max(x, x + w), maxY: Math.max(y, y + h) };
  }
  if (obj.type === 'text') {
    const lines = String(obj.text || '').split('\n');
    const fs = obj.fontSize || 24;
    const maxLineChars = Math.max(1, ...lines.map((l) => l.length));
    const estW = Math.max(40, maxLineChars * fs * 0.62);
    const estH = Math.max(fs * 1.3, lines.length * fs * 1.32);
    return { minX: (obj.x || 0) - 4, minY: (obj.y || 0) - 4, maxX: (obj.x || 0) + estW + 8, maxY: (obj.y || 0) + estH + 4 };
  }
  return null;
}

export function computeSceneBounds(scene, padding = 48) {
  const objects = scene?.objects || [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of objects) {
    const b = getObjectBounds(obj);
    if (!b) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 960, maxY: 640, width: 960, height: 640 };
  }
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;
  const width = Math.max(320, Math.ceil(maxX - minX));
  const height = Math.max(240, Math.ceil(maxY - minY));
  return { minX, minY, maxX: minX + width, maxY: minY + height, width, height };
}

/**
 * Dynamic infinite canvas bounds:
 * Always extends at least +1 full viewport width & height in all 4 directions
 * around BOTH existing scene content AND the active camera viewport, expanding automatically on pan/zoom!
 */
export function computeDynamicCanvasBounds(scene, camera, viewportW = 800, viewportH = 600) {
  const z = Math.max(0.2, camera?.zoom || 1);
  const viewWorldW = viewportW / z;
  const viewWorldH = viewportH / z;
  const viewMinX = -(camera?.x || 0) / z;
  const viewMinY = -(camera?.y || 0) / z;
  const viewMaxX = viewMinX + viewWorldW;
  const viewMaxY = viewMinY + viewWorldH;

  let minX = viewMinX - viewWorldW;
  let minY = viewMinY - viewWorldH;
  let maxX = viewMaxX + viewWorldW;
  let maxY = viewMaxY + viewWorldH;

  const objects = scene?.objects || [];
  if (objects.length > 0) {
    const content = computeSceneBounds(scene, 0);
    minX = Math.min(minX, content.minX - viewWorldW);
    minY = Math.min(minY, content.minY - viewWorldH);
    maxX = Math.max(maxX, content.maxX + viewWorldW);
    maxY = Math.max(maxY, content.maxY + viewWorldH);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTestObject(scene, wx, wy, tolerance = 12) {
  const objs = scene?.objects || [];
  for (let i = objs.length - 1; i >= 0; i--) {
    const obj = objs[i];
    const b = getObjectBounds(obj);
    if (!b) continue;
    if (wx < b.minX - tolerance || wx > b.maxX + tolerance || wy < b.minY - tolerance || wy > b.maxY + tolerance) {
      continue;
    }
    if (obj.type === 'stroke') {
      const pts = obj.points || [];
      const hitRad = Math.max(tolerance, (obj.width || 4) / 2 + 6);
      if (pts.length === 1) {
        if (Math.hypot(wx - pts[0][0], wy - pts[0][1]) <= hitRad) return i;
      } else {
        for (let k = 1; k < pts.length; k++) {
          if (pointToSegmentDist(wx, wy, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]) <= hitRad) {
            return i;
          }
        }
      }
      continue;
    }
    return i;
  }
  return -1;
}

export function moveObject(obj, dx, dy) {
  if (!obj) return;
  if (obj.type === 'stroke' && Array.isArray(obj.points)) {
    for (let i = 0; i < obj.points.length; i++) {
      obj.points[i] = [obj.points[i][0] + dx, obj.points[i][1] + dy];
    }
  } else {
    obj.x = (obj.x || 0) + dx;
    obj.y = (obj.y || 0) + dy;
  }
}

export function drawShapeObject(ctx, obj) {
  const x = obj.x || 0;
  const y = obj.y || 0;
  const w = obj.w || 0;
  const h = obj.h || 0;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.abs(w) / 2;
  const ry = Math.abs(h) / 2;

  ctx.save();
  ctx.strokeStyle = obj.color || '#ffffff';
  ctx.fillStyle = obj.fill || obj.color || '#ffffff';
  ctx.lineWidth = obj.strokeWidth || 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = obj.opacity ?? 1;

  const drawArrowHead = (fromX, fromY, toX, toY) => {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const headLen = Math.max(12, (obj.strokeWidth || 3) * 4);
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };

  ctx.beginPath();
  if (obj.kind === 'line' || obj.kind === 'arrow' || obj.kind === 'doubleArrow') {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y + h);
    ctx.stroke();
    if (obj.kind === 'arrow' || obj.kind === 'doubleArrow') {
      drawArrowHead(x, y, x + w, y + h);
    }
    if (obj.kind === 'doubleArrow') {
      drawArrowHead(x + w, y + h, x, y);
    }
    ctx.restore();
    return;
  }

  if (obj.kind === 'rect') {
    ctx.rect(x, y, w, h);
  } else if (obj.kind === 'circle') {
    ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  } else if (obj.kind === 'diamond') {
    ctx.moveTo(cx, y);
    ctx.lineTo(x + w, cy);
    ctx.lineTo(cx, y + h);
    ctx.lineTo(x, cy);
    ctx.closePath();
  } else if (obj.kind === 'triangle') {
    ctx.moveTo(cx, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  } else if (obj.kind === 'star') {
    const spikes = 5;
    const outerR = Math.max(4, Math.min(rx, ry));
    const innerR = outerR * 0.45;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const ang = (i * Math.PI) / spikes - Math.PI / 2;
      const px = cx + Math.cos(ang) * r;
      const py = cy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  if (obj.filled) {
    ctx.save();
    ctx.globalAlpha = (obj.opacity ?? 1) * 0.22;
    ctx.fill();
    ctx.restore();
  }
  ctx.stroke();
  ctx.restore();
}

export function renderSceneToContext(ctx, scene, {
  width,
  height,
  camera = { x: 0, y: 0, zoom: 1 },
  showGrid = false,
  selectedId = null,
  imageCache = new Map()
} = {}) {
  if (!ctx || !scene) return;
  ctx.save();
  ctx.fillStyle = scene.backgroundColor || '#111b21';
  ctx.fillRect(0, 0, width, height);

  const z = camera?.zoom || 1;
  const cx = camera?.x || 0;
  const cy = camera?.y || 0;

  if (showGrid) {
    const gridSpacing = 32 * z;
    if (gridSpacing >= 10) {
      const isLightBg = /^#([fFeEdDcC])/.test(scene.backgroundColor || '');
      ctx.fillStyle = isLightBg ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.11)';
      const startX = ((cx % gridSpacing) + gridSpacing) % gridSpacing;
      const startY = ((cy % gridSpacing) + gridSpacing) % gridSpacing;
      for (let gx = startX; gx < width; gx += gridSpacing) {
        for (let gy = startY; gy < height; gy += gridSpacing) {
          ctx.fillRect(gx - 1, gy - 1, 2, 2);
        }
      }
    }
  }

  ctx.translate(cx, cy);
  ctx.scale(z, z);

  for (const obj of scene.objects || []) {
    if (!obj) continue;
    if (obj.type === 'image') {
      const img = imageCache.get(obj.id);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, obj.x || 0, obj.y || 0, obj.w || 200, obj.h || 200);
      } else {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.strokeRect(obj.x || 0, obj.y || 0, obj.w || 200, obj.h || 200);
        ctx.restore();
      }
    } else if (obj.type === 'stroke') {
      const pts = obj.points || [];
      if (pts.length === 0) continue;
      const brush = WHITEBOARD_BRUSHES[obj.tool] || WHITEBOARD_BRUSHES.pen;
      ctx.save();
      ctx.strokeStyle = obj.color || '#ffffff';
      ctx.fillStyle = obj.color || '#ffffff';
      ctx.lineWidth = obj.width || brush.defaultWidth;
      ctx.lineCap = brush.lineCap;
      ctx.lineJoin = brush.lineJoin;
      ctx.globalAlpha = obj.opacity ?? brush.opacity;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], (ctx.lineWidth) / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i][0] + pts[i + 1][0]) / 2;
          const midY = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], midX, midY);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last[0], last[1]);
        ctx.stroke();
      }
      ctx.restore();
    } else if (obj.type === 'shape') {
      drawShapeObject(ctx, obj);
    } else if (obj.type === 'text') {
      ctx.save();
      const fs = obj.fontSize || 24;
      ctx.font = `${obj.fontWeight || 600} ${fs}px Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.fillStyle = obj.color || '#ffffff';
      ctx.textBaseline = 'top';
      const lines = String(obj.text || '').split('\n');
      lines.forEach((line, idx) => {
        ctx.fillText(line, obj.x || 0, (obj.y || 0) + idx * fs * 1.32);
      });
      ctx.restore();
    }

    if (selectedId && obj.id === selectedId) {
      const b = getObjectBounds(obj);
      if (b) {
        ctx.save();
        ctx.strokeStyle = '#53bdeb';
        ctx.lineWidth = 1.8 / z;
        ctx.setLineDash([6 / z, 4 / z]);
        ctx.strokeRect(b.minX - 4 / z, b.minY - 4 / z, (b.maxX - b.minX) + 8 / z, (b.maxY - b.minY) + 8 / z);
        ctx.restore();
      }
    }
  }

  ctx.restore();
}

export async function preloadSceneImages(scene, imageCache = new Map()) {
  const promises = [];
  for (const obj of scene?.objects || []) {
    if (obj && obj.type === 'image' && obj.dataUrl && !imageCache.has(obj.id)) {
      promises.push(new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { imageCache.set(obj.id, img); resolve(); };
        img.onerror = () => resolve();
        img.src = obj.dataUrl;
      }));
    }
  }
  await Promise.all(promises);
  return imageCache;
}

export async function exportSceneToBlob(scene, { maxEdge = 2048, padding = 48, dpr = 2 } = {}) {
  const bounds = computeSceneBounds(scene, padding);
  const scale = Math.min(dpr, maxEdge / Math.max(bounds.width, bounds.height, 1));
  const outW = Math.max(1, Math.round(bounds.width * scale));
  const outH = Math.max(1, Math.round(bounds.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');

  const imageCache = await preloadSceneImages(scene);
  renderSceneToContext(ctx, scene, {
    width: outW,
    height: outH,
    camera: { x: -bounds.minX * scale, y: -bounds.minY * scale, zoom: scale },
    showGrid: false,
    imageCache
  });

  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });
  return { blob, width: outW, height: outH, bounds };
}

/**
 * Downscales a device image to board-optimized quality (<= 960px max edge, JPEG/WebP 0.82)
 * to keep whiteboard memory & storage footprint fast and lightweight.
 */
export async function downscaleImageFileToBoardDataUrl(fileOrBlob, maxDim = 960, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round((img.naturalWidth || 300) * ratio));
        const h = Math.max(1, Math.round((img.naturalHeight || 300) * ratio));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = c.toDataURL('image/jpeg', quality);
        URL.revokeObjectURL(url);
        resolve({ dataUrl, width: w, height: h });
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}
