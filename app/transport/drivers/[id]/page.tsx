import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getDriver, listWorkTickets } from '@/lib/transport';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { EditableCard } from '@/components/ui/editable-card';
import { DriverEditForm, RemoveDriverButton } from '../../transport-forms';

const PURPOSE: Record<string, string> = { ROUTE_RUN: 'Route run', TRIP: 'Trip', MAINTENANCE: 'Maintenance' };

export default async function DriverPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('TRANSPORT_READ');
  const { id: idParam } = await params;
  const employeeId = Number(idParam);
  const driver = await getDriver(employeeId);
  if (!driver) notFound();
  const [canManage, tickets] = await Promise.all([currentCanAction('TRANSPORT_MANAGE'), listWorkTickets({ driverId: employeeId, limit: 50 })]);
  const closed = tickets.filter((t) => t.status === 'CLOSED');
  const km = closed.reduce((a, t) => a + (t.distance_km ?? 0), 0);
  const litres = closed.reduce((a, t) => a + Number(t.fuel_litres || 0), 0);
  const fuelCost = closed.reduce((a, t) => a + Number(t.fuel_cost || 0), 0);
  const days = (d: string | null) => (d ? Math.round((new Date(d).getTime() - new Date(today()).getTime()) / 86_400_000) : null);
  const paper = (d: string | null) => {
    const n = days(d);
    if (n === null) return <span className="muted-cell">Not recorded</span>;
    const tone = n < 0 ? 'bad' : n <= 30 ? 'warn' : 'ok';
    return <span>{formatDate(d!)} <Pill tone={tone}>{n < 0 ? `expired ${-n} d ago` : n === 0 ? 'expires today' : n <= 30 ? `${n} d left` : 'valid'}</Pill></span>;
  };
  const roadworthy = driver.employee_status === 'ACTIVE' && (days(driver.licence_expiry) ?? -1) >= 0 && (driver.psv_expiry === null || (days(driver.psv_expiry) ?? -1) >= 0);

  return (
    <Page title={`${driver.first_name} ${driver.last_name}`} crumb={`Driver · ${driver.employee_no}${driver.bus_registration_no ? ` · ${driver.bus_registration_no}` : ''}`} user={user}>
      <Toolbar>
        <Link href="/transport/drivers" className="btn ghost sm">← All drivers</Link>
        <Spacer />
        <Link href={`/employees/view/${employeeId}`} className="btn ghost">HR record</Link>
        {canManage && !driver.bus_id && !driver.open_tickets ? <RemoveDriverButton employeeId={employeeId} /> : null}
      </Toolbar>
      <div className="grid g4">
        <Stat label="Fit to drive" value={roadworthy ? 'Yes' : 'No'} accent={!roadworthy} foot={roadworthy ? 'Licence and PSV badge current' : driver.employee_status !== 'ACTIVE' ? `Employee ${driver.employee_status}` : 'A paper has expired — no ticket can be issued'} />
        <Stat label="Bus" value={driver.bus_registration_no ?? '—'} accent={false} foot={driver.route_name ?? 'No route'} />
        <Stat label="Journeys" value={String(closed.length)} accent={false} foot={`${km.toLocaleString()} km on closed tickets`} />
        <Stat label="Fuel" value={`${litres.toLocaleString()} L`} accent={false} foot={<Money cents={fuelCost} />} />
      </div>
      <EditableCard title="Road credentials" sub="The driving licence and PSV badge the transport office checks before every ticket; HR owns the employment record" canEdit={canManage} form={<DriverEditForm driver={driver} />}>
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <DefinitionList items={[
              ['Employee', <Link href={`/employees/view/${employeeId}`} key="e"><span className="mono">{driver.employee_no}</span> · <Pill status={driver.employee_status} /></Link>],
              ['Phone', <span className="mono" key="p">{driver.phone ?? '—'}</span>],
              ['Licence no.', <span className="mono" key="l">{driver.licence_no}</span>], ['Licence class', driver.licence_class ?? '—'],
              ['Licence expiry', paper(driver.licence_expiry)],
            ]} />
          </section>
          <section className="dl-group">
            <DefinitionList items={[
              ['PSV badge', driver.psv_badge_no ? <span className="mono" key="b">{driver.psv_badge_no}</span> : '—'], ['PSV expiry', paper(driver.psv_expiry)],
              ['Assigned bus', driver.bus_id ? <Link href={`/transport/buses/${driver.bus_id}`} key="bus">{driver.bus_registration_no}</Link> : <span className="muted-cell" key="bus">None — set the driver on a bus card</span>],
              ['Route', driver.route_name ?? '—'], ['Notes', driver.notes ?? '—'],
            ]} />
          </section>
        </div>
      </EditableCard>

      <Card>
        <CardHead title="Work tickets" sub="Every journey this driver has been issued" />
        {tickets.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Date</th><th>Bus</th><th>Purpose</th><th>Route / destination</th><th className="num">km</th><th className="num">Fuel</th><th>Status</th></tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className={t.status === 'CANCELLED' ? 'muted' : undefined}>
                  <td className="mono"><Link href={`/transport/work-tickets/${encodeURIComponent(t.no)}`}>{t.no}</Link></td>
                  <td>{formatDate(t.date)}</td>
                  <td><Link href={`/transport/buses/${t.bus_id}`}>{t.registration_no}</Link></td>
                  <td>{PURPOSE[t.purpose] ?? t.purpose}</td>
                  <td>{t.route_name ?? t.destination ?? '—'}</td>
                  <td className="num">{t.distance_km ?? '—'}</td>
                  <td className="num">{t.fuel_litres ? `${t.fuel_litres} L` : '—'}</td>
                  <td><Pill status={t.status} tone={t.status === 'OPEN' ? 'warn' : t.status === 'CLOSED' ? 'ok' : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🎫" title="No work tickets yet" />}
      </Card>
    </Page>
  );
}
