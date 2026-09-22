/** A small Excel-file glyph — recognizable at a glance in a toolbar, unlike a bare emoji,
 *  and fixed to Excel's own green so it reads correctly in both light and dark themes.
 *  Exported so DocumentActionsMenu can reuse the same glyph for its "Export to Excel" item. */
export function ExcelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="1" y="1" width="22" height="22" rx="5" fill="#207245" />
      <path
        d="M6.4 6.5H9.4L12 10.4L14.6 6.5H17.6L13.5 12L17.6 17.5H14.6L12 13.6L9.4 17.5H6.4L10.5 12Z"
        fill="#fff"
      />
    </svg>
  );
}

/** A styled download link — a GET request needs no client JS, so this stays a plain
 *  Server Component and never enters the browser bundle. Forwards the page's own
 *  filter params so the download matches what's currently on screen. `disabled` (pass the
 *  page's own empty-list check) renders it as inert text instead of a link — nothing worth
 *  exporting when the list is empty, and a plain `<a>` has no real disabled state of its own. */
export function ExportButton({ href, params, children, className = 'btn sm ghost', disabled = false }: {
  href: string;
  params?: Record<string, string | undefined>;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  const label = <><ExcelIcon />{children ?? 'Export to Excel'}</>;

  if (disabled) {
    return (
      <span className={`${className} disabled`} aria-disabled="true" title="Nothing to export">
        {label}
      </span>
    );
  }

  return (
    <a className={className} href={qs ? `${href}?${qs}` : href}>
      {label}
    </a>
  );
}
