// Folio Vector App Icons (12 New Themes) + 15 Classic Legacy Icons
import { assetUrl } from './base-path.js';

export const DEFAULT_APP_ICON_ID = 'folio-emerald';

export const APP_ICONS = [
  // --- 12 Folio Vector Icons (Default Collection) ---
  { id: 'folio-emerald', file: 'assets/icons/folio-icon-1.svg', name: 'Classic Emerald', group: 'folio' },
  { id: 'folio-slate', file: 'assets/icons/folio-icon-2.svg', name: 'Slate Stealth', group: 'folio' },
  { id: 'folio-cyber', file: 'assets/icons/folio-icon-3.svg', name: 'Cyber Punch', group: 'folio' },
  { id: 'folio-sunset', file: 'assets/icons/folio-icon-4.svg', name: 'Sunset Solar', group: 'folio' },
  { id: 'folio-glacier', file: 'assets/icons/folio-icon-5.svg', name: 'Glacier Ice', group: 'folio' },
  { id: 'folio-oasis', file: 'assets/icons/folio-icon-6.svg', name: 'Oasis Teal', group: 'folio' },
  { id: 'folio-velvet', file: 'assets/icons/folio-icon-7.svg', name: 'Velvet Regal', group: 'folio' },
  { id: 'folio-steel', file: 'assets/icons/folio-icon-8.svg', name: 'Steel Alloy', group: 'folio' },
  { id: 'folio-desert', file: 'assets/icons/folio-icon-9.svg', name: 'Desert Rust', group: 'folio' },
  { id: 'folio-retro', file: 'assets/icons/folio-icon-10.svg', name: 'Retro Pop', group: 'folio' },
  { id: 'folio-crimson', file: 'assets/icons/folio-icon-11.svg', name: 'Crimson Carbon', group: 'folio' },
  { id: 'folio-neon', file: 'assets/icons/folio-icon-12.svg', name: 'Neon Pulse', group: 'folio' },

  // --- 15 Classic Legacy Icons ---
  { id: 'icon-1', file: 'assets/icons/app-icon-1.svg', name: 'Classic Green', group: 'classic' },
  { id: 'icon-2', file: 'assets/icons/app-icon-2.svg', name: 'Solid Green', group: 'classic' },
  { id: 'icon-3', file: 'assets/icons/app-icon-3.svg', name: 'Sparkle Teal', group: 'classic' },
  { id: 'icon-4', file: 'assets/icons/app-icon-4.svg', name: 'Origami Emerald', group: 'classic' },
  { id: 'icon-5', file: 'assets/icons/app-icon-5.svg', name: 'Electric Blue', group: 'classic' },
  { id: 'icon-6', file: 'assets/icons/app-icon-6.svg', name: 'Neon Magma', group: 'classic' },
  { id: 'icon-7', file: 'assets/icons/app-icon-7.svg', name: 'Bubblegum Pink', group: 'classic' },
  { id: 'icon-8', file: 'assets/icons/app-icon-8.svg', name: 'Violet Fur', group: 'classic' },
  { id: 'icon-9', file: 'assets/icons/app-icon-9.svg', name: 'Sunset Glow', group: 'classic' },
  { id: 'icon-10', file: 'assets/icons/app-icon-10.svg', name: 'Soft Lilac', group: 'classic' },
  { id: 'icon-11', file: 'assets/icons/app-icon-11.svg', name: 'Sky Pastel', group: 'classic' },
  { id: 'icon-12', file: 'assets/icons/app-icon-12.svg', name: 'Peach Cream', group: 'classic' },
  { id: 'icon-13', file: 'assets/icons/app-icon-13.svg', name: 'Mint Matcha', group: 'classic' },
  { id: 'icon-14', file: 'assets/icons/app-icon-14.svg', name: 'Fresh White', group: 'classic' },
  { id: 'icon-15', file: 'assets/icons/app-icon-15.svg', name: 'Monochrome Dark', group: 'classic' }
];

export function getAppIcon(id) {
  if (!id) return APP_ICONS[0];
  return APP_ICONS.find((i) => i.id === id) || APP_ICONS[0];
}

/**
 * Applies the selected app icon to the document favicon, apple touch icon,
 * and dynamic web manifest for PWA installation.
 */
export async function applyAppIcon(iconId) {
  const icon = getAppIcon(iconId);
  if (!icon) return;

  const iconSrc = assetUrl(icon.file);
  const isSvg = icon.file.toLowerCase().endsWith('.svg');
  const mimeType = isSvg ? 'image/svg+xml' : 'image/png';

  // 1. Update all favicon links
  const favicons = document.querySelectorAll("link[rel*='icon']");
  if (favicons.length > 0) {
    favicons.forEach((fav) => {
      fav.href = iconSrc;
      if (isSvg) fav.type = 'image/svg+xml';
    });
  } else {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = mimeType;
    link.href = iconSrc;
    document.head.appendChild(link);
  }

  // 2. Update Apple Touch Icons
  const appleIcons = document.querySelectorAll("link[rel='apple-touch-icon']");
  if (appleIcons.length > 0) {
    appleIcons.forEach((a) => {
      a.href = iconSrc;
    });
  } else {
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.href = iconSrc;
    document.head.appendChild(link);
  }

  // 3. Update Dynamic Manifest for PWA installs
  try {
    const resp = await fetch(assetUrl('manifest.webmanifest'));
    if (resp.ok) {
      const manifest = await resp.json();
      const base = window.location.href;
      manifest.start_url = new URL(manifest.start_url || './', base).href;
      manifest.scope = new URL(manifest.scope || './', base).href;
      const fullIconSrc = new URL(iconSrc, base).href;
      manifest.icons = [
        { src: fullIconSrc, sizes: isSvg ? 'any' : '192x192', type: mimeType, purpose: 'any' },
        { src: fullIconSrc, sizes: isSvg ? 'any' : '512x512', type: mimeType, purpose: 'maskable' }
      ];
      const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
      const linkManifest = document.querySelector("link[rel='manifest']");
      if (linkManifest) {
        linkManifest.href = URL.createObjectURL(blob);
      }
    }
  } catch (e) {
    // silently ignore if manifest cannot be fetched (e.g. offline)
  }

  try {
    localStorage.setItem('wa_app_icon_id', icon.id);
  } catch (e) {}
}
