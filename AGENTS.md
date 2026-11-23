# Project Engineering Rules

## Mandatory Release & Commit Workflow (Every Completed Task)

At the end of every task in this repository:

1. **Bump Patch Version (`x.x.old+1`)**:
   - Read the current version from `version.json` and increment the patch number (`x.x.<old + 1>`).
   - Update the version consistently across all four files:
     - `version.json` (`"version"` and `"cacheName": "wa-clone-v..."`)
     - `sw.js` (`APP_VERSION` and `CACHE_NAME`)
     - `js/app.js` (`window.APP_VERSION` and `window.APP_CACHE_NAME`)
     - `js/views/settings-view.js` (fallback strings `window.APP_VERSION || '...'`)
2. **Update Service Worker App Shell (`sw.js`)**:
   - Register every newly added `.js`, `.css`, or asset file required offline inside `APP_SHELL_FILES`.
3. **Verify Before Committing**:
   - Run `node --check` on every new or modified JS file.
   - Run the automated Node verification test suite and ensure 100% pass rate.
4. **Local Commit Only (No Push)**:
   - Stage changes and create a descriptive local `git commit`.
   - **Never** run `git push` unless the user explicitly asks to push.

## Global Theme Accent & Dark/Light Mode Invariant

Every UI component, control, icon, badge, chip, switch, FAB, selection highlight, and link in this application MUST obey the user's selected App Theme Colour across both Dark and Light modes:

1. **Never Hardcode WhatsApp Green**:
   - Do **not** hardcode `#25d366`, `#00a884`, `#1dab61`, `#0a332c`, `#d8fdd2`, `rgba(37, 211, 102, ...)`, `rgba(0, 168, 132, ...)`, or `rgba(29, 171, 97, ...)` in CSS or inline JS styles (except inside `js/config/palette.js` default fallbacks or color swatch definitions).
2. **Always Use Derived Theme Tokens**:
   - Primary accent fill/stroke/text: `var(--app-accent)` (or `var(--wa-green)`, kept synced with `--app-accent`)
   - Translucent accent surfaces/shadows/rings: `rgba(var(--app-accent-rgb), <alpha>)`
   - Contrast-safe text/icon on solid accent backgrounds: `var(--app-accent-fg)`
   - Soft tinted backgrounds (active tabs, chips, selection rows): `var(--app-accent-soft)` / `var(--wa-green-active-chip)`
   - Accent hover & border states: `var(--app-accent-hover)`, `var(--app-accent-border)`
3. **Dark & Light Mode Re-Derivation**:
   - Whenever Dark/Light mode (`data-theme`) changes or the app initializes, re-run `applyAppAccent(savedAccent)` so lightness, saturation, soft tints, and foreground contrast adapt automatically while keeping per-chat bubble themes (`Chat Theme`) independent.

## Unified Fluid Drag-and-Drop Reorder Pattern Invariant

Any reorderable list, block, tree node, selected chat messages, or inline embedded elements in this application MUST follow the same unified fluid drag-and-drop interaction:

1. **Smooth Lift & Detach**: Pressing/holding lifts the dragged item(s) out of document flow into a clean floating preview near the pointer while leaving a live drop-gap placeholder.
2. **Live Neighbor Reaction & Edge Auto-Scroll**: Non-dragged neighbors animate smoothly via FLIP transforms (`180–220ms cubic-bezier(0.2, 0.9, 0.3, 1)`) to close the vacated gap and open landing space under the pointer, with smooth edge auto-scrolling inside scrollable containers.
3. **Smooth Settle / Landing**: Releasing glides the floating preview cleanly into the drop slot before committing the persisted order.
