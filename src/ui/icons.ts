// Tiny inline SVG icon set (24x24, stroke = currentColor). OWNER: src/ui.
const wrap = (d: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;

export const ICONS = {
  orbit: wrap('<ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(-24 12 12)"/><circle cx="12" cy="12" r="2.3"/>'),
  photo: wrap('<path d="M4 8.5h3.2l1.6-2.5h6.4l1.6 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.4" r="3.4"/>'),
  walk: wrap('<circle cx="13" cy="4.6" r="1.7"/><path d="M12.4 8.6l-2.3 3.6 2.5 2.4-.9 5.2M12.4 8.6l3.6 2.4-.4 3M10.1 12.2L7.6 13.5"/>'),
  fly: wrap('<path d="M3 11.5l18-7.5-6.5 16-3-6.7z"/><path d="M11.5 13.3L21 4"/>'),
  sun: wrap('<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'),
  gauge: wrap('<path d="M4.2 17.5a8.5 8.5 0 1 1 15.6 0"/><path d="M12 13.4l3.6-4.1"/><circle cx="12" cy="13.6" r="1.1"/>'),
  drift: wrap('<path d="M3 9c3 0 3-2.4 6-2.4S12 9 15 9s3-2.4 6-2.4M3 15.4c3 0 3-2.4 6-2.4s3 2.4 6 2.4 3-2.4 6-2.4"/>'),
  lens: wrap('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3.5v5.1M18.5 7.5l-4.4 2.6M18.5 16.5l-4.4-2.6"/>'),
  book: wrap('<path d="M4 5.6c2.6-.9 5.4-.7 8 1.2 2.6-1.9 5.4-2.1 8-1.2v12.6c-2.6-.9-5.4-.7-8 1.2-2.6-1.9-5.4-2.1-8-1.2z"/><path d="M12 6.8v12.6"/>'),
  download: wrap('<path d="M12 4v10.5M7.6 10.4L12 14.8l4.4-4.4M5 19h14"/>'),
  help: wrap('<circle cx="12" cy="12" r="9"/><path d="M9.4 9.4a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.3 1-1.3 2M12 16.8v.2"/>'),
  info: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.6M12 7.6v.2"/>'),
  eyeOff: wrap('<path d="M3 3l18 18M10.6 5.2A9.6 9.6 0 0 1 12 5c5 0 8.4 3.6 9.5 7-.4 1.2-1.2 2.5-2.3 3.6M6.4 6.5C4.6 7.8 3.3 9.6 2.5 12c1.1 3.4 4.5 7 9.5 7 1.4 0 2.7-.3 3.8-.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  eye: wrap('<path d="M2.5 12C3.6 8.6 7 5 12 5s8.4 3.6 9.5 7c-1.1 3.4-4.5 7-9.5 7s-8.4-3.6-9.5-7z"/><circle cx="12" cy="12" r="3"/>'),
  menu: wrap('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  chevron: wrap('<path d="M6 9.5l6 6 6-6"/>'),
  check: wrap('<path d="M5 12.6l4.4 4.4L19 7.4"/>'),
  close: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
  reset: wrap('<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5L4 9.4M4 4.6v4.8h4.8"/>'),
  loop: wrap('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 9h18M3 15h18M7 5.5V9M12 5.5V9M17 5.5V9M7 15v3.5M12 15v3.5M17 15v3.5"/>'),
  record: wrap('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>'),
  pause: wrap('<path d="M8.5 6v12M15.5 6v12"/>'),
};

/** Brand glyph: a slim stack with a plume, used in the top bar. */
export const MARK = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
  <defs><linearGradient id="mk-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3d6"/><stop offset=".45" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></linearGradient></defs>
  <path d="M12 1.6c.9 1.7 1.3 3.6 1.3 5.6V15h-2.6V7.2c0-2 .4-3.9 1.3-5.6z" fill="#eef2f6"/>
  <path d="M10.7 15h2.6l.9 2.6c.6 1.6.8 3.2.8 4.7h-6c0-1.5.2-3.1.8-4.7z" fill="url(#mk-p)"/>
</svg>`;
