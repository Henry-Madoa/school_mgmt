import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listBudgets } from '@/lib/glBudgets';
import { formatDate, formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { NewBudgetButton } from './budget-actions';

export default async function BudgetsPage() {
  const user = await requireAction('GL_BUDGETS_READ');
  const [budgets, canManage] = await Promise.all([listBudgets(), currentCanAction('GL_BUDGETS_MANAGE')]);
  return (
    <Page title="Budgets" crumb="A figure per account per month; Financial Reports compare them with the actuals" user={user}>
      <Toolbar><Spacer />{canManage ? <NewBudgetButton /> : null}</Toolbar>
      <Card>
        {budgets.length ? (
          <TableWrap>
            <thead><tr><th>Name</th><th>Description</th><th>Covers</th><th className="num">Figures</th><th className="num">Total</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {budgets.map((b) => (
                <tr key={b.name}>
                  <td className="mono"><Link href={`/budgets/${encodeURIComponent(b.name)}`}>{b.name}</Link></td>
                  <td>{b.description ?? '—'}</td>
                  <td>{b.first_date ? `${formatDate(b.first_date)} – ${formatDate(b.last_date!)}` : <span className="muted-cell">empty</span>}</td>
                  <td className="num">{b.entries}</td>
                  <td className="num"><Money cents={b.total} /></td>
                  <td>{b.blocked ? <Pill tone="warn">Blocked</Pill> : <Pill tone="ok">Open</Pill>}</td>
                  <td className="tiny">{formatDateTime(b.created_at)}<div className="muted-cell">{b.created_by}</div></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🎯" title="No budgets yet" sub="Create one, fill it from last year's actuals, and add a Budget Entries column to a Financial Report to see budget against actual." />}
      </Card>
    </Page>
  );
}
