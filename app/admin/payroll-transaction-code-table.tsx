'use client';

import { useCallback } from 'react';
import { TableWrap, Pill } from '@/components/ui/primitives';
import { SortTh, useSortedRows } from '@/components/ui/sortable';
import { TransactionCodeFormButton, DeleteTransactionCodeButton } from './payroll-transaction-code-form';
import type { GlAccount, PayrollTransactionCode } from '@/lib/types';

type Col = 'code' | 'name' | 'type' | 'special' | 'formula' | 'employer' | 'taxable' | 'status';

/** The Earnings & Deductions catalogue, sortable by any column (code by default). */
export function TransactionCodeTable({ rows, accounts }: { rows: PayrollTransactionCode[]; accounts: GlAccount[] }) {
  const pick = useCallback((c: PayrollTransactionCode, key: Col) => {
    switch (key) {
      case 'code': return c.code;
      case 'name': return c.name;
      case 'type': return c.type;
      case 'special': return c.special_type === 'NONE' ? null : c.special_type;
      case 'formula': return c.is_formula ? c.formula : null;
      case 'employer': return c.employer_formula ? c.employer_formula : c.employer_factor > 0 ? c.employer_factor : null;
      case 'taxable': return c.taxable;
      case 'status': return c.status;
    }
  }, []);
  const { rows: sorted, sort, toggle } = useSortedRows<PayrollTransactionCode, Col>(rows, pick, { key: 'code', dir: 'asc' });
  const th = (col: Col, label: string) => <SortTh col={col} sort={sort} onToggle={toggle}>{label}</SortTh>;

  return (
    <TableWrap sortable={false}>
      <thead>
        <tr>
          {th('code', 'Code')}
          {th('name', 'Name')}
          {th('type', 'Type')}
          {th('special', 'Special type')}
          {th('formula', 'Formula')}
          {th('employer', 'Employer share')}
          {th('taxable', 'Taxable')}
          {th('status', 'Status')}
          <th className="num" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((c) => (
          <tr key={c.id}>
            <td className="mono">{c.code}</td>
            <td><b>{c.name}</b></td>
            <td>{c.type.replace('_', ' ')}</td>
            <td className="tiny">{c.special_type === 'NONE' ? '—' : c.special_type.replace(/_/g, ' ')}</td>
            <td className="mono tiny">{c.is_formula && c.formula ? c.formula : '—'}</td>
            <td className="tiny">{c.employer_formula ? <span className="mono">{c.employer_formula}</span> : c.employer_factor > 0 ? `× ${c.employer_factor}` : '—'}</td>
            <td>{c.taxable ? <Pill tone="ok">Yes</Pill> : '—'}</td>
            <td><Pill status={c.status} /></td>
            <td className="num">
              <TransactionCodeFormButton code={c} accounts={accounts}>Edit</TransactionCodeFormButton>{' '}
              <DeleteTransactionCodeButton id={c.id} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
