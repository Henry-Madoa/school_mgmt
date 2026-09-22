'use client';

import { useRunAction } from '@/components/ui/run-action';
import { indentChartOfAccountsRequest } from '@/app/actions/gl';

/**
 * Business Central's "Indent Chart of Accounts" action, on the Chart of Accounts action bar.
 *
 * Restamps every account's indentation from the Begin-Total / End-Total bracketing and writes
 * each End-Total's Totaling range from its matching Begin-Total. Safe to run repeatedly — a
 * second run over an already-indented chart reports nothing changed.
 */
export function IndentAccountsButton({ className = 'btn ghost' }: { className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button
      type="button" className={className} disabled={busy}
      onClick={() => run(() => indentChartOfAccountsRequest(), {
        confirm: {
          title: 'Indent the chart of accounts?',
          message: 'Each account is re-indented from its Begin-Total / End-Total bracketing, and '
            + 'every End-Total has its Totaling range set from the Begin-Total it closes.',
          confirmLabel: 'Indent',
        },
        successTitle: (r) => (r.updated ? `${r.updated} account${r.updated === 1 ? '' : 's'} indented` : 'Already indented'),
        successDetail: (r) => [
          r.totalingSet ? `${r.totalingSet} Totaling range${r.totalingSet === 1 ? '' : 's'} set` : null,
          // An unclosed Begin-Total means the chart's bracketing is wrong; say so rather than
          // silently indenting everything after it one level too deep.
          r.unclosed.length ? `Unclosed Begin-Total: ${r.unclosed.join(', ')}` : null,
        ].filter(Boolean).join(' · ') || undefined,
      })}
    >
      {busy ? 'Indenting…' : 'Indent'}
    </button>
  );
}
