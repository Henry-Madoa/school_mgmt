'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { GlAccountSelect } from '@/components/ui/gl-account-select';
import { useRunAction } from '@/components/ui/run-action';
import { today } from '@/lib/format';
import {
  requestFaJournalLine, saveFaJournalLine, deleteFaJournalLineRequest, submitFaJournalLineRequest,
  cancelFaJournalLineApprovalRequest, approveFaJournalLineRequest, rejectFaJournalLineRequest,
  reopenFaJournalLineRequest, postFaJournalLineRequest,
} from '@/app/actions/fixedAssets';
import type { FaJournalLineView, FaPostingType, GlAccount, Maintenance } from '@/lib/types';

type EligibleAsset = {
  id: number; no: string; description: string;
  depreciation_book_code: string | null; disposed: boolean;
};

const POSTING_TYPES: { value: FaPostingType; label: string }[] = [
  { value: 'Acquisition Cost', label: 'Acquisition Cost' },
  { value: 'Depreciation', label: 'Depreciation' },
  { value: 'Write-Down', label: 'Write-Down' },
  { value: 'Appreciation', label: 'Appreciation' },
  { value: 'Disposal', label: 'Disposal' },
  { value: 'Maintenance', label: 'Maintenance' },
];
const NEEDS_BAL = new Set<FaPostingType>(['Acquisition Cost', 'Maintenance', 'Disposal']);

function LineFields({ assets, accounts, maintenance, defaultBookCode, initial }: {
  assets: EligibleAsset[]; accounts: GlAccount[]; maintenance: Maintenance[];
  defaultBookCode: string | null; initial?: Partial<FaJournalLineView> | null;
}) {
  const editing = !!initial;
  const [postingType, setPostingType] = useState<FaPostingType>(initial?.fa_posting_type ?? 'Acquisition Cost');
  const [assetId, setAssetId] = useState(String(initial?.fixed_asset_id ?? ''));
  const [balId, setBalId] = useState(String(initial?.balancing_gl_account_id ?? ''));

  const asset = assets.find((a) => String(a.id) === assetId);
  const bookCode = asset?.depreciation_book_code ?? defaultBookCode ?? '';
  const needsBal = NEEDS_BAL.has(postingType);

  return (
    <>
      <div className="grid g2">
        <Field
          name="faPostingType" label="FA posting type" type="select" required disabled={editing}
          defaultValue={postingType} options={POSTING_TYPES}
          onChange={(e) => setPostingType(e.target.value as FaPostingType)}
        />
        <Field name="postingDate" label="Posting date" type="date" required defaultValue={initial?.posting_date ?? today()} />
      </div>

      <SearchableSelect
        name="fixedAssetId" label="Fixed asset" required items={assets} value={assetId} disabled={editing}
        getValue={(a) => String(a.id)} getLabel={(a) => `${a.no} — ${a.description}`}
        onChange={setAssetId} placeholder="Search asset…" emptyText="No matching assets"
      />
      <input type="hidden" name="depreciationBookCode" value={bookCode} />
      {asset && !asset.depreciation_book_code ? (
        <div className="note">This asset has no Depreciation Book yet — set one up on the Assets tab first.</div>
      ) : null}

      <div className="grid g2">
        <Field
          name="amount" label={postingType === 'Disposal' ? 'Disposal proceeds' : 'Amount'} type="currency" required={postingType !== 'Disposal'}
          defaultValue={initial?.amount != null ? String(initial.amount / 100) : ''}
          hint={postingType === 'Disposal' ? 'What the asset was sold for (0 for a scrapped asset)' : undefined}
        />
        <Field name="documentNo" label="Document no." defaultValue={initial?.document_no ?? ''} placeholder="Invoice / reference (optional)" />
      </div>

      {postingType === 'Maintenance' ? (
        <Field
          name="maintenanceCode" label="Maintenance code" type="select" required
          defaultValue={initial?.maintenance_code ?? ''}
          options={[{ value: '', label: 'Pick a code…' }, ...maintenance.map((m) => ({ value: m.code, label: `${m.code} — ${m.description}` }))]}
        />
      ) : null}

      {needsBal ? (
        <GlAccountSelect
          name="balancingGlAccountId" label="Balancing G/L account" required accounts={accounts}
          value={balId} onChange={setBalId}
          hint={
            postingType === 'Acquisition Cost' ? 'The Bank or Payables account funding the acquisition'
              : postingType === 'Maintenance' ? 'The Bank or Payables account the maintenance is paid from'
                : 'The account the disposal proceeds are received into'
          }
        />
      ) : (
        <div className="note">
          {postingType === 'Depreciation' ? 'Posts Dr Depreciation Expense / Cr Accum. Depreciation from the asset\'s FA Posting Group.'
            : postingType === 'Write-Down' ? 'Posts Dr Write-Down Expense / Cr Accum. Depreciation.'
              : 'Posts Dr Acquisition Cost / Cr Appreciation.'}
        </div>
      )}

      <Field name="description" label="Description" defaultValue={initial?.description ?? ''} placeholder="Optional" />
    </>
  );
}

export function NewFaJournalLineButton({ assets, accounts, maintenance, defaultBookCode }: {
  assets: EligibleAsset[]; accounts: GlAccount[]; maintenance: Maintenance[]; defaultBookCode: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>New FA journal line</button>
      {open ? (
        <FormModal
          title="New FA journal line" wide
          onClose={() => setOpen(false)}
          onSubmit={requestFaJournalLine}
          submitLabel="Save"
          successTitle="FA journal line captured"
          successDetail={(d) => `${d.no} saved — send it for approval when ready`}
        >
          <LineFields assets={assets} accounts={accounts} maintenance={maintenance} defaultBookCode={defaultBookCode} />
        </FormModal>
      ) : null}
    </>
  );
}

export function EditFaJournalLineButton({ line, assets, accounts, maintenance, defaultBookCode, className = 'btn ghost sm' }: {
  line: FaJournalLineView; assets: EligibleAsset[]; accounts: GlAccount[]; maintenance: Maintenance[];
  defaultBookCode: string | null; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Edit</button>
      {open ? (
        <FormModal
          title={`Edit ${line.no}`} wide
          onClose={() => setOpen(false)}
          onSubmit={(v) => saveFaJournalLine(line.no, v)}
          submitLabel="Save changes"
          successTitle="FA journal line updated"
        >
          <LineFields assets={assets} accounts={accounts} maintenance={maintenance} defaultBookCode={defaultBookCode} initial={line} />
        </FormModal>
      ) : null}
    </>
  );
}

export function SubmitFaButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => submitFaJournalLineRequest(no), {
        confirm: { title: 'Send this line for approval?', message: 'It can no longer be edited while pending.', confirmLabel: 'Send for approval' },
        successTitle: (d) => (d.autoApproved ? 'Approved — ready to post' : 'Sent for approval'),
      })}>
      {busy ? 'Working…' : 'Send for approval'}
    </button>
  );
}

export function CancelFaApprovalButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => cancelFaJournalLineApprovalRequest(no), {
        confirm: { title: 'Recall this line?', message: 'It goes back to Open so you can amend and resubmit it.', confirmLabel: 'Recall' },
        successTitle: 'Recalled — back to Open',
      })}>
      {busy ? 'Working…' : 'Cancel approval request'}
    </button>
  );
}

export function ApproveFaButton({ no, className = 'btn sm' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => approveFaJournalLineRequest(no), {
        confirm: { title: 'Approve this line?', message: 'It becomes ready to post. Nothing moves until it is posted.', confirmLabel: 'Approve' },
        successTitle: 'Approved — ready to post',
      })}>
      {busy ? 'Working…' : 'Approve'}
    </button>
  );
}

export function RejectFaButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Reject</button>
      {open ? (
        <FormModal
          title="Reject FA journal line"
          onClose={() => setOpen(false)}
          onSubmit={(v) => rejectFaJournalLineRequest(no, String(v.reason || ''))}
          submitLabel="Reject" submitClass="btn danger"
          successTitle="Rejected — back to Open" resultStyle="popup"
        >
          <Field name="reason" label="Reason" type="textarea" required />
        </FormModal>
      ) : null}
    </>
  );
}

export function ReopenFaButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => reopenFaJournalLineRequest(no), {
        confirm: { title: 'Reopen this line?', message: 'It goes back to Open for amendment. It must be approved again before posting.', confirmLabel: 'Reopen' },
        successTitle: 'Reopened — back to Open',
      })}>
      {busy ? 'Working…' : 'Reopen'}
    </button>
  );
}

export function PostFaButton({ no, className = 'btn sm' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => postFaJournalLineRequest(no), {
        confirm: {
          title: 'Post this FA journal line?',
          message: 'The FA ledger and the G/L move immediately. This cannot be undone from here.',
          confirmLabel: 'Post',
        },
        successTitle: 'FA journal line posted',
        successDetail: (d) => (d.journalNo ? `Journal ${d.journalNo} posted` : 'Posted'),
      })}>
      {busy ? 'Working…' : 'Post'}
    </button>
  );
}

export function DeleteFaButton({ no, className = 'btn sm ghost' }: { no: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteFaJournalLineRequest(no), {
        confirm: { title: 'Delete this line?', message: 'It is removed permanently. Only an open line can be deleted.', confirmLabel: 'Delete' },
        successTitle: 'Deleted',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}
