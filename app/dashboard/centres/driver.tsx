import Link from 'next/link';
import { getDriver, listWorkTickets } from '@/lib/transport';
import { currentCanAction } from '@/lib/session';
import { formatDate, today } from '@/lib/format';
import { Card, CardHead, Pill, TableWrap } from '@/components/ui/primitives';

/**
 * A driver's corner of Self Service — their bus, their route, the ticket they are out on and the
 * last few journeys. Shown only when HR's employee has a driver profile under Transport.
 */
export async function DriverSections({ employeeId }: { employeeId: number }) {
  const driver = await getDriver(employeeId);
  if (!driver) return null;
  // Links into Transport only when the login can open it (TRANSPORT_READ); otherwise the table stands alone.
  const [tickets, canOpen] = await Promise.all([listWorkTickets({ driverId: employeeId, limit: 8 }), currentCanAction('TRANSPORT_READ')]);
  const open = tickets.find((t) => t.status === 'OPEN');
  const licenceDays = driver.licence_expiry ? Math.round((Date.parse(driver.licence_expiry) - Date.parse(today())) / 86_400_000) : null;
  return (
    <Card>
      <CardHead title="My bus" sub={driver.bus_registration_no ? `${driver.bus_registration_no}${driver.route_name ? ` · ${driver.route_name}` : ''}` : 'No bus assigned yet'}>
        {open ? (canOpen ? <Link href={`/transport/work-tickets/${encodeURIComponent(open.no)}`} className="btn sm">Out on {open.no}</Link> : <Pill tone="warn">Out on {open.no}</Pill>) : null}
      </CardHead>
      {licenceDays !== null && licenceDays <= 30 ? <div className="note tiny" style={{ color: 'var(--danger)' }}>Your driving licence {licenceDays < 0 ? `expired ${-licenceDays} days ago` : `expires in ${licenceDays} days`} — renew it and hand the copy to the transport office.</div> : null}
      {tickets.length ? (
        <TableWrap>
          <thead><tr><th>Ticket</th><th>Date</th><th>Bus</th><th>Route / destination</th><th className="num">km</th><th>Status</th></tr></thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td className="mono">{canOpen ? <Link href={`/transport/work-tickets/${encodeURIComponent(t.no)}`}>{t.no}</Link> : t.no}</td>
                <td>{formatDate(t.date)}</td><td>{t.registration_no}</td><td>{t.route_name ?? t.destination ?? '—'}</td>
                <td className="num">{t.distance_km ?? '—'}</td>
                <td><Pill status={t.status} tone={t.status === 'OPEN' ? 'warn' : t.status === 'CLOSED' ? 'ok' : undefined} /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <div className="tiny muted-cell">No work tickets yet.</div>}
    </Card>
  );
}
