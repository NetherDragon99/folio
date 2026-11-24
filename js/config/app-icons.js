// Folio Vector App Icons (12 New Themes) + 15 Classic Legacy Icons (with PNG counterparts for Android/iOS PWA)
import { assetUrl } from './base-path.js';

export const DEFAULT_APP_ICON_ID = 'folio-emerald';

export const APP_ICONS = [
  // --- 12 Folio Vector Icons (Default Collection) ---
  { id: 'folio-emerald', file: 'assets/icons/folio-icon-1.svg', pngFile: 'assets/icons/folio-icon-1.png', name: 'Classic Emerald', group: 'folio' },
  { id: 'folio-slate', file: 'assets/icons/folio-icon-2.svg', pngFile: 'assets/icons/folio-icon-2.png', name: 'Slate Stealth', group: 'folio' },
  { id: 'folio-cyber', file: 'assets/icons/folio-icon-3.svg', pngFile: 'assets/icons/folio-icon-3.png', name: 'Cyber Punch', group: 'folio' },
  { id: 'folio-sunset', file: 'assets/icons/folio-icon-4.svg', pngFile: 'assets/icons/folio-icon-4.png', name: 'Sunset Solar', group: 'folio' },
  { id: 'folio-glacier', file: 'assets/icons/folio-icon-5.svg', pngFile: 'assets/icons/folio-icon-5.png', name: 'Glacier Ice', group: 'folio' },
  { id: 'folio-oasis', file: 'assets/icons/folio-icon-6.svg', pngFile: 'assets/icons/folio-icon-6.png', name: 'Oasis Teal', group: 'folio' },
  { id: 'folio-velvet', file: 'assets/icons/folio-icon-7.svg', pngFile: 'assets/icons/folio-icon-7.png', name: 'Velvet Regal', group: 'folio' },
  { id: 'folio-steel', file: 'assets/icons/folio-icon-8.svg', pngFile: 'assets/icons/folio-icon-8.png', name: 'Steel Alloy', group: 'folio' },
  { id: 'folio-desert', file: 'assets/icons/folio-icon-9.svg', pngFile: 'assets/icons/folio-icon-9.png', name: 'Desert Rust', group: 'folio' },
  { id: 'folio-retro', file: 'assets/icons/folio-icon-10.svg', pngFile: 'assets/icons/folio-icon-10.png', name: 'Retro Pop', group: 'folio' },
  { id: 'folio-crimson', file: 'assets/icons/folio-icon-11.svg', pngFile: 'assets/icons/folio-icon-11.png', name: 'Crimson Carbon', group: 'folio' },
  { id: 'folio-neon', file: 'assets/icons/folio-icon-12.svg', pngFile: 'assets/icons/folio-icon-12.png', name: 'Neon Pulse', group: 'folio' },

  // --- 15 Classic Legacy Icons ---
  { id: 'icon-1', file: 'assets/icons/app-icon-1.svg', pngFile: 'assets/icons/app-icon-1.png', name: 'Classic Green', group: 'classic' },
  { id: 'icon-2', file: 'assets/icons/app-icon-2.svg', pngFile: 'assets/icons/app-icon-2.png', name: 'Solid Green', group: 'classic' },
  { id: 'icon-3', file: 'assets/icons/app-icon-3.svg', pngFile: 'assets/icons/app-icon-3.png', name: 'Sparkle Teal', group: 'classic' },
  { id: 'icon-4', file: 'assets/icons/app-icon-4.svg', pngFile: 'assets/icons/app-icon-4.png', name: 'Origami Emerald', group: 'classic' },
  { id: 'icon-5', file: 'assets/icons/app-icon-5.svg', pngFile: 'assets/icons/app-icon-5.png', name: 'Electric Blue', group: 'classic' },
  { id: 'icon-6', file: 'assets/icons/app-icon-6.svg', pngFile: 'assets/icons/app-icon-6.png', name: 'Neon Magma', group: 'classic' },
  { id: 'icon-7', file: 'assets/icons/app-icon-7.svg', pngFile: 'assets/icons/app-icon-7.png', name: 'Bubblegum Pink', group: 'classic' },
  { id: 'icon-8', file: 'assets/icons/app-icon-8.svg', pngFile: 'assets/icons/app-icon-8.png', name: 'Violet Fur', group: 'classic' },
  { id: 'icon-9', file: 'assets/icons/app-icon-9.svg', pngFile: 'assets/icons/app-icon-9.png', name: 'Sunset Glow', group: 'classic' },
  { id: 'icon-10', file: 'assets/icons/app-icon-10.svg', pngFile: 'assets/icons/app-icon-10.png', name: 'Soft Lilac', group: 'classic' },
  { id: 'icon-11', file: 'assets/icons/app-icon-11.svg', pngFile: 'assets/icons/app-icon-11.png', name: 'Sky Pastel', group: 'classic' },
  { id: 'icon-12', file: 'assets/icons/app-icon-12.svg', pngFile: 'assets/icons/app-icon-12.png', name: 'Peach Cream', group: 'classic' },
  { id: 'icon-13', file: 'assets/icons/app-icon-13.svg', pngFile: 'assets/icons/app-icon-13.png', name: 'Mint Matcha', group: 'classic' },
  { id: 'icon-14', file: 'assets/icons/app-icon-14.svg', pngFile: 'assets/icons/app-icon-14.png', name: 'Fresh White', group: 'classic' },
  { id: 'icon-15', file: 'assets/icons/app-icon-15.svg', pngFile: 'assets/icons/app-icon-15.png', name: 'Monochrome Dark', group: 'classic' }
];

export function getAppIcon(id) {
  if (!id) return APP_ICONS[0];
  return APP_ICONS.find((i) => i.id === id) || APP_ICONS[0];
}

let _activeManifestBlobUrl = null;

/**
 * Applies the selected app icon to document favicons, apple-touch-icon (PNG),
 * and PWA manifest (keeping static manifest.webmanifest for default icon so Android/Chrome
 * WebAPK installer & icon refresh work natively, and using real PNG icons for custom picks).
 */
export async function applyAppIcon(iconId) {
  const icon = getAppIcon(iconId);
  if (!icon) return;

  const verTag = encodeURIComponent(window.APP_VERSION || '3.0.1');
  const svgSrc = `${assetUrl(icon.file)}?v=${verTag}`;
  const pngSrc = `${assetUrl(icon.pngFile || icon.file)}?v=${verTag}`;

  // 1. Update favicons (SVG for crisp browser tab + PNG for raster fallbacks)
  const favicons = document.querySelectorAll("link[rel='icon'], link[rel='shortcut icon']");
  if (favicons.length > 0) {
    favicons.forEach((fav) => {
      if (fav.type === 'image/svg+xml') {
        fav.href = svgSrc;
      } else {
        fav.href = pngSrc;
        fav.type = 'image/png';
      }
    });
  } else {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = svgSrc;
    document.head.appendChild(link);
  }

  // 2. Update Apple Touch Icons (must be PNG for iOS/Safari & Android shortcuts)
  const appleIcons = document.querySelectorAll("link[rel='apple-touch-icon']");
  if (appleIcons.length > 0) {
    appleIcons.forEach((a) => {
      a.href = pngSrc;
    });
  } else {
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.href = pngSrc;
    document.head.appendChild(link);
  }

  // 3. Update Manifest — keep native static manifest.webmanifest for default icon (critical for Chrome WebAPK!)
  const linkManifest = document.querySelector("link[rel='manifest']");
  if (linkManifest) {
    if (icon.id === DEFAULT_APP_ICON_ID) {
      if (_activeManifestBlobUrl) {
        try { URL.revokeObjectURL(_activeManifestBlobUrl); } catch (_) {}
        _activeManifestBlobUrl = null;
      }
      linkManifest.href = `${assetUrl('manifest.webmanifest')}?v=${verTag}`;
    } else {
      try {
        const resp = await fetch(`${assetUrl('manifest.webmanifest')}?v=${verTag}`);
        if (resp.ok) {
          const manifest = await resp.json();
          const base = window.location.href;
          manifest.id = new URL('./', base).href;
          manifest.start_url = new URL(manifest.start_url || './index.html', base).href;
          manifest.scope = new URL(manifest.scope || './', base).href;
          const fullPngSrc = new URL(pngSrc, base).href;
          const fullSvgSrc = new URL(svgSrc, base).href;
          manifest.icons = [
            { src: fullPngSrc, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: fullPngSrc, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: fullPngSrc, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: fullSvgSrc, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
          ];
          if (_activeManifestBlobUrl) {
            try { URL.revokeObjectURL(_activeManifestBlobUrl); } catch (_) {}
          }
          const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
          _activeManifestBlobUrl = URL.createObjectURL(blob);
          linkManifest.href = _activeManifestBlobUrl;
        }
      } catch (e) {
        // silently ignore if manifest cannot be fetched (e.g. offline)
      }
    }
  }

  try {
    localStorage.setItem('wa_app_icon_id', icon.id);
  } catch (e) {}
}
