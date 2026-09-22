import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listBuses, listRoutes, listDrivers, listWorkTickets, listVehicleAssets, listEmployeesNotDrivers, listRiders, expiringPapers, fleetSummary } from '@/lib/transport';
import { formatDate, today } from '@/lib/format';
import { addMonths } from '@/lib/dates';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, Stat, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { SelectFilter } from '@/components/ui/filters';
import { NewBusButton, NewRouteButton, NewDriverButton, OpenWorkTicketButton } from '../transport-forms';

const TABS: TabDefinition[] = [
  { key: 'buses', label: 'Buses' }, { key: 'routes', label: 'Routes' }, { key: 'drivers', label: 'Drivers' }, { key: 'work-tickets', label: 'Work Tickets' }, { key: 'riders', label: 'Riders' },
];

export default async function TransportPage({ params, searchParams }: { params: Promise<{ tab?: string[] }>; searchParams: Promise<{ status?: string; bus?: string; route?: string }> }) {
  const user = await requireAction('TRANSPORT_READ');
  const { tab: segments } = await params;
  const sp = await searchParams;
  const tab = segments?.[0] ?? 'buses';
  if (!TABS.some((t) => t.key === tab)) notFound();
  const hrefFor = (k: string) => `/transport/${k === 'buses' ? '' : k}`;
  const [canManage, canTickets] = await Promise.all([currentCanAction('TRANSPORT_MANAGE'), currentCanAction('TRANSPORT_WORK_TICKETS')]);
  const [buses, routes, drivers, papers] = await Promise.all([listBuses(), listRoutes(), listDrivers(), expiringPapers()]);
  const routeOpts = routes.filter((r) => r.status === 'ACTIVE').map((r) => ({ id: r.id, code: r.code, name: r.name }));

  return (
    <Page title="Transport" crumb="Routes and stops, the buses (fixed assets), the drivers (employees), who rides, and the work tickets behind every journey" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={hrefFor} />
      {papers.length ? (
        <div className="note" style={{ marginBottom: 12, color: 'var(--danger)' }}>
          ⚠ {papers.map((p) => `${p.kind} — ${p.who} (${p.days < 0 ? `expired ${-p.days} day${p.days === -1 ? '' : 's'} ago` : p.days === 0 ? 'expires today' : `expires in ${p.days} day${p.days === 1 ? '' : 's'}`})`).join(' · ')}
        </div>
      ) : null}

      {tab === 'buses' ? (
        <>
          <div className="grid g4">
            <Stat label="Buses on the road" value={String(buses.filter((b) => b.status === 'ACTIVE').length)} accent={false} foot={`${buses.filter((b) => b.status === 'WORKSHOP').length} in the workshop`} />
            <Stat label="Seats" value={String(buses.filter((b) => b.status === 'ACTIVE').reduce((a, b) => a + b.capacity, 0))} accent={false} />
            <Stat label="Riders" value={String(routes.reduce((a, r) => a + r.riders, 0))} />
            <Stat label="Tickets open" value={String(buses.reduce((a, b) => a + b.open_tickets, 0))} accent={buses.some((b) => b.open_tickets > 0)} />
          </div>
          <Toolbar><Spacer />{canManage ? <NewBusButton assets={await listVehicleAssets()} drivers={drivers} routes={routeOpts} /> : null}</Toolbar>
          <Card>
            {buses.length ? (
              <TableWrap>
                <thead><tr><th>Registration</th><th>Vehicle (fixed asset)</th><th className="num">Seats</th><th>Driver</th><th>Route</th><th className="num">Riders</th><th className="num">Odometer</th><th>Status</th></tr></thead>
                <tbody>
                  {buses.map((b) => (
                    <tr key={b.id} className={b.status === 'RETIRED' ? 'muted' : undefined}>
                      <td className="mono"><Link href={`/transport/buses/${b.id}`}><b>{b.registration_no}</b></Link></td>
                      <td>{b.asset_description} <Link href={`/fixed-assets?q=${encodeURIComponent(b.fixed_asset_no)}`} className="tiny mono">{b.fixed_asset_no}</Link></td>
                      <td className="num">{b.capacity}</td>
                      <td>{b.driver_name ? <Link href={`/transport/drivers/${b.driver_employee_id}`}>{b.driver_name}</Link> : <span className="muted-cell">Unassigned</span>}</td>
                      <td>{b.route_name ?? '—'}</td>
                      <td className="num">{b.riders}{b.capacity && b.riders > b.capacity ? <Pill tone="bad">over</Pill> : null}</td>
                      <td className="num">{b.odometer.toLocaleString()} km</td>
                      <td>{b.open_tickets ? <Pill tone="warn">Out</Pill> : <Pill status={b.status} tone={b.status === 'ACTIVE' ? 'ok' : b.status === 'WORKSHOP' ? 'warn' : undefined} />}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="🚌" title="No buses yet" sub="Register the vehicle under Fixed Assets first, then add it here with its driver and route." />}
          </Card>
        </>
      ) : null}

      {tab === 'routes' ? (
        <>
          <Toolbar><Spacer />{canManage ? <NewRouteButton /> : null}</Toolbar>
          <Card>
            {routes.length ? (
              <TableWrap>
                <thead><tr><th>Code</th><th>Route</th><th>Stops</th><th>Buses</th><th className="num">Riders</th><th className="num">Termly fare</th><th>Status</th></tr></thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={r.id} className={r.status === 'ACTIVE' ? undefined : 'muted'}>
                      <td className="mono"><Link href={`/transport/routes/${r.id}`}><b>{r.code}</b></Link></td>
                      <td><Link href={`/transport/routes/${r.id}`}>{r.name}</Link>{r.description ? <div className="tiny">{r.description}</div> : null}</td>
                      <td className="tiny">{r.stops.map((s) => s.name).join(' → ') || '—'}</td>
                      <td>{r.buses.length ? r.buses.map((b) => `${b.registration_no}${b.driver_name ? ` (${b.driver_name})` : ''}`).join(', ') : <span className="muted-cell">None</span>}</td>
                      <td className="num">{r.riders}</td>
                      <td className="num">{Number(r.term_fare) ? <Money cents={r.term_fare} /> : <span className="tiny muted-cell">fee structure</span>}</td>
                      <td><Pill status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="🗺" title="No routes yet" />}
          </Card>
        </>
      ) : null}

      {tab === 'drivers' ? (
        <>
          <Toolbar><Spacer />{canManage ? <NewDriverButton employees={await listEmployeesNotDrivers()} /> : null}</Toolbar>
          <Card>
            <CardHead title="Drivers" sub="Employees with a driver profile — the licence and PSV badge the transport office checks before a ticket is issued" />
            {drivers.length ? (
              <TableWrap>
                <thead><tr><th>Employee No.</th><th>Driver</th><th>Licence</th><th>Licence expiry</th><th>PSV badge</th><th>Bus</th><th>Route</th><th>Status</th></tr></thead>
                <tbody>
                  {drivers.map((d) => {
                    const expired = !!d.licence_expiry && d.licence_expiry < today();
                    return (
                      <tr key={d.id}>
                        <td className="mono"><Link href={`/transport/drivers/${d.employee_id}`}>{d.employee_no}</Link></td>
                        <td><Link href={`/transport/drivers/${d.employee_id}`}><b>{d.first_name} {d.last_name}</b></Link><div className="tiny">{d.phone ?? ''}</div></td>
                        <td className="mono">{d.licence_no}{d.licence_class ? <span className="tiny"> · {d.licence_class}</span> : null}</td>
                        <td>{d.licence_expiry ? <span style={expired ? { color: 'var(--danger)' } : undefined}>{formatDate(d.licence_expiry)}</span> : '—'}</td>
                        <td className="mono">{d.psv_badge_no ?? '—'}{d.psv_expiry ? <div className="tiny">to {formatDate(d.psv_expiry)}</div> : null}</td>
                        <td>{d.bus_registration_no ? <Link href={`/transport/buses/${d.bus_id}`} className="mono">{d.bus_registration_no}</Link> : <span className="muted-cell">—</span>}</td>
                        <td>{d.route_name ?? '—'}</td>
                        <td>{d.open_tickets ? <Pill tone="warn">On the road</Pill> : <Pill status={d.employee_status} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="🧑‍✈️" title="No drivers yet" sub="Drivers are employees — onboard them under HR, then add their licence here." />}
          </Card>
        </>
      ) : null}

      {tab === 'work-tickets' ? <WorkTicketsTab status={sp.status} busId={sp.bus} buses={buses} drivers={drivers} routes={routeOpts} canTickets={canTickets} /> : null}
      {tab === 'riders' ? <RidersTab routeId={sp.route} routes={routes.map((r) => ({ id: r.id, code: r.code, name: r.name }))} /> : null}
    </Page>
  );
}

async function WorkTicketsTab({ status, busId, buses, drivers, routes, canTickets }: { status?: string; busId?: string; buses: Awaited<ReturnType<typeof listBuses>>; drivers: Awaited<ReturnType<typeof listDrivers>>; routes: { id: number; code: string; name: string }[]; canTickets: boolean }) {
  const [tickets, fleet] = await Promise.all([
    listWorkTickets({ status: status || null, busId: busId ? Number(busId) : null }),
    fleetSummary(addMonths(today(), -1).slice(0, 10), today()),
  ]);
  return (
    <>
      <div className="grid g4">
        {fleet.slice(0, 4).map((f) => <Stat key={f.bus_id} label={`${f.registration_no} — last 30 days`} value={`${f.km.toLocaleString()} km`} accent={false} foot={`${f.trips} trips · ${f.litres.toFixed(0)} L · ${f.km_per_litre ? `${f.km_per_litre} km/L` : '—'}`} />)}
      </div>
      <Toolbar>
        <SelectFilter paramName="status" label="Status" allLabel="All" options={[{ value: 'OPEN', label: 'Open' }, { value: 'CLOSED', label: 'Closed' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
        <SelectFilter paramName="bus" label="Bus" allLabel="All buses" options={buses.map((b) => ({ value: String(b.id), label: b.registration_no }))} />
        <Spacer />
        {canTickets ? <OpenWorkTicketButton buses={buses} drivers={drivers} routes={routes} /> : null}
      </Toolbar>
      <Card>
        <CardHead title="Work tickets" sub="Every journey authorised, with the odometer out and in, fuel and cost on return" />
        {tickets.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Date</th><th>Bus</th><th>Driver</th><th>Purpose</th><th className="num">Out</th><th className="num">In</th><th className="num">km</th><th className="num">Fuel</th><th>Status</th></tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className={t.status === 'CANCELLED' ? 'muted' : undefined}>
                  <td className="mono"><Link href={`/transport/work-tickets/${encodeURIComponent(t.no)}`}>{t.no}</Link></td>
                  <td>{formatDate(t.date)}</td>
                  <td className="mono">{t.registration_no}</td>
                  <td>{t.driver_name}</td>
                  <td>{t.purpose === 'ROUTE_RUN' ? `Route — ${t.route_name ?? '—'}` : t.purpose === 'TRIP' ? `Trip — ${t.destination ?? ''}` : `Workshop — ${t.destination ?? ''}`}</td>
                  <td className="num">{t.odometer_start ?? '—'}</td>
                  <td className="num">{t.odometer_end ?? '—'}</td>
                  <td className="num">{t.distance_km ?? '—'}</td>
                  <td className="num">{t.fuel_litres ? `${t.fuel_litres} L · ` : ''}{Number(t.fuel_cost) ? <Money cents={t.fuel_cost} /> : '—'}</td>
                  <td><Pill status={t.status} tone={t.status === 'OPEN' ? 'warn' : t.status === 'CLOSED' ? 'ok' : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🎫" title="No work tickets" />}
      </Card>
    </>
  );
}

async function RidersTab({ routeId, routes }: { routeId?: string; routes: { id: number; code: string; name: string }[] }) {
  const riders = await listRiders(routeId ? Number(routeId) : null);
  return (
    <>
      <Toolbar>
        <SelectFilter paramName="route" label="Route" allLabel="All routes" options={routes.map((r) => ({ value: String(r.id), label: `${r.code} — ${r.name}` }))} />
        <Spacer />
        <span className="tiny">Students are put on a route from their card (Transport) — the TRANSPORT fee item is billed from the next run.</span>
      </Toolbar>
      <Card>
        {riders.length ? (
          <TableWrap>
            <thead><tr><th>Adm. No.</th><th>Student</th><th>Class</th><th>Route</th><th>Stop</th><th>Direction</th><th>Guardian phone</th></tr></thead>
            <tbody>
              {riders.map((r) => (
                <tr key={r.id}>
                  <td className="mono"><Link href={`/students/view/${r.student_id}`}>{r.admission_no}</Link></td>
                  <td><b>{r.student_name}</b></td>
                  <td>{r.grade_level_name} {r.stream_name}</td>
                  <td>{r.route_name}</td>
                  <td>{r.stop_name ?? '—'}</td>
                  <td>{r.direction === 'BOTH' ? 'Both ways' : r.direction === 'MORNING' ? 'Morning only' : 'Evening only'}</td>
                  <td className="mono">{r.guardian_phone ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🎒" title="No riders" />}
      </Card>
    </>
  );
}
