import type { ItemType } from '../sim/items';

const mushroom = (x = 0, y = 0, s = 1) => `
  <g transform="translate(${x} ${y}) scale(${s})">
    <path d="M14 34 Q14 50 32 50 Q50 50 50 34 Z" fill="#fff1d6" stroke="#3a2a1a" stroke-width="2.5"/>
    <circle cx="26" cy="40" r="2.6" fill="#222"/><circle cx="38" cy="40" r="2.6" fill="#222"/>
    <path d="M4 34 Q4 6 32 6 Q60 6 60 34 Z" fill="#e63946" stroke="#3a2a1a" stroke-width="2.5"/>
    <circle cx="32" cy="17" r="6" fill="#fff"/><circle cx="15" cy="27" r="4.5" fill="#fff"/><circle cx="49" cy="27" r="4.5" fill="#fff"/>
  </g>`;

const shell = (color: string) => `
  <ellipse cx="32" cy="46" rx="26" ry="8" fill="#fff" stroke="#3a2a1a" stroke-width="2.5"/>
  <path d="M8 44 Q8 12 32 12 Q56 12 56 44 Z" fill="${color}" stroke="#3a2a1a" stroke-width="2.5"/>
  <path d="M24 22 L40 22 L46 34 L40 44 L24 44 L18 34 Z" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round" opacity="0.9"/>
`;

const ICONS: Record<ItemType, string> = {
  mushroom: mushroom(),
  tripleMushroom: `${mushroom(-4, 14, 0.62)}${mushroom(28, 14, 0.62)}${mushroom(12, -2, 0.62)}`,
  banana: `
    <path d="M12 12 Q6 44 34 54 Q54 58 58 46 Q36 48 26 30 Q20 18 22 8 Z" fill="#ffd93b" stroke="#3a2a1a" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M12 12 L22 8 L20 3 L13 5 Z" fill="#6b4a2b" stroke="#3a2a1a" stroke-width="2"/>
    <path d="M22 26 Q28 42 44 48" fill="none" stroke="#e8b400" stroke-width="2.5" stroke-linecap="round"/>`,
  greenShell: shell('#2ecc40'),
  redShell: shell('#e63946'),
  star: `
    <path d="M32 4 L40 23 L60 24 L44 37 L50 57 L32 46 L14 57 L20 37 L4 24 L24 23 Z" fill="#ffd23f" stroke="#3a2a1a" stroke-width="2.5" stroke-linejoin="round"/>
    <rect x="25" y="26" width="4" height="9" rx="2" fill="#222"/><rect x="35" y="26" width="4" height="9" rx="2" fill="#222"/>`,
};

export function itemIcon(item: ItemType): string {
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ICONS[item]}</svg>`;
}
