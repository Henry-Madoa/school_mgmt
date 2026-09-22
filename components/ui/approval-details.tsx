import { Fragment } from 'react';
import { CollapsibleCard } from './collapsible-card';
import { DefinitionList, EmptyState, Pill, TableWrap } from './primitives';
import { formatDateTime } from '@/lib/format';
import type { IsoDateTime, WorkflowTaskWithApprover } from '@/lib/types';

/*
 * Business Central's Approval Details FastTab: who sent the document for approval and when, the
 * approver it is sitting with, each step's decision, and the comment behind a rejection. The
 * document's own Status only ever says Open | Pending Approval | Released — the rejection lives
 * here and in the header's decision_reason, which is why a rejected document reads as Open in the
 * status column but is filed under Rejected in the list.
 *
 * A step routed to an approval *group* clears one sequence level at a time, so each level that
 * has already signed off is listed beneath its step rather than being lost behind the last
 * decision.
 */
export function ApprovalDetailsCard({
  tasks, status, decisionReason, createdBy, createdAt, subject = 'document',
}: {
  tasks: WorkflowTaskWithApprover[];
  /** The document's own status, for the summary line. */
  status: string;
  /** The reason captured when an approver last rejected it, if that is where it stands. */
  decisionReason?: string | null;
  createdBy?: string | null;
  createdAt?: IsoDateTime | null;
  subject?: string;
}) {
  const pending = tasks.find((t) => t.status === 'PENDING');
  const rejected = tasks.filter((t) => t.status === 'REJECTED').at(-1);
  const steps = tasks.length;

  return (
    <CollapsibleCard
      title="Approval details"
      sub={steps
        ? `${steps} approval step${steps === 1 ? '' : 's'} routed${pending ? ` · pending with ${pending.pending_with ?? '—'}` : ''}`
        : `This ${subject} has not been sent for approval`}
    >
      <DefinitionList items={[
        ['Status', <Pill status={status} key="status" />],
        ['Created by', createdBy || '—'],
        ['Created on', createdAt ? formatDateTime(createdAt) : '—'],
        ['Sent for approval by', tasks[0]?.requested_by || '—'],
        ['Sent on', tasks[0] ? formatDateTime(tasks[0].requested_at) : '—'],
        pending ? ['Pending with', pending.pending_with || '—'] : null,
        decisionReason
          ? ['Rejected because', <span className="bad" key="reason">{decisionReason}</span>]
          : null,
        rejected?.decided_by ? ['Rejected by', `${rejected.decided_by} on ${formatDateTime(rejected.decided_at)}`] : null,
      ]} />

      {steps ? (
        <TableWrap>
          <thead>
            <tr>
              <th style={{ width: 60 }}>Step</th><th>Sent by</th><th>Sent on</th>
              <th>Approver</th><th>Decided on</th><th>Comment</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <td className="num">{t.step_no}</td>
                  <td>{t.requested_by || '—'}</td>
                  <td>{formatDateTime(t.requested_at)}</td>
                  <td className="muted-cell">{t.decided_by || t.pending_with || '—'}</td>
                  <td>{t.decided_at ? formatDateTime(t.decided_at) : '—'}</td>
                  <td>{t.comment || '—'}</td>
                  <td><Pill status={t.status} /></td>
                </tr>
                {t.level_decisions.map((d) => (
                  <tr key={`${t.id}-${d.sequence}`} className="muted">
                    <td />
                    <td colSpan={2} className="tiny">Level {d.sequence} cleared</td>
                    <td className="muted-cell">{d.decided_by}</td>
                    <td>{formatDateTime(d.decided_at)}</td>
                    <td>{d.comment || '—'}</td>
                    <td><Pill status="APPROVED" /></td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <EmptyState
          icon="🕓"
          title="No approval history"
          sub={`Send this ${subject} for approval and every step will be recorded here`}
        />
      )}
    </CollapsibleCard>
  );
}
