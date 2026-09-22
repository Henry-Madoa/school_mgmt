'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { useRunAction } from '@/components/ui/run-action';
import { setStudentTransportRequest } from '@/app/actions/services';
import { StudentBedForm, VacateBedButton } from '@/app/hostel/hostel-forms';
import type { RiderView, TransportRouteView, BedAllocationView, BedView, LibraryLoanView } from '@/lib/types';

/**
 * School services on the student card — the bus the student rides, the bed a boarder sleeps in,
 * and the books out in their name. Each section edits in place.
 */
export function ServicesCard({ studentId, boarder, ride, routes, canTransport, bed, freeBeds, canHostel, loans, canLibrary }: {
  studentId: number; boarder: boolean;
  ride: RiderView | null; routes: TransportRouteView[]; canTransport: boolean;
  bed: BedAllocationView | null; freeBeds: BedView[]; canHostel: boolean;
  loans: LibraryLoanView[]; canLibrary: boolean;
}) {
  return (
    <div className="card">
      <div className="card-head"><div><h3>School services</h3><div className="card-sub">Transport, boarding and the library</div></div></div>
      <div className="grid g3">
        <TransportSection studentId={studentId} ride={ride} routes={routes} canEdit={canTransport} />
        <BedSection studentId={studentId} boarder={boarder} bed={bed} freeBeds={freeBeds} canEdit={canHostel} />
        <LibrarySection loans={loans} canEdit={canLibrary} />
      </div>
    </div>
  );
}

function TransportSection({ studentId, ride, routes, canEdit }: { studentId: number; ride: RiderView | null; routes: TransportRouteView[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [routeId, setRouteId] = useState(String(ride?.route_id ?? ''));
  const { run, busy } = useRunAction();
  const route = routes.find((r) => String(r.id) === routeId);
  return (
    <section>
      <div className="hint" style={{ marginBottom: 6 }}>🚌 Transport</div>
      {editing ? (
        <FormModal inline title="" onClose={() => setEditing(false)} onSubmit={(v) => setStudentTransportRequest(studentId, v)} submitLabel="Save" resultStyle="popup" successTitle="Transport saved" successDetail="The Transport fee item is opted in for the next invoice run">
          <Field name="route_id" label="Route" type="select" required defaultValue={routeId} options={[{ value: '', label: 'Pick a route…' }, ...routes.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))]} onChange={(e) => setRouteId(e.target.value)} />
          <Field name="stop_id" label="Stop" type="select" defaultValue={ride?.stop_id ?? ''} options={[{ value: '', label: '— any —' }, ...(route?.stops ?? []).map((s) => ({ value: s.id, label: `${s.name}${s.pickup_time ? ` (${s.pickup_time})` : ''}` }))]} />
          <Field name="direction" label="Rides" type="select" defaultValue={ride?.direction ?? 'BOTH'} options={[{ value: 'BOTH', label: 'Both ways' }, { value: 'MORNING', label: 'Morning only' }, { value: 'EVENING', label: 'Evening only' }]} />
          <Field name="note" label="Note" defaultValue={ride?.note} placeholder="e.g. met by grandmother at the stop" />
        </FormModal>
      ) : ride ? (
        <>
          <div><Link href={`/transport/routes/${ride.route_id}`}><b>{ride.route_name}</b></Link></div>
          <div className="tiny">{ride.stop_name ? `Stop: ${ride.stop_name} · ` : ''}{ride.direction === 'BOTH' ? 'Both ways' : ride.direction === 'MORNING' ? 'Morning only' : 'Evening only'}</div>
          {ride.note ? <div className="tiny muted-cell">{ride.note}</div> : null}
          {canEdit ? (
            <div className="inline" style={{ gap: 4, marginTop: 6 }}>
              <button type="button" className="btn sm ghost" onClick={() => setEditing(true)}>Change</button>
              <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => setStudentTransportRequest(studentId, { route_id: '' }), { confirm: { title: 'Stop riding the bus?', message: 'The Transport fee item is opted out from the next run.', confirmLabel: 'Stop' }, successTitle: 'Taken off the bus' })}>{busy ? '…' : 'Stop riding'}</button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="tiny muted-cell">Does not use school transport.</div>
          {canEdit && routes.length ? <button type="button" className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setEditing(true)}>Put on a route</button> : null}
        </>
      )}
    </section>
  );
}

function BedSection({ studentId, boarder, bed, freeBeds, canEdit }: { studentId: number; boarder: boolean; bed: BedAllocationView | null; freeBeds: BedView[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <section>
      <div className="hint" style={{ marginBottom: 6 }}>🛏 Boarding</div>
      {editing ? <StudentBedForm studentId={studentId} freeBeds={freeBeds} onDone={() => setEditing(false)} /> : bed ? (
        <>
          <div><b>{bed.hostel_name}</b> · {bed.room_name} · Bed {bed.bed_label}</div>
          <div className="tiny">Since {bed.from_date}</div>
          {canEdit ? <div className="inline" style={{ gap: 4, marginTop: 6 }}><button type="button" className="btn sm ghost" onClick={() => setEditing(true)}>Move</button><VacateBedButton allocationId={bed.id} label={`bed ${bed.bed_label}`} /></div> : null}
        </>
      ) : boarder ? (
        <>
          <div className="tiny" style={{ color: 'var(--danger)' }}>Boarder without a bed.</div>
          {canEdit ? <button type="button" className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setEditing(true)}>Allocate a bed</button> : null}
        </>
      ) : <div className="tiny muted-cell">Day scholar.</div>}
    </section>
  );
}

function LibrarySection({ loans, canEdit }: { loans: LibraryLoanView[]; canEdit: boolean }) {
  const out = loans.filter((l) => l.status === 'ON_LOAN');
  const fines = loans.filter((l) => Number(l.fine_amount) > 0 && !l.fine_invoice_no).reduce((a, l) => a + Number(l.fine_amount), 0);
  return (
    <section>
      <div className="hint" style={{ marginBottom: 6 }}>📚 Library</div>
      {out.length ? out.map((l) => (
        <div key={l.id} className="tiny" style={{ marginBottom: 4 }}>
          <b>{l.title}</b> <span className="mono">{l.accession_no}</span> · due {l.due_on}{l.days_overdue > 0 ? <Pill tone="bad">{l.days_overdue} d overdue</Pill> : null}
        </div>
      )) : <div className="tiny muted-cell">No books out.</div>}
      {fines > 0 ? <div className="tiny" style={{ marginTop: 4 }}>Fines not yet charged: <Money cents={fines} /></div> : null}
      {canEdit ? <Link href="/library/loans" className="btn sm ghost" style={{ marginTop: 6, display: 'inline-block' }}>Loan desk</Link> : null}
    </section>
  );
}
