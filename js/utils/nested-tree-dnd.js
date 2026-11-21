/**
 * Pure 2D Nested Tree Drag-and-Drop Engine & Chat Timeline Slot Mapper
 * - Supports lifting any node cleanly (promoting immediate children into the vacated slot)
 * - Supports horizontal snap stops (level indentation / outdentation with tree rebalancing)
 * - Supports vertical block reordering across siblings/subtrees (Slot 0 promotes to New Root; L0 below Root unnests)
 * - Maps reordered tree items back into deterministic (timestamp, seq) chat slots while preserving authentic displayTimestamp
 */

export function flattenNestedTree(topAncestor, nestedChildrenByParentId) {
  if (!topAncestor) return [];
  const flat = [];
  const visited = new Set();

  const walk = (msg, depth) => {
    const idStr = String(msg.id);
    if (visited.has(idStr)) return;
    visited.add(idStr);
    flat.push({ id: idStr, msg, depth });

    const children = nestedChildrenByParentId?.get?.(idStr) || [];
    for (const child of children) {
      walk(child, depth + 1);
    }
  };

  walk(topAncestor, 0);
  return flat;
}

export function removeDraggedNodeFromFlatList(flatItems, draggedId, maxDepth = 6) {
  if (!Array.isArray(flatItems) || flatItems.length === 0) {
    return { draggedItem: null, originalIndex: -1, remaining: [] };
  }

  const targetIdStr = String(draggedId);
  const idx = flatItems.findIndex((it) => String(it.id) === targetIdStr);
  if (idx === -1) {
    return {
      draggedItem: null,
      originalIndex: -1,
      remaining: flatItems.map((it) => ({ ...it }))
    };
  }

  const draggedItem = { ...flatItems[idx] };
  const d = draggedItem.depth;
  const remaining = [];

  if (idx === 0) {
    // Lifting Root (L0): first remaining node becomes provisional Root (L0) with its subtree promoted -1,
    // while other former L1 branches stay at L1 under the new provisional Root.
    const rest = flatItems.slice(1).map((it) => ({ ...it }));
    if (rest.length > 0) {
      const firstSubtreeBaseDepth = rest[0].depth;
      rest[0].depth = 0;
      let inFirstSubtree = true;
      for (let j = 1; j < rest.length; j++) {
        if (inFirstSubtree && rest[j].depth > firstSubtreeBaseDepth) {
          rest[j].depth = Math.max(1, rest[j].depth - 1);
        } else {
          inFirstSubtree = false;
          // Former L1 siblings stay at L1 under provisional root; deeper nodes keep relative nesting
        }
      }
    }
    remaining.push(...rest);
  } else {
    for (let i = 0; i < idx; i++) {
      remaining.push({ ...flatItems[i] });
    }
    // Contiguous direct descendants of draggedItem immediately after idx promote up by 1 level
    let inSubtree = true;
    for (let i = idx + 1; i < flatItems.length; i++) {
      const cur = { ...flatItems[i] };
      if (inSubtree && cur.depth > d) {
        cur.depth = Math.max(1, cur.depth - 1);
      } else {
        inSubtree = false;
      }
      remaining.push(cur);
    }
  }

  // Clamp depths so hierarchy is always structurally valid
  if (remaining.length > 0) {
    remaining[0].depth = 0;
    for (let j = 1; j < remaining.length; j++) {
      remaining[j].depth = Math.max(
        1,
        Math.min(maxDepth, remaining[j - 1].depth + 1, remaining[j].depth)
      );
    }
  }

  return { draggedItem, originalIndex: idx, remaining };
}

export function getValidDepthRangeAtSlot(remaining, slotIndex, maxDepth = 6) {
  if (!Array.isArray(remaining) || remaining.length === 0 || slotIndex <= 0) {
    return { minDepth: 0, maxDepth: 0, isNewRootSlot: true };
  }
  const prevIdx = Math.min(slotIndex, remaining.length) - 1;
  const prevDepth = remaining[prevIdx]?.depth || 0;
  return {
    minDepth: 0,
    maxDepth: Math.min(maxDepth, prevDepth + 1),
    isNewRootSlot: false
  };
}

export function snapHorizontalDepth(baseDepth, deltaX, stepPx = 24, validRange = { minDepth: 0, maxDepth: 6 }) {
  const step = stepPx > 0 ? stepPx : 24;
  const minD = validRange?.minDepth ?? 0;
  const maxD = validRange?.maxDepth ?? 6;
  const raw = Math.round((Number(baseDepth) || 0) + (Number(deltaX) || 0) / step);
  return Math.max(minD, Math.min(maxD, raw));
}

export function findParentPreviewAtSlot(remaining, slotIndex, targetDepth) {
  if (!Array.isArray(remaining) || slotIndex <= 0) {
    return { action: 'new-root', parentMsg: null, depth: 0 };
  }
  if (targetDepth <= 0) {
    return { action: 'unnest', parentMsg: null, depth: 0 };
  }
  const startIdx = Math.min(slotIndex, remaining.length) - 1;
  for (let i = startIdx; i >= 0; i--) {
    if (remaining[i].depth === targetDepth - 1) {
      return { action: 'nest', parentMsg: remaining[i].msg, depth: targetDepth };
    }
  }
  return { action: 'nest', parentMsg: remaining[0]?.msg || null, depth: 1 };
}

function rebalanceAndAssignParents(items, maxDepth = 6) {
  const res = items.map((it) => ({ ...it }));
  if (res.length === 0) return res;

  res[0].depth = 0;
  res[0].newParentId = null;

  for (let j = 1; j < res.length; j++) {
    res[j].depth = Math.max(
      1,
      Math.min(maxDepth, res[j - 1].depth + 1, res[j].depth)
    );
    let parentId = null;
    for (let p = j - 1; p >= 0; p--) {
      if (res[p].depth === res[j].depth - 1) {
        parentId = String(res[p].id);
        break;
      }
    }
    res[j].newParentId = parentId;
  }

  return res;
}

export function applyTreeDragDrop(flatItems, draggedId, targetSlotIndex, targetDepth, maxDepth = 6) {
  const { draggedItem, remaining } = removeDraggedNodeFromFlatList(flatItems, draggedId, maxDepth);
  if (!draggedItem) {
    return { action: 'noop', orderedNodes: [], unnestedNodes: [], newRootId: null };
  }

  const slot = Math.max(0, Math.min(remaining.length, Number(targetSlotIndex) || 0));

  // Case A: Promoted to Slot 0 (New Root above old Root)
  if (slot === 0) {
    const ordered = [
      { ...draggedItem, depth: 0 },
      ...remaining.map((it) => ({ ...it, depth: Math.min(maxDepth, it.depth + 1) }))
    ];
    const rebalanced = rebalanceAndAssignParents(ordered, maxDepth);
    return {
      action: 'new-root',
      orderedNodes: rebalanced,
      unnestedNodes: [],
      newRootId: rebalanced[0]?.id || null
    };
  }

  // Case B: Dragged to Level 0 below Root -> Unnest cleanly from tree
  if (targetDepth <= 0) {
    const rebalanced = rebalanceAndAssignParents(remaining, maxDepth);
    return {
      action: 'unnest',
      orderedNodes: rebalanced,
      unnestedNodes: [{ ...draggedItem, depth: 0, newParentId: null }],
      newRootId: rebalanced[0]?.id || null
    };
  }

  // Case C: Reordered and/or reparented at (slot, clampedDepth)
  const prevDepth = remaining[slot - 1].depth;
  const clampedDepth = Math.max(1, Math.min(maxDepth, prevDepth + 1, targetDepth));
  const merged = remaining.map((it) => ({ ...it }));
  merged.splice(slot, 0, { ...draggedItem, depth: clampedDepth });

  const rebalanced = rebalanceAndAssignParents(merged, maxDepth);
  return {
    action: 'reorder',
    orderedNodes: rebalanced,
    unnestedNodes: [],
    newRootId: rebalanced[0]?.id || null
  };
}

export function computeChatSlotReassignments(orderedMessages) {
  const valid = (orderedMessages || []).filter(Boolean);
  if (valid.length === 0) return [];

  const chronological = [...valid].sort((a, b) => {
    const ta = a.timestamp || 0;
    const tb = b.timestamp || 0;
    if (ta !== tb) return ta - tb;
    const sa = a.seq !== undefined && a.seq !== null ? a.seq : Number.MAX_SAFE_INTEGER;
    const sb = b.seq !== undefined && b.seq !== null ? b.seq : Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  const slots = [];
  for (let i = 0; i < chronological.length; i++) {
    const ts = chronological[i].timestamp || 0;
    let seqVal = (chronological[i].seq !== undefined && chronological[i].seq !== null)
      ? Number(chronological[i].seq)
      : 0;
    if (i > 0 && ts === slots[i - 1].timestamp && seqVal <= slots[i - 1].seq) {
      seqVal = slots[i - 1].seq + 1;
    }
    slots.push({ timestamp: ts, seq: seqVal });
  }

  return valid.map((msg, idx) => ({
    id: msg.id,
    timestamp: slots[idx].timestamp,
    seq: slots[idx].seq,
    displayTimestamp: msg.displayTimestamp ?? msg.timestamp
  }));
}
