'use client';

/**
 * Catches failures in the root layout itself (e.g. the org/theme lookup that
 * `RootLayout` awaits before rendering). error.tsx can't reach this — it only
 * wraps children of the layout, not the layout's own render — so this is the
 * last line of defense before Next.js's unstyled default screen. Since the
 * layout never rendered, this can't lean on globals.css or the org's theme
 * tokens; it has to bring its own html/body and styling.
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        background: '#0f1115',
        color: '#e6e8eb',
      }}>
        <div style={{
          textAlign: 'center',
          padding: '40px 32px',
          maxWidth: 420,
          border: '1px solid #2a2d34',
          borderLeft: '3px solid #e5484d',
          borderRadius: 8,
          background: '#16181d',
        }}>
          <div style={{ fontSize: 34, opacity: 0.6, marginBottom: 12 }}>⚠</div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>The application failed to load</div>
          <div style={{ color: '#9aa0a8', fontSize: 13, marginBottom: 20 }}>
            {error?.message || 'An unexpected error occurred.'}
          </div>
          <button
            type="button"
            onClick={reset}
            style={{
              background: 'transparent',
              color: '#e6e8eb',
              border: '1px solid #3a3d44',
              borderRadius: 6,
              padding: '8px 18px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
