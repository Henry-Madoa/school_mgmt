import { requireAction } from '@/lib/session';
import { getStudentTransport, getRoute } from '@/lib/transport';
import { studentBed } from '@/lib/hostel';
import { studentLoans } from '@/lib/library';
import { formatDate } from '@/lib/format';
import { Card, CardHead, DefinitionList, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { loadPortalScope, isPortalScope } from '../context';
import { PortalShell } from '../portal-shell';

/** The bus, the bed and the books — what a parent asks the office about most after fees. */
export default async function PortalServicesPage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const user = await requireAction('STUDENT_PORTAL_VIEW');
  const sp = await searchParams;
  const scope = await loadPortalScope(user, sp.student);
  const student = isPortalScope(scope) ? scope.student : null;
  const [ride, bed, loans] = student ? await Promise.all([getStudentTransport(student.id), studentBed(student.id), studentLoans(student.id)]) : [undefined, undefined, []];
  const route = ride ? await getRoute(ride.route_id) : undefined;
  const out = loans.filter((l) => l.status === 'ON_LOAN');
  const fines = loans.filter((l) => Number(l.fine_amount) > 0).reduce((a, l) => a + Number(l.fine_amount), 0);
  return (
    <PortalShell user={user} title="Transport, boarding & library" scope={scope}>
      {student ? (
        <>
          <Card>
            <CardHead title="School bus" sub={ride ? `${ride.route_name}` : 'Not on school transport'} />
            {ride && route ? (
              <div className="grid g2 dl-groups">
                <section className="dl-group"><DefinitionList items={[['Route', `${route.code} — ${route.name}`], ['Stop', ride.stop_name ?? 'Any stop on the route'], ['Rides', ride.direction === 'BOTH' ? 'Morning and evening' : ride.direction === 'MORNING' ? 'Morning only' : 'Evening only'], ['Bus', route.buses.map((b) => `${b.registration_no}${b.driver_name ? ` (driver ${b.driver_name})` : ''}`).join(', ') || 'To be assigned']]} /></section>
                <section className="dl-group">
                  <TableWrap>
                    <thead><tr><th>Stop</th><th>Pick-up</th><th>Drop-off</th></tr></thead>
                    <tbody>{route.stops.map((s) => <tr key={s.id} className={ride.stop_id === s.id ? undefined : 'muted'}><td>{ride.stop_id === s.id ? <b>{s.name}</b> : s.name}</td><td className="mono">{s.pickup_time ?? '—'}</td><td className="mono">{s.dropoff_time ?? '—'}</td></tr>)}</tbody>
                  </TableWrap>
                </section>
              </div>
            ) : <div className="tiny muted-cell">Ask the office to put {student.first_name} on a route; the termly transport charge is then added to the fee invoice.</div>}
          </Card>
          <Card>
            <CardHead title="Boarding" sub={bed ? bed.hostel_name : student.boarding_status === 'BOARDER' ? 'Boarder — bed not yet allocated' : 'Day scholar'} />
            {bed ? <DefinitionList items={[['House', bed.hostel_name], ['Room', bed.room_name], ['Bed', bed.bed_label], ['Since', formatDate(bed.from_date)]]} /> : null}
          </Card>
          <Card>
            <CardHead title="Library" sub={out.length ? `${out.length} book${out.length === 1 ? '' : 's'} out` : 'No books out'} />
            {loans.length ? (
              <TableWrap>
                <thead><tr><th>Title</th><th>Issued</th><th>Due</th><th>Returned</th><th className="num">Fine</th><th>Status</th></tr></thead>
                <tbody>
                  {loans.map((l) => (
                    <tr key={l.id} className={l.status === 'ON_LOAN' ? undefined : 'muted'}>
                      <td><b>{l.title}</b>{l.author ? <div className="tiny">{l.author}</div> : null}</td>
                      <td>{formatDate(l.issued_on)}</td>
                      <td style={l.status === 'ON_LOAN' && l.days_overdue > 0 ? { color: 'var(--danger)' } : undefined}>{formatDate(l.due_on)}{l.status === 'ON_LOAN' && l.days_overdue > 0 ? ` (${l.days_overdue} d overdue)` : ''}</td>
                      <td>{l.returned_on ? formatDate(l.returned_on) : '—'}</td>
                      <td className="num">{Number(l.fine_amount) ? <Money cents={l.fine_amount} /> : '—'}</td>
                      <td><Pill status={l.status} tone={l.status === 'ON_LOAN' ? (l.days_overdue > 0 ? 'bad' : 'info') : l.status === 'RETURNED' ? 'ok' : 'warn'} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="📚" title="Nothing borrowed yet" />}
            {fines > 0 ? <div className="note tiny">Fines to date: <Money cents={fines} />. A fine charged to the fee account shows on the fee statement.</div> : null}
          </Card>
        </>
      ) : null}
    </PortalShell>
  );
}
