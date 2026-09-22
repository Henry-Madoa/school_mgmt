'use client';

import { useState, type ReactNode } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { GlAccountSelect } from '@/components/ui/gl-account-select';
import {
  createInventoryPostingGroupRequest, updateInventoryPostingGroupRequest,
  createProductPostingGroupRequest, updateProductPostingGroupRequest,
} from '@/app/actions/inventory';
import type { GlAccount, InventoryPostingGroupView, ProductPostingGroupView } from '@/lib/types';

export function InventoryPostingGroupFormButton({ group, accounts, className = 'btn', children }: {
  group?: InventoryPostingGroupView | null; accounts: GlAccount[]; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [glAccountId, setGlAccountId] = useState(group ? String(group.inventory_gl_account_id) : '');
  const g = group ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => { setGlAccountId(g ? String(g.inventory_gl_account_id) : ''); setOpen(true); }}>
        {children}
      </button>
      {open ? (
        <FormModal
          title={g ? `Edit ${g.code} — ${g.description}` : 'Add an inventory posting group'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => (g ? updateInventoryPostingGroupRequest(g.id, values) : createInventoryPostingGroupRequest(values))}
          submitLabel={g ? 'Save changes' : 'Create'}
          successTitle={g ? 'Inventory posting group updated' : 'Inventory posting group created'}
        >
          <Field name="code" label="Code" required placeholder="e.g. RETAIL" uppercase defaultValue={g?.code} />
          <Field name="description" label="Description" required defaultValue={g?.description} />
          <GlAccountSelect
            name="inventory_gl_account_id" label="Inventory G/L account" required
            accounts={accounts} value={glAccountId} onChange={setGlAccountId}
            hint="The balance-sheet account this item family's stock value posts to"
          />
        </FormModal>
      ) : null}
    </>
  );
}

export function ProductPostingGroupFormButton({ group, accounts, className = 'btn', children }: {
  group?: ProductPostingGroupView | null; accounts: GlAccount[]; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [glAccountId, setGlAccountId] = useState(group ? String(group.adjustment_gl_account_id) : '');
  const g = group ?? null;
  return (
    <>
      <button type="button" className={className} onClick={() => { setGlAccountId(g ? String(g.adjustment_gl_account_id) : ''); setOpen(true); }}>
        {children}
      </button>
      {open ? (
        <FormModal
          title={g ? `Edit ${g.code} — ${g.description}` : 'Add a product posting group'}
          onClose={() => setOpen(false)}
          onSubmit={(values) => (g ? updateProductPostingGroupRequest(g.id, values) : createProductPostingGroupRequest(values))}
          submitLabel={g ? 'Save changes' : 'Create'}
          successTitle={g ? 'Product posting group updated' : 'Product posting group created'}
        >
          <Field name="code" label="Code" required placeholder="e.g. GENERAL" uppercase defaultValue={g?.code} />
          <Field name="description" label="Description" required defaultValue={g?.description} />
          <GlAccountSelect
            name="adjustment_gl_account_id" label="Adjustment G/L account" required
            accounts={accounts} value={glAccountId} onChange={setGlAccountId}
            hint="The P&L account a Positive/Negative Adjmt. on this item family offsets against"
          />
        </FormModal>
      ) : null}
    </>
  );
}
