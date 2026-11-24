/**
 * Folio v3.0.0 Rich Feature Showcase Demo Generator
 * Appends a 100% offline showcase (editable vector whiteboard, Word-style wrapped inline media,
 * rich formatting with RTL/LTR & fold blocks, collapsible multi-level nested tree, standalone lists,
 * pins, reactions & replies) right onto any loaded demo chat.
 */
import { db } from '../db.js';
import { createEmptyScene, exportSceneToBlob, nextWbId } from './whiteboard-engine.js';
import { VoiceRecorder } from '../components/voice-recorder.js';

function createDemoWhiteboardScene() {
  const scene = createEmptyScene('#131f33');
  scene.objects.push(
    {
      id: nextWbId('sh'),
      type: 'shape',
      kind: 'rect',
      color: '#34d689',
      strokeWidth: 4,
      filled: true,
      x: 40,
      y: 60,
      w: 220,
      h: 96
    },
    {
      id: nextWbId('txt'),
      type: 'text',
      color: '#f3f5f8',
      fontSize: 24,
      fontWeight: 700,
      x: 68,
      y: 94,
      text: 'Folio v3.0 Ideas'
    },
    {
      id: nextWbId('sh'),
      type: 'shape',
      kind: 'arrow',
      color: '#53bdeb',
      strokeWidth: 4,
      x: 272,
      y: 108,
      w: 96,
      h: 0
    },
    {
      id: nextWbId('sh'),
      type: 'shape',
      kind: 'diamond',
      color: '#f59e0b',
      strokeWidth: 4,
      filled: true,
      x: 380,
      y: 44,
      w: 160,
      h: 128
    },
    {
      id: nextWbId('txt'),
      type: 'text',
      color: '#ffffff',
      fontSize: 20,
      fontWeight: 700,
      x: 422,
      y: 96,
      text: 'Review'
    },
    {
      id: nextWbId('sh'),
      type: 'shape',
      kind: 'arrow',
      color: '#53bdeb',
      strokeWidth: 4,
      x: 552,
      y: 108,
      w: 92,
      h: 0
    },
    {
      id: nextWbId('sh'),
      type: 'shape',
      kind: 'circle',
      color: '#a855f7',
      strokeWidth: 4,
      filled: true,
      x: 656,
      y: 52,
      w: 144,
      h: 112
    },
    {
      id: nextWbId('txt'),
      type: 'text',
      color: '#ffffff',
      fontSize: 22,
      fontWeight: 700,
      x: 686,
      y: 94,
      text: 'Ship!'
    },
    {
      id: nextWbId('st'),
      type: 'stroke',
      tool: 'highlighter',
      color: '#eab308',
      width: 28,
      opacity: 0.34,
      points: [[56, 214], [240, 212], [430, 215], [640, 212], [780, 214]]
    },
    {
      id: nextWbId('txt'),
      type: 'text',
      color: '#e9edef',
      fontSize: 20,
      fontWeight: 600,
      x: 62,
      y: 202,
      text: 'Editable Infinite Canvas — Tap Edit to draw, move shapes, or zoom!'
    }
  );
  return scene;
}

async function createDemoGraphicBlob() {
  try {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      if (c && typeof c.getContext === 'function') {
        c.width = 640;
        c.height = 420;
        const ctx = c.getContext('2d');
        if (ctx) {
          const bg = ctx.createLinearGradient(0, 0, 640, 420);
          bg.addColorStop(0, '#0f1c2e');
          bg.addColorStop(1, '#133a34');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, 640, 420);

          // Decorative layered Folio card motif
          ctx.fillStyle = '#1b8753';
          ctx.fillRect(190, 96, 170, 186);
          ctx.fillStyle = '#34d689';
          ctx.fillRect(154, 68, 170, 186);
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(294, 98, 14, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#f3f5f8';
          ctx.font = 'bold 42px system-ui, -apple-system, sans-serif';
          ctx.fillText('FOLIO', 390, 165);
          ctx.fillStyle = '#86efac';
          ctx.font = '600 22px system-ui, -apple-system, sans-serif';
          ctx.fillText('v3.0.0 Workspace', 390, 206);
          ctx.fillStyle = 'rgba(255,255,255,0.72)';
          ctx.font = '500 18px system-ui, -apple-system, sans-serif';
          ctx.fillText('Resize • Fit/Fill • Word Wrap', 164, 344);

          const blob = await new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
          if (blob) return blob;
        }
      }
    }
  } catch (_) {}
  const svgFallback = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="#131f33"/><rect x="170" y="90" width="160" height="175" rx="28" fill="#1b8753"/><rect x="136" y="64" width="160" height="175" rx="28" fill="#34d689"/><text x="340" y="170" fill="#f3f5f8" font-size="44" font-family="sans-serif" font-weight="700">FOLIO 3.0</text></svg>`;
  return new Blob([svgFallback], { type: 'image/svg+xml' });
}

function createDemoVoiceBlob() {
  const sampleRate = 16000;
  const durationSec = 2.2;
  const len = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(len);
  const notes = [440, 554.37, 659.25];
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const env = Math.sin(Math.min(1, t / 0.15) * (Math.PI / 2)) * Math.max(0, 1 - t / durationSec);
    let sum = 0;
    for (const f of notes) sum += Math.sin(2 * Math.PI * f * t);
    samples[i] = (sum / notes.length) * 0.28 * env;
  }
  return VoiceRecorder.encodeWavFromFloat32(samples, sampleRate);
}

/**
 * Generates and saves the Folio v3.0.0 Feature Showcase messages + local media blobs
 * directly into IndexedDB, returning the appended messages array.
 */
export async function appendFolioShowcaseToChat({
  chatId,
  chatName = 'Folio Demo',
  baseMessages = []
} = {}) {
  if (!chatId) return [];

  const lastExisting = baseMessages.length > 0 ? baseMessages[baseMessages.length - 1] : null;
  const baseTs = Math.max(Date.now() - 120000, (lastExisting?.timestamp || Date.now() - 120000) + 60000);
  const stepMs = 4500;
  let seqCursor = (lastExisting?.seq || 0) + 10;
  const nextTs = (idx) => baseTs + idx * stepMs;

  // 1. Create offline local Blobs for Whiteboard, Inline Photo, Inline Voice Note & Inline File
  const wbScene = createDemoWhiteboardScene();
  let wbBlob = null;
  try {
    if (typeof document !== 'undefined') {
      const exported = await exportSceneToBlob(wbScene, { maxEdge: 1400, padding: 40, dpr: 1.5 });
      wbBlob = exported?.blob || null;
    }
  } catch (_) {}
  if (!wbBlob) {
    wbBlob = await createDemoGraphicBlob();
  }

  const graphicBlob = await createDemoGraphicBlob();
  const voiceBlob = createDemoVoiceBlob();
  const docText = [
    '# Folio v3.0.0 Release Notes',
    '',
    '- Complete rebranding to Folio with 12 vector app icons',
    '- Editable Infinite-Canvas Vector Whiteboard',
    '- Word-style WYSIWYG resizable & wrappable inline media (Fit / Fill)',
    '- Collapsible multi-level nested trees with zero leftover scroll space',
    '- Smooth desktop & mobile drag-to-reorder in Selection Mode'
  ].join('\n');
  const docBlob = new Blob([docText], { type: 'text/markdown' });

  const wbMediaId = db.generateUUID();
  const graphicMediaId = db.generateUUID();
  const voiceMediaId = db.generateUUID();
  const docMediaId = db.generateUUID();

  await db.saveMedia({
    id: wbMediaId,
    chatId,
    filename: 'Folio-Roadmap-Board.png',
    mimeType: wbBlob.type || 'image/png',
    size: wbBlob.size,
    blob: wbBlob,
    isWhiteboard: true,
    whiteboardData: wbScene,
    timestamp: nextTs(2)
  });

  await db.saveMedia({
    id: graphicMediaId,
    chatId,
    filename: 'Folio-Preview-Card.png',
    mimeType: graphicBlob.type || 'image/png',
    size: graphicBlob.size,
    blob: graphicBlob,
    timestamp: nextTs(1)
  });

  await db.saveMedia({
    id: voiceMediaId,
    chatId,
    filename: 'Folio-Voice-Demo.wav',
    mimeType: 'audio/wav',
    size: voiceBlob.size,
    duration: 2.2,
    blob: voiceBlob,
    timestamp: nextTs(1)
  });

  await db.saveMedia({
    id: docMediaId,
    chatId,
    filename: 'Folio-v3.0-Release-Notes.md',
    mimeType: 'text/markdown',
    size: docBlob.size,
    blob: docBlob,
    timestamp: nextTs(1)
  });

  // 2. Build showcase messages covering EVERY new Folio v3.0.0 feature
  const idPrefix = `folio_demo_${Date.now().toString(36)}`;
  const msgRichId = `${idPrefix}_1_rich`;
  const msgWrapId = `${idPrefix}_2_wrap`;
  const msgWbId = `${idPrefix}_3_wb`;
  const msgTreeRootId = `${idPrefix}_4_root`;
  const msgTreeC1Id = `${idPrefix}_5_c1`;
  const msgTreeGC1Id = `${idPrefix}_6_gc1`;
  const msgTreeC2Id = `${idPrefix}_7_c2`;
  const msgList1Id = `${idPrefix}_8_l1`;
  const msgList2Id = `${idPrefix}_9_l2`;
  const msgList3Id = `${idPrefix}_10_l3`;

  const listGroupId = `list_demo_${Date.now().toString(36)}`;

  const richTextBody = [
    '{align:center|dir:rtl} # مرحباً بك في *Folio v3.0.0* ✨',
    '{align:right|dir:rtl} يدعم المحاذاة الكاملة (يمين / وسط / شمال) واتجاه الكتابة RTL و LTR لكل سطر.',
    '## Rich Text & Interactive Formatting',
    '*Bold*, _Italic_, ++Underline++, ~Strike~, `inline_code`, E = mc^^2^^, H,,2,,O & ||Tap to reveal hidden spoiler||',
    'Highlights: ==Yellow== · ==g:Green== · ==b:Blue== · ==p:Pink== · ==o:Orange== · ==v:Violet==',
    '[x] Interactive checklist item (tap to toggle without Edited tag)',
    '[ ] Try Note Mode in Contact Info or Settings',
    '- Thick bullet shape',
    '-> Arrow bullet shape',
    '↳ Branch arrow shape',
    '[fold:📂 Tap to expand Folio v3.0.0 Highlights]',
    '1. 12 new Folio vector app icons (Classic Emerald default)',
    '2. Editable infinite-canvas Whiteboard & Word-style wrapped media',
    '3. Smooth drag-to-reorder on both desktop mouse & mobile touch',
    '[/fold]',
    '```',
    'const app = { name: "Folio", version: "3.0.0" };',
    '```'
  ].join('\n');

  const wrapMediaBody = [
    '### Word-Style Inline Media & Wrapping',
    `[embed:image:${graphicMediaId}:left:w46:h150:cover|Folio Preview.png]`,
    'Text, lists, and blocks wrap naturally beside any *Left* or *Right* inline media card! Tap *Edit* on this message to drag its resize handles into any square or rectangle, toggle *Fit / Fill*, or drag it smoothly around text.',
    '- Flows smoothly alongside floated photos',
    '-> Works with whiteboards, audio & files too',
    `[embed:file:${docMediaId}:right:w48|Folio-v3.0-Release-Notes.md]`,
    'You can even place a floated file card on the opposite side while keeping the middle and lower text completely readable!',
    `[embed:audio:${voiceMediaId}:full|Folio Voice Demo (0:02)]`
  ].join('\n');

  const showcaseMessages = [
    {
      id: msgRichId,
      chatId,
      sender: 'You',
      isOutgoing: true,
      timestamp: nextTs(0),
      seq: seqCursor++,
      text: richTextBody,
      reaction: '✨'
    },
    {
      id: msgWrapId,
      chatId,
      sender: 'You',
      isOutgoing: true,
      timestamp: nextTs(1),
      seq: seqCursor++,
      text: wrapMediaBody
    },
    {
      id: msgWbId,
      chatId,
      sender: 'You',
      isOutgoing: true,
      timestamp: nextTs(2),
      seq: seqCursor++,
      mediaId: wbMediaId,
      mediaType: 'image',
      mediaName: 'Folio-Roadmap-Board.png',
      isWhiteboard: true,
      whiteboardData: wbScene,
      text: '🎨 *Editable Infinite-Canvas Whiteboard* — Tap the **Edit** badge to draw with 4 brushes, insert shapes/images, or pan & zoom!',
      isStarred: true,
      reaction: '🎨'
    },
    {
      id: msgTreeRootId,
      chatId,
      sender: 'You',
      isOutgoing: true,
      timestamp: nextTs(3),
      seq: seqCursor++,
      text: '📌 *Collapsible Nested Tree* — Tap this message body to collapse or expand all nested messages underneath!',
      isPinned: true
    },
    {
      id: msgTreeC1Id,
      chatId,
      sender: 'You',
      isOutgoing: true,
      timestamp: nextTs(4),
      seq: seqCursor++,
      text: 'Level 1 Child: Brand refresh to *Folio* + 12 vector icon themes.',
      nestedParent: { id: msgTreeRootId, sender: 'You', text: '📌 Collapsible Nested Tree' }
    },
    {
      id: msgTreeGC1Id,
      chatId,
      sender: chatName,
      isOutgoing: false,
      timestamp: nextTs(5),
      seq: seqCursor++,
      text: 'Level 2 Grandchild (incoming side): Continuous SVG spine connects across sides seamlessly!',
      nestedParent: { id: msgTreeC1Id, sender: 'You', text: 'Level 1 Child' }
    },
    {
      id: msgTreeC2Id,
      chatId,
      sender: 'You',
      isOutgoing: true,
      timestamp: nextTs(6),
      seq: seqCursor++,
      text: 'Level 1 Sibling: Collapse & delete clean up scroll height with zero empty space.',
      nestedParent: { id: msgTreeRootId, sender: 'You', text: '📌 Collapsible Nested Tree' }
    },
    {
      id: msgList1Id,
      chatId,
      sender: 'You',
      isOutgoing: true,
      timestamp: nextTs(7),
      seq: seqCursor++,
      text: 'Try *Select messages* from the ⋮ menu and hold-drag to reorder messages on desktop or mobile.',
      listMeta: { groupId: listGroupId, style: 'ordered' }
    },
    {
      id: msgList2Id,
      chatId,
      sender: 'You',
      isOutgoing: true,
      timestamp: nextTs(8),
      seq: seqCursor++,
      text: 'Tap the *Call* icon in the header to view calls filtered for this chat.',
      listMeta: { groupId: listGroupId, style: 'ordered' }
    },
    {
      id: msgList3Id,
      chatId,
      sender: chatName,
      isOutgoing: false,
      timestamp: nextTs(9),
      seq: seqCursor++,
      text: 'Everything works 100% offline with persistent storage backup!',
      listMeta: { groupId: listGroupId, style: 'ordered' },
      replyTo: {
        id: msgWbId,
        sender: 'You',
        text: 'Editable Infinite-Canvas Whiteboard',
        mediaType: 'image',
        mediaId: wbMediaId,
        mediaName: 'Folio-Roadmap-Board.png'
      }
    }
  ];

  await db.saveMessages(showcaseMessages);

  // Pin the tree root showcase message so the pinned bar is demonstrated immediately too
  try {
    if (typeof db.savePinsForChat === 'function') {
      const existingPins = (typeof db.getPinsForChat === 'function') ? (await db.getPinsForChat(chatId) || []) : [];
      if (!existingPins.some((p) => String(p.messageId) === msgTreeRootId)) {
        await db.savePinsForChat(chatId, [
          ...existingPins,
          { messageId: msgTreeRootId, pinnedAt: Date.now(), expiresAt: null }
        ]);
      }
    }
  } catch (_) {}

  return showcaseMessages;
}
