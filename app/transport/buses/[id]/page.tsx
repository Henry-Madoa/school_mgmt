import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getBus, listDrivers, listRoutes, listVehicleAssets, listWorkTickets, listRiders, listBuses, fleetSummary } from '@/lib/transport';
import { formatDate, today } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { EditableCard } from '@/components/ui/editable-card';
import { BusEditForm, OpenWorkTicketButton } from '../../transport-forms';

const PURPOSE: Record<string, string> = { ROUTE_RUN: 'Route run', TRIP: 'Trip', MAINTENANCE: 'Maintenance' };

export default async function BusPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('TRANSPORT_READ');
  const { id: idParam } = await params;
  const id = Number(idParam);
  const bus = await getBus(id);
  if (!bus) notFound();
  const yearStart = `${today().slice(0, 4)}-01-01`;
  const [canManage, canTickets, drivers, routes, assets, tickets, riders, buses, fleet] = await Promise.all([
    currentCanAction('TRANSPORT_MANAGE'), currentCanAction('TRANSPORT_WORK_TICKETS'), listDrivers(), listRoutes(), listVehicleAssets(),
    listWorkTickets({ busId: id, limit: 50 }), bus.route_id ? listRiders(bus.route_id) : Promise.resolve([]), listBuses(), fleetSummary(yearStart, today()),
  ]);
  const routeOpts = routes.filter((r) => r.status === 'ACTIVE' || r.id === bus.route_id).map((r) => ({ id: r.id, code: r.code, name: r.name }));
  const ytd = fleet.find((f) => f.bus_id === id);
  const open = tickets.find((t) => t.status === 'OPEN');
  const expired = (d: string | null) => !!d && d < today();

  return (
    <Page title={bus.registration_no} crumb={`${bus.asset_description}${bus.make_model ? ` · ${bus.make_model}` : ''} · ${bus.capacity} seats`} user={user}>
      <Toolbar>
        <Link href="/transport" className="btn ghost sm">← All buses</Link>
        <Spacer />
        {canTickets && bus.status === 'ACTIVE' && !open ? <OpenWorkTicketButton buses={buses} drivers={drivers} routes={routeOpts} defaultBusId={id} /> : null}
        {open ? <Link href={`/transport/work-tickets/${encodeURIComponent(open.no)}`} className="btn">Out on {open.no}</Link> : null}
      </Toolbar>
      <div className="grid g4">
        <Stat label="Status" value={open ? 'On the road' : bus.status === 'ACTIVE' ? 'In the yard' : bus.status === 'WORKSHOP' ? 'Workshop' : 'Retired'} accent={!!open} foot={bus.driver_name ? `Driver ${bus.driver_name}` : 'No driver assigned'} />
        <Stat label="Odometer" value={`${bus.odometer.toLocaleString()} km`} accent={false} foot={ytd ? `${ytd.km.toLocaleString()} km this year` : undefined} />
        <Stat label="Riders on route" value={String(bus.riders)} accent={bus.riders > bus.capacity} foot={bus.riders > bus.capacity ? `${bus.riders - bus.capacity} over capacity` : `${bus.capacity - bus.riders} seats free`} />
        <Stat label="Fuel this year" value={ytd ? `${ytd.litres.toLocaleString()} L` : '—'} accent={false} foot={ytd?.km_per_litre ? `${ytd.km_per_litre} km/L · ` : ''} />
      </div>
      <EditableCard title="Vehicle" sub="The registration, the fixed asset it depreciates under, its driver, its route and the papers that must be current before a ticket is issued" canEdit={canManage} form={<BusEditForm bus={bus} assets={assets} drivers={drivers} routes={routeOpts} />}>
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <DefinitionList items={[
              ['Registration', <span className="mono" key="r">{bus.registration_no}</span>],
              ['Fixed asset', <Link href={`/fixed-assets?q=${encodeURIComponent(bus.fixed_asset_no)}`} className="mono" key="fa">{bus.fixed_asset_no}</Link>],
              ['Make / model', bus.make_model ?? '—'], ['Seats', String(bus.capacity)],
              ['Status', <Pill key="s" status={bus.status} tone={bus.status === 'ACTIVE' ? 'ok' : bus.status === 'WORKSHOP' ? 'warn' : undefined} />],
            ]} />
          </section>
          <section className="dl-group">
            <DefinitionList items={[
              ['Driver', bus.driver_name ? <Link href={`/transport/drivers/${bus.driver_employee_id}`} key="d">{bus.driver_name} <span className="tiny mono">{bus.driver_employee_no}</span></Link> : <span className="muted-cell" key="d">Unassigned</span>],
              ['Route', bus.route_name ? <Link href={`/transport/routes/${bus.route_id}`} key="rt">{bus.route_code} — {bus.route_name}</Link> : '—'],
              ['Insurance expiry', <span key="i" style={expired(bus.insurance_expiry) ? { color: 'var(--danger)' } : undefined}>{bus.insurance_expiry ? formatDate(bus.insurance_expiry) : '—'}{expired(bus.insurance_expiry) ? ' (expired)' : ''}</span>],
              ['Inspection expiry', <span key="n" style={expired(bus.inspection_expiry) ? { color: 'var(--danger)' } : undefined}>{bus.inspection_expiry ? formatDate(bus.inspection_expiry) : '—'}{expired(bus.inspection_expiry) ? ' (expired)' : ''}</span>],
              ['Notes', bus.notes ?? '—'],
            ]} />
          </section>
        </div>
      </EditableCard>

      <Card>
        <CardHead title="Work tickets" sub="Every journey the bus makes — opened before it leaves, closed with the odometer and fuel on return" />
        {tickets.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Date</th><th>Purpose</th><th>Driver</th><th>Route / destination</th><th className="num">Out</th><th className="num">In</th><th className="num">km</th><th className="num">Fuel</th><th>Status</th></tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className={t.status === 'CANCELLED' ? 'muted' : undefined}>
                  <td className="mono"><Link href={`/transport/work-tickets/${encodeURIComponent(t.no)}`}>{t.no}</Link></td>
                  <td>{formatDate(t.date)}</td>
                  <td>{PURPOSE[t.purpose] ?? t.purpose}</td>
                  <td><Link href={`/transport/drivers/${t.driver_employee_id}`}>{t.driver_name}</Link></td>
                  <td>{t.route_name ?? t.destination ?? '—'}</td>
                  <td className="num">{t.odometer_start?.toLocaleString() ?? '—'}</td>
                  <td className="num">{t.odometer_end?.toLocaleString() ?? '—'}</td>
                  <td className="num">{t.distance_km ?? '—'}</td>
                  <td className="num">{t.fuel_litres ? `${t.fuel_litres} L` : '—'}</td>
                  <td><Pill status={t.status} tone={t.status === 'OPEN' ? 'warn' : t.status === 'CLOSED' ? 'ok' : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🎫" title="No work tickets yet" sub="Open one before the bus leaves the yard." />}
      </Card>

      <Card>
        <CardHead title="Riders" sub={bus.route_name ? `Students on ${bus.route_name}, by stop` : 'Assign a route to see who rides'} />
        {riders.length ? (
          <TableWrap>
            <thead><tr><th>Adm. No.</th><th>Student</th><th>Class</th><th>Stop</th><th>Direction</th><th>Guardian phone</th></tr></thead>
            <tbody>
              {riders.map((r) => (
                <tr key={r.id}>
                  <td className="mono"><Link href={`/students/view/${r.student_id}`}>{r.admission_no}</Link></td>
                  <td><b>{r.student_name}</b></td>
                  <td>{r.grade_level_name} {r.stream_name}</td>
                  <td>{r.stop_name ?? '—'}</td>
                  <td>{r.direction === 'BOTH' ? 'Both ways' : r.direction === 'MORNING' ? 'Morning only' : 'Evening only'}</td>
                  <td className="mono">{r.guardian_phone ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧒" title="No riders" sub="Students opt into transport on their own card, under Transport." />}
      </Card>
      {ytd ? <div className="note tiny">Year to date: {ytd.trips} closed ticket{ytd.trips === 1 ? '' : 's'}, {ytd.km.toLocaleString()} km, fuel <Money cents={ytd.fuel_cost} />.</div> : null}
    </Page>
  );
}
