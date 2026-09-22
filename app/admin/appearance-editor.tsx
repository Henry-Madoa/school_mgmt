'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useFormat } from '@/components/ui/format-provider';
import { saveTheme } from '@/app/actions/admin';
import { formatDateTime } from '@/lib/format';
import type { Theme, ThemePreset, ThemeTokens, TokenGroup } from '@/lib/types';

/** '#abc' / '#aabbcc' -> '#aabbcc'; anything else falls back to black. */
function toHex(value: string | undefined): string {
  const s = String(value ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  return '#000000';
}

export interface AppearanceEditorProps {
  theme: Theme;
  presets: ThemePreset[];
  groups: TokenGroup[];
}

export function AppearanceEditor({ theme, presets, groups }: AppearanceEditorProps) {
  const router = useRouter();
  const toast = useToast();
  const { cur } = useFormat();

  // `saved` is what the server holds; `working` is what the screen previews.
  const [saved, setSaved] = useState<ThemeTokens>(theme.tokens);
  const [working, setWorking] = useState<ThemeTokens>(theme.tokens);
  const [preset, setPreset] = useState(theme.preset);
  const [busy, setBusy] = useState(false);

  const dirty = useMemo(
    () => Object.keys(working).some((k) => working[k] !== saved[k]),
    [working, saved],
  );

  /* Paint the whole document from `working` so the sidebar, buttons and charts
   * around the editor all respond, exactly as the old imperative editor did. */
  const paint = useCallback((tokens: ThemeTokens) => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
  }, []);

  useEffect(() => {
    paint(working);
  }, [working, paint]);

  // On unmount, drop the inline overrides so the server-rendered theme wins again.
  useEffect(() => () => {
    const root = document.documentElement;
    for (const k of Object.keys(theme.tokens)) root.style.removeProperty(k);
  }, [theme.tokens]);

  const setToken = (key: string, value: string) => {
    setWorking((cur) => ({ ...cur, [key]: value }));
    setPreset('custom');
  };

  const applyPreset = (p: ThemePreset) => {
    setWorking({ ...p.tokens });
    setPreset(p.key);
    toast('Preset applied', `${p.label} — save to make it permanent`, 'ok');
  };

  const revert = () => {
    setWorking({ ...saved });
    setPreset(theme.preset);
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await saveTheme(working, preset);
      if (!res.ok) {
        toast('Could not save theme', res.error, 'err');
        return;
      }
      setSaved({ ...res.data.tokens });
      setWorking({ ...res.data.tokens });
      toast('Theme saved', 'Every user will see these colours on next load', 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid split-aside-lg">
      <div>
        <Card>
          <h3>Theme presets</h3>
          <div className="card-sub">Start from a preset, then fine-tune any individual token below.</div>
          <div className="preset-grid">
            {presets.map((p) => (
              <button key={p.key} type="button"
                className={`preset ${p.key === preset ? 'active' : ''}`}
                onClick={() => applyPreset(p)}>
                <div className="swatches">
                  <i style={{ background: p.tokens['--sidebar-bg'] }} />
                  <i style={{ background: p.tokens['--brand-primary'] }} />
                  <i style={{ background: p.tokens['--brand-accent'] }} />
                  <i style={{ background: p.tokens['--bg'] }} />
                </div>
                <div className="pname">{p.label}</div>
              </button>
            ))}
          </div>
        </Card>

        {groups.map((group, i) => (
          <Card key={group.group}>
            <h3>{group.group}</h3>
            {i === 0 ? (
              <div className="card-sub">
                Changes preview instantly across the whole interface. Save to make them permanent for every user.
              </div>
            ) : null}
            {group.items.map((item) => {
              const value = working[item.key] ?? '';
              return (
                <div className="token-row" key={item.key}>
                  <div className="tl">
                    {item.label}
                    {item.help ? <small>{item.help}</small> : null}
                    <small className="mono" style={{ opacity: 0.6 }}>{item.key}</small>
                  </div>
                  <div className="tc">
                    {item.type === 'color' ? (
                      <>
                        <input type="color" value={toHex(value)} aria-label={`${item.label} colour`}
                          onChange={(e) => setToken(item.key, e.target.value)} />
                        <input type="text" value={value} aria-label={item.label}
                          onChange={(e) => setToken(item.key, e.target.value)} />
                      </>
                    ) : item.type === 'select' ? (
                      <select value={value} aria-label={item.label}
                        onChange={(e) => setToken(item.key, e.target.value)}>
                        {(item.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={value} aria-label={item.label} style={{ width: 230 }}
                        onChange={(e) => setToken(item.key, e.target.value)} />
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        ))}
      </div>

      <div>
        <Card className="sticky-card">
          <h3>Component preview</h3>
          <div className="card-sub">Live, using the values on the left.</div>

          <div className="preview-frame">
            <div className="preview-nav">
              <div className="on">Dashboard</div>
              <div className="off">Students</div>
              <div className="off">Fees</div>
            </div>
            <div className="preview-body">
              <div className="preview-card">
                <div className="lab">Total deposits</div>
                <div className="val">{cur(51230000, { decimals: 0 })}</div>
                <div className="inline" style={{ marginTop: 10 }}>
                  <button type="button" className="btn sm">Primary</button>
                  <button type="button" className="btn ghost sm">Secondary</button>
                </div>
                <div className="inline" style={{ marginTop: 10 }}>
                  <span className="pill ok">Active</span>
                  <span className="pill warn">Pending</span>
                  <span className="pill bad">Arrears</span>
                </div>
                <div className="preview-bars">
                  <i style={{ height: '60%', background: 'var(--series-1)' }} />
                  <i style={{ height: '85%', background: 'var(--series-2)' }} />
                  <i style={{ height: '45%', background: 'var(--series-3)' }} />
                </div>
              </div>
            </div>
          </div>

          <div className="dirty-note">{dirty ? 'You have unsaved changes.' : ''}</div>
          <button type="button" className="btn block" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save theme for everyone'}
          </button>
          <button type="button" className="btn ghost block" style={{ marginTop: 8 }} onClick={revert}>
            Revert unsaved changes
          </button>
          <div className="note" style={{ marginTop: 12 }}>
            Last saved {formatDateTime(theme.updated_at)} by {theme.updated_by || '—'}.
            Tokens are rendered into the document head by the server, so the sign-in screen is themed too.
          </div>
        </Card>
      </div>
    </div>
  );
}
