import type { ToHost, ToWebview } from '../protocol.ts';

declare function acquireVsCodeApi(): {
  postMessage(message: ToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
};

export const vscodeApi = acquireVsCodeApi();
export const post = (message: ToHost): void => vscodeApi.postMessage(message);

type Child = Node | string | null | undefined | false;

/** Creates an element. Text only ever goes in as text, so nothing in a prompt can become markup. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'children'>> & { class?: string; 'aria-label'?: string; 'aria-hidden'?: string; 'aria-expanded'?: string; role?: string; 'aria-haspopup'?: string; 'aria-pressed'?: string; 'aria-controls'?: string; 'aria-labelledby'?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key === 'class') element.className = String(value);
    else if (key.startsWith('aria-') || key === 'role') element.setAttribute(key, String(value));
    else (element as unknown as Record<string, unknown>)[key] = value;
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  attach: 'M9.5 3.5v7a2 2 0 0 1-4 0V3.75a1.25 1.25 0 0 1 2.5 0V10a.5.5 0 0 1-1 0V4.5H6v5.5a1.5 1.5 0 0 0 3 0V3.75a2.25 2.25 0 0 0-4.5 0v6.75a3 3 0 0 0 6 0v-7h-1z',
  chat: 'M2 2h12v10H5l-3 3V2zm1 1v9.6L4.6 11H13V3H3zm2 2h6v1H5V5zm0 2.5h5v1H5v-1z',
  copy: 'M5 1h8a1 1 0 0 1 1 1v9h-1V2H5V1zM3 4h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm0 1v9h8V5H3z',
  edit: 'M11.5 1.5l3 3-9 9L2 14l.5-3.5 9-9zm0 1.4l-7.9 7.9-.3 1.9 1.9-.3 7.9-7.9-1.6-1.6z',
  more: 'M4 8a1.25 1.25 0 1 1-2.5 0A1.25 1.25 0 0 1 4 8zm5.25 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0zm5.25 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z',
  close: 'M8 7.3l3.6-3.6.7.7L8.7 8l3.6 3.6-.7.7L8 8.7l-3.6 3.6-.7-.7L7.3 8 3.7 4.4l.7-.7L8 7.3z',
  sparkle: 'M6.5 1.5l1.2 3.8 3.8 1.2-3.8 1.2-1.2 3.8-1.2-3.8L1.5 6.5l3.8-1.2 1.2-3.8zm6 7l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.9z',
  info: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm-.5 5h1v5h-1V7zm.5-2.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z',
  file: 'M9.7 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.8L9.7 1.5zM9.5 2.9l2.1 2.1H9.5V2.9zM4 13.5v-11h4.5V6H12v7.5H4z',
  sweep: 'M13.15 1.15l.7.7L9.4 6.3l-.7-.7 4.45-4.45zM6.3 5.3l3.4 3.4-3.6 3.6a3 3 0 0 1-2.1.9H2.8v-1.2a3 3 0 0 1 .9-2.1L6.3 5.3zM12 10h1v1.5h1.5v1H13V14h-1v-1.5h-1.5v-1H12V10z',
  trash: 'M5.5 1h5l.5 1.5H14v1H2v-1h3L5.5 1zM4 5h1l.5 8.5h5L11 5h1l-.5 9.5h-7L4 5zm2 1h1v6H6V6zm3 0h1v6H9V6z',
  warn: 'M7.56 1.5a.5.5 0 0 1 .88 0l6.5 12a.5.5 0 0 1-.44.74H1.5a.5.5 0 0 1-.44-.74l6.5-12zM7.5 6v4h1V6h-1zm0 5v1h1v-1h-1z',
} as const;

/** An inline icon, so the page needs no icon font. */
export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

let requestCounter = 0;
const waiting = new Map<number, { resolve: (message: Extract<ToWebview, { type: 'saved' }>) => void; reject: (reason: Error) => void }>();

/** Sends a message that the host answers, and waits for the answer. */
export function request<M extends ToHost>(message: (requestId: number) => M): Promise<Extract<ToWebview, { type: 'saved' }>> {
  return new Promise((resolve, reject) => {
    requestCounter += 1;
    waiting.set(requestCounter, { resolve, reject });
    post(message(requestCounter));
  });
}

export function settleRequest(message: Extract<ToWebview, { type: 'saved' | 'failed' }>): void {
  const entry = waiting.get(message.requestId);
  if (!entry) return;
  waiting.delete(message.requestId);
  if (message.type === 'saved') entry.resolve(message);
  else entry.reject(Object.assign(new Error(message.message), { code: message.code }));
}

let openMenu: HTMLElement | undefined;
let menuClosed: () => void = () => {};

export const isMenuOpen = (): boolean => openMenu !== undefined;

/** Called after a menu closes, so work that waited for it can run. */
export const onMenuClosed = (listener: () => void): void => {
  menuClosed = listener;
};

export function closeMenu(): void {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = undefined;
  menuClosed();
}

export interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
}

/** A small flyout anchored to its button, with keyboard support. */
export function showMenu(anchor: HTMLElement, items: readonly MenuItem[]): void {
  closeMenu();
  const buttons = items.map(item =>
    h('button', { class: item.danger ? 'menu-item danger' : 'menu-item', role: 'menuitem', type: 'button', onclick: () => { closeMenu(); anchor.focus(); item.run(); } }, item.label),
  );
  const menu = h('div', { class: 'menu', role: 'menu' }, ...buttons);
  menu.addEventListener('keydown', event => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { closeMenu(); anchor.focus(); event.preventDefault(); }
    if (event.key === 'ArrowDown') { buttons[(index + 1) % buttons.length]?.focus(); event.preventDefault(); }
    if (event.key === 'ArrowUp') { buttons[(index - 1 + buttons.length) % buttons.length]?.focus(); event.preventDefault(); }
  });
  document.body.append(menu);
  const box = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(box.bottom + 2, window.innerHeight - menu.offsetHeight - 4)}px`;
  menu.style.left = `${Math.max(4, Math.min(box.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 4))}px`;
  openMenu = menu;
  buttons[0]?.focus();
}

document.addEventListener('mousedown', event => {
  if (openMenu && !openMenu.contains(event.target as Node)) closeMenu();
});
