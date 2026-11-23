/**
 * Pure Chat Message Reorder & Contiguous Nested-Tree Insertion Engine
 * - Expands selected message IDs to include connected nested descendants (preserving tree integrity)
 * - Reorders 1 or more selected messages to any target slot while preserving authentic displayTimestamp
 * - Auto-reorders newly nested messages into their exact contiguous subtree slot under their parent
 */
import { computeChatSlotReassignments } from './nested-tree-dnd.js';

/**
 * Expands a set/array of selected message IDs to automatically include all nested descendants
 * of any selected parent message so trees stay cohesive when moved in chat.
 */
export function expandSelectionWithNestedSubtrees(allMessages, selectedIds, nestedChildrenByParentId = null) {
  const expanded = new Set((Array.isArray(selectedIds) ? selectedIds : Array.from(selectedIds || [])).map(String));
  if (expanded.size === 0 || !Array.isArray(allMessages)) return expanded;

  let childrenMap = nestedChildrenByParentId;
  if (!childrenMap || typeof childrenMap.get !== 'function') {
    childrenMap = new Map();
    for (const m of allMessages) {
      if (m && m.nestedParent && m.nestedParent.id) {
        const pid = String(m.nestedParent.id);
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid).push(m);
      }
    }
  }

  const queue = Array.from(expanded);
  while (queue.length > 0) {
    const curId = queue.shift();
    const children = childrenMap.get(curId) || [];
    for (const ch of children) {
      const chId = String(ch.id);
      if (!expanded.has(chId)) {
        expanded.add(chId);
        queue.push(chId);
      }
    }
  }

  return expanded;
}

/**
 * Computes minimal affected-range slot reassignments to move all messages in `movedIdsSet`
 * (preserving their relative order) to `targetSlotIndex` inside the remaining list.
 * Every message preserves its authentic `displayTimestamp`.
 */
export function buildReorderedMessagesList(allMessages, movedIdsSet, targetSlotIndex) {
  const list = Array.isArray(allMessages) ? allMessages.filter(Boolean) : [];
  const movedSet = new Set((movedIdsSet instanceof Set ? Array.from(movedIdsSet) : (movedIdsSet || [])).map(String));
  if (list.length === 0 || movedSet.size === 0) {
    return { reordered: [...list], updates: [], changed: false };
  }

  const moved = [];
  const remaining = [];
  for (const m of list) {
    if (movedSet.has(String(m.id))) {
      moved.push(m);
    } else {
      remaining.push(m);
    }
  }

  if (moved.length === 0) {
    return { reordered: [...list], updates: [], changed: false };
  }

  const clampedSlot = Math.max(0, Math.min(remaining.length, Number(targetSlotIndex) || 0));
  const reordered = [
    ...remaining.slice(0, clampedSlot),
    ...moved,
    ...remaining.slice(clampedSlot)
  ];

  // Check if order actually changed
  let firstDiff = -1;
  let lastDiff = -1;
  for (let i = 0; i < reordered.length; i++) {
    if (String(reordered[i].id) !== String(list[i].id)) {
      if (firstDiff === -1) firstDiff = i;
      lastDiff = i;
    }
  }

  if (firstDiff === -1) {
    return { reordered, updates: [], changed: false };
  }

  const affectedSlice = reordered.slice(firstDiff, lastDiff + 1);
  const slotAssignments = computeChatSlotReassignments(affectedSlice);
  const assignById = new Map(slotAssignments.map((s) => [String(s.id), s]));

  const updates = [];
  for (let i = firstDiff; i <= lastDiff; i++) {
    const m = reordered[i];
    const slot = assignById.get(String(m.id));
    if (!slot) continue;
    updates.push({
      id: m.id,
      timestamp: slot.timestamp,
      seq: slot.seq,
      displayTimestamp: m.displayTimestamp ?? m.timestamp
    });
  }

  return { reordered, updates, changed: updates.length > 0 };
}

/**
 * Automatically moves newly nested message(s) (along with any of their existing descendants)
 * right after the parent's existing contiguous subtree in `allMessages` so every nested tree
 * is ALWAYS contiguous in the chat.
 */
export function computeContiguousNestInsert(allMessages, parentId, childIds, nestedChildrenByParentId = null) {
  const list = Array.isArray(allMessages) ? allMessages.filter(Boolean) : [];
  const parentIdStr = String(parentId || '');
  if (!parentIdStr || list.length === 0) {
    return { reordered: [...list], updates: [], changed: false };
  }

  const movedSet = expandSelectionWithNestedSubtrees(list, childIds, nestedChildrenByParentId);
  movedSet.delete(parentIdStr);
  if (movedSet.size === 0) {
    return { reordered: [...list], updates: [], changed: false };
  }

  // Remaining list excluding moved messages
  const remaining = list.filter((m) => !movedSet.has(String(m.id)));
  const parentIdx = remaining.findIndex((m) => String(m.id) === parentIdStr);
  if (parentIdx === -1) {
    return { reordered: [...list], updates: [], changed: false };
  }

  // Collect all existing descendants of parentId in `remaining`
  const parentSubtreeSet = expandSelectionWithNestedSubtrees(remaining, [parentIdStr]);
  let insertAfterIdx = parentIdx;
  for (let i = parentIdx + 1; i < remaining.length; i++) {
    if (parentSubtreeSet.has(String(remaining[i].id))) {
      insertAfterIdx = i;
    } else {
      break;
    }
  }

  return buildReorderedMessagesList(list, movedSet, insertAfterIdx + 1);
}
