export function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]);
}

export function ordinalSuffix(n: number): string {
  return ordinal(n).slice(String(n).length);
}

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`;
}

export function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** Tiny helper for building DOM from template strings. */
export function html<T extends HTMLElement = HTMLElement>(markup: string): T {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild as T;
}
