import type { ThemeTokens, TokenGroup } from './types.ts';

/*
 * Theme presets. A theme is a flat map of CSS custom properties that the client
 * stamps onto :root, so every colour, radius and font in the UI is data, not code.
 * Chart series colours come from the dataviz reference palette and are validated
 * for colour-vision deficiency separation; the admin may override them.
 */

const BASE: ThemeTokens = {
  '--font-family': "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
  '--font-size': '14px',
  '--radius': '10px',
  '--radius-sm': '6px',
  '--density': '1',
  '--series-1': '#2a78d6',
  '--series-2': '#eb6834',
  '--series-3': '#1baf7a',
};

export const PRESETS: Record<string, { label: string; tokens: ThemeTokens }> = {
  'emerald-standard': {
    label: 'Emerald Standard',
    tokens: {
      ...BASE,
      '--brand-primary': '#0f7a52',
      '--brand-primary-hover': '#0c6242',
      '--brand-primary-soft': '#e3f4ec',
      '--brand-on-primary': '#ffffff',
      '--brand-accent': '#c9a227',
      '--sidebar-bg': '#0b3d2c',
      '--sidebar-fg': '#cfe7dc',
      '--sidebar-fg-active': '#ffffff',
      '--sidebar-active-bg': '#0f7a52',
      '--topbar-bg': '#ffffff',
      '--topbar-fg': '#152220',
      '--bg': '#f4f6f5',
      '--surface': '#ffffff',
      '--surface-2': '#f8faf9',
      '--border': '#dde3e0',
      '--text': '#12211c',
      '--text-muted': '#5d6b66',
      '--success': '#0f7a52',
      '--warning': '#b96b00',
      '--danger': '#c0392b',
      '--info': '#1d6fb8',
    },
  },
  'sacco-blue': {
    label: 'Academy Blue',
    tokens: {
      ...BASE,
      '--brand-primary': '#1d5fa8',
      '--brand-primary-hover': '#174c87',
      '--brand-primary-soft': '#e5eff9',
      '--brand-on-primary': '#ffffff',
      '--brand-accent': '#f0a500',
      '--sidebar-bg': '#0f2c4d',
      '--sidebar-fg': '#c6d8ec',
      '--sidebar-fg-active': '#ffffff',
      '--sidebar-active-bg': '#1d5fa8',
      '--topbar-bg': '#ffffff',
      '--topbar-fg': '#122436',
      '--bg': '#f3f6fa',
      '--surface': '#ffffff',
      '--surface-2': '#f7f9fc',
      '--border': '#dbe3ec',
      '--text': '#122436',
      '--text-muted': '#5b6b7c',
      '--success': '#1b8a5a',
      '--warning': '#b96b00',
      '--danger': '#c0392b',
      '--info': '#1d5fa8',
    },
  },
  'maroon-heritage': {
    label: 'Maroon Heritage',
    tokens: {
      ...BASE,
      '--brand-primary': '#8c1c2f',
      '--brand-primary-hover': '#711624',
      '--brand-primary-soft': '#f7e7ea',
      '--brand-on-primary': '#ffffff',
      '--brand-accent': '#d4a017',
      '--sidebar-bg': '#3d0d16',
      '--sidebar-fg': '#e7cdd2',
      '--sidebar-fg-active': '#ffffff',
      '--sidebar-active-bg': '#8c1c2f',
      '--topbar-bg': '#ffffff',
      '--topbar-fg': '#2a1418',
      '--bg': '#f7f4f4',
      '--surface': '#ffffff',
      '--surface-2': '#fbf8f8',
      '--border': '#e6dcdd',
      '--text': '#2a1418',
      '--text-muted': '#6d5c60',
      '--success': '#1b7a4f',
      '--warning': '#b96b00',
      '--danger': '#a32a1c',
      '--info': '#1d6fb8',
    },
  },
  'slate-professional': {
    label: 'Slate Professional',
    tokens: {
      ...BASE,
      '--brand-primary': '#334c6b',
      '--brand-primary-hover': '#263a52',
      '--brand-primary-soft': '#eaeff5',
      '--brand-on-primary': '#ffffff',
      '--brand-accent': '#3f9c8f',
      '--sidebar-bg': '#1f2a37',
      '--sidebar-fg': '#c3cbd6',
      '--sidebar-fg-active': '#ffffff',
      '--sidebar-active-bg': '#334c6b',
      '--topbar-bg': '#ffffff',
      '--topbar-fg': '#1f2937',
      '--bg': '#f5f6f8',
      '--surface': '#ffffff',
      '--surface-2': '#f9fafb',
      '--border': '#e0e3e8',
      '--text': '#1f2937',
      '--text-muted': '#5f6b7a',
      '--success': '#1b8a5a',
      '--warning': '#b06f00',
      '--danger': '#bd3427',
      '--info': '#2a6fb0',
    },
  },
  /*
   * The Calbytes Technologies brand palette, taken from the brand guide rather than sampled off
   * the logo: Calbytes Navy #0A2540 (primary ink and dark grounds), Deep Teal #0E7490 (the
   * gradient mid-point), Byte Cyan #06B6D4 (the accent and calls to action), Slate #64748B
   * (secondary information) and Signal White.
   *
   * Deep Teal rather than Byte Cyan carries --brand-primary: the guide measures Byte Cyan at
   * 2.4:1 on white and restricts it to fills, while --brand-primary also paints emphasis text
   * (a stat figure, an active nav label). Deep Teal reads at 5.36:1 either way, and the cyan
   * stays where the guide wants it — as the accent.
   */
  'calbytes-tech': {
    label: 'Calbytes Technologies',
    tokens: {
      ...BASE,
      '--brand-primary': '#0e7490',
      '--brand-primary-hover': '#0b5c73',
      '--brand-primary-soft': '#e0f5fa',
      '--brand-on-primary': '#ffffff',
      '--brand-accent': '#06b6d4',
      '--sidebar-bg': '#0a2540',
      // Slate itself is only 3.26:1 on Navy; this is Slate lightened to a readable 9.3:1.
      '--sidebar-fg': '#b9cbdb',
      '--sidebar-fg-active': '#ffffff',
      '--sidebar-active-bg': '#0e7490',
      '--topbar-bg': '#ffffff',
      '--topbar-fg': '#0a2540',
      '--bg': '#f5f8fa',
      '--surface': '#ffffff',
      '--surface-2': '#f8fbfc',
      '--border': '#dde5ec',
      '--text': '#0a2540',
      '--text-muted': '#64748b',
      // The brand guide's semantic set, which sits alongside Navy/Teal/Cyan/Slate rather than
      // replacing any of them: Ledger Green (success), Pending Amber (caution), Escalation Red
      // (danger).
      '--success': '#15803d',
      '--warning': '#b45309',
      '--danger': '#c2413b',
      // The guide names no "info" colour, and --info carries text on white (status pills), which
      // rules Byte Cyan out — so informational status borrows Deep Teal.
      '--info': '#0e7490',
    },
  },
  midnight: {
    label: 'Midnight (dark)',
    tokens: {
      ...BASE,
      '--series-1': '#3987e5',
      '--series-2': '#d95926',
      '--series-3': '#199e70',
      '--brand-primary': '#2f8f6b',
      '--brand-primary-hover': '#38a67d',
      '--brand-primary-soft': '#173029',
      '--brand-on-primary': '#ffffff',
      '--brand-accent': '#d8b14a',
      '--sidebar-bg': '#101417',
      '--sidebar-fg': '#9aa6ae',
      '--sidebar-fg-active': '#ffffff',
      '--sidebar-active-bg': '#2f8f6b',
      '--topbar-bg': '#171c20',
      '--topbar-fg': '#e7edf1',
      '--bg': '#12171a',
      '--surface': '#171c20',
      '--surface-2': '#1d2429',
      '--border': '#2b3439',
      '--text': '#e7edf1',
      '--text-muted': '#9aa6ae',
      '--success': '#3fa97c',
      '--warning': '#d99a2b',
      '--danger': '#e06055',
      '--info': '#4a9be0',
    },
  },
};

export const TOKEN_GROUPS: TokenGroup[] = [
  {
    group: 'Brand',
    items: [
      { key: '--brand-primary', label: 'Primary', type: 'color', help: 'Buttons, links, active states' },
      { key: '--brand-primary-hover', label: 'Primary (hover)', type: 'color' },
      { key: '--brand-primary-soft', label: 'Primary tint', type: 'color', help: 'Soft background behind primary elements' },
      { key: '--brand-on-primary', label: 'Text on primary', type: 'color' },
      { key: '--brand-accent', label: 'Accent', type: 'color', help: 'Highlights and secondary emphasis' },
    ],
  },
  {
    group: 'Navigation',
    items: [
      { key: '--sidebar-bg', label: 'Sidebar background', type: 'color' },
      { key: '--sidebar-fg', label: 'Sidebar text', type: 'color' },
      { key: '--sidebar-fg-active', label: 'Sidebar active text', type: 'color' },
      { key: '--sidebar-active-bg', label: 'Sidebar active background', type: 'color' },
      { key: '--topbar-bg', label: 'Top bar background', type: 'color' },
      { key: '--topbar-fg', label: 'Top bar text', type: 'color' },
    ],
  },
  {
    group: 'Surfaces',
    items: [
      { key: '--bg', label: 'Page background', type: 'color' },
      { key: '--surface', label: 'Card surface', type: 'color' },
      { key: '--surface-2', label: 'Sunken surface', type: 'color' },
      { key: '--border', label: 'Borders', type: 'color' },
      { key: '--text', label: 'Body text', type: 'color' },
      { key: '--text-muted', label: 'Muted text', type: 'color' },
    ],
  },
  {
    group: 'Status',
    items: [
      { key: '--success', label: 'Success', type: 'color' },
      { key: '--warning', label: 'Warning', type: 'color' },
      { key: '--danger', label: 'Danger', type: 'color' },
      { key: '--info', label: 'Information', type: 'color' },
    ],
  },
  {
    group: 'Charts',
    items: [
      { key: '--series-1', label: 'Series 1', type: 'color', help: 'Validated for colour-vision deficiency separation' },
      { key: '--series-2', label: 'Series 2', type: 'color' },
      { key: '--series-3', label: 'Series 3', type: 'color' },
    ],
  },
  {
    group: 'Typography & shape',
    items: [
      { key: '--font-family', label: 'Font stack', type: 'text' },
      { key: '--font-size', label: 'Base font size', type: 'select', options: ['13px', '14px', '15px', '16px'] },
      { key: '--radius', label: 'Corner radius', type: 'select', options: ['0px', '4px', '6px', '10px', '14px', '18px'] },
      { key: '--radius-sm', label: 'Small radius', type: 'select', options: ['0px', '3px', '4px', '6px', '8px'] },
      { key: '--density', label: 'Spacing density', type: 'select', options: ['0.85', '1', '1.15', '1.3'] },
    ],
  },
];

export const ALL_KEYS: string[] = TOKEN_GROUPS.flatMap((g) => g.items.map((i) => i.key));

