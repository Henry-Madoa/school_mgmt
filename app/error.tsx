'use client';

/**
 * Catches anything a page throws — most often a ForbiddenError from
 * requirePerm(), which is how a role without the right permission is turned
 * away rather than shown an empty screen.
 */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const forbidden = error?.message?.includes('permission');
  return (
    <main className="content">
      <div className="card">
        <div className="empty">
          <div className="big">{forbidden ? '🔒' : '⚠'}</div>
          <div className="title">{forbidden ? 'Not permitted' : 'Something went wrong'}</div>
          <div className="sub">{error?.message || 'Unexpected error'}</div>
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn ghost" onClick={reset}>Try again</button>
          </div>
        </div>
      </div>
    </main>
  );
}
