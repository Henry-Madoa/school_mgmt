import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getRoute, listRiders, listWorkTickets } from '@/lib/transport';
import { formatDate } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { EditableCard } from '@/components/ui/editable-card';
import { RouteEditForm, DeleteRouteButton, StopsEditor } from '../../transport-forms';

export default async function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('TRANSPORT_READ');
  const { id: idParam } = await params;
  const id = Number(idParam);
  const route = await getRoute(id);
  if (!route) notFound();
  const [canManage, riders, runs] = await Promise.all([currentCanAction('TRANSPORT_MANAGE'), listRiders(id), listWorkTickets({ limit: 20 }).then((t) => t.filter((x) => x.route_id === id))]);
  const seats = route.buses.length ? riders.length : 0;
  const byStop = new Map<string, number>();
  for (const r of riders) byStop.set(r.stop_name ?? '(no stop)', (byStop.get(r.stop_name ?? '(no stop)') ?? 0) + 1);

  return (
    <Page title={`${route.code} — ${route.name}`} crumb={route.description ?? `${route.stops.length} stop${route.stops.length === 1 ? '' : 's'}`} user={user}>
      <Toolbar>
        <Link href="/transport/routes" className="btn ghost sm">← All routes</Link>
        <Spacer />
        {canManage && !riders.length ? <DeleteRouteButton id={id} /> : null}
      </Toolbar>
      <div className="grid g4">
        <Stat label="Riders" value={String(riders.length)} accent={riders.length > 0} />
        <Stat label="Buses" value={String(route.buses.length)} accent={false} foot={route.buses.map((b) => b.registration_no).join(', ') || 'None assigned'} />
        <Stat label="Stops" value={String(route.stops.length)} accent={false} />
        <Stat label="Termly fare" value={Number(route.term_fare) ? <Money cents={route.term_fare} /> : 'Fee structure'} accent={false} foot="Charged through the Transport fee item" />
      </div>
      <EditableCard title="Route" sub="The code and name the fee structure, the buses and the students' cards refer to" canEdit={canManage} form={<RouteEditForm route={route} />}>
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <DefinitionList items={[['Code', <span className="mono" key="c">{route.code}</span>], ['Name', route.name], ['Description', route.description ?? '—']]} />
          </section>
          <section className="dl-group">
            <DefinitionList items={[
              ['Status', <Pill key="s" status={route.status} />],
              ['Termly fare', Number(route.term_fare) ? <Money cents={route.term_fare} key="f" /> : <span className="tiny muted-cell" key="f">Uses the Transport item on the fee structure</span>],
              ['Buses', route.buses.length ? route.buses.map((b) => <Link key={b.id} href={`/transport/buses/${b.id}`} style={{ marginRight: 8 }}>{b.registration_no}{b.driver_name ? ` (${b.driver_name})` : ''}</Link>) : <span className="muted-cell" key="b">None — set the route on the bus card</span>],
            ]} />
          </section>
        </div>
      </EditableCard>

      <Card>
        <CardHead title="Stops" sub="In the order the bus calls, with the pick-up and drop-off times parents are told" />
        <StopsEditor routeId={id} stops={route.stops} canEdit={canManage} />
      </Card>

      <Card>
        <CardHead title="Riders" sub={riders.length ? `${riders.length} student${riders.length === 1 ? '' : 's'}${seats ? ` · ${Array.from(byStop).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}` : 'Students opt into this route from their own card'} />
        {riders.length ? (
          <TableWrap>
            <thead><tr><th>Adm. No.</th><th>Student</th><th>Class</th><th>Stop</th><th>Direction</th><th>Guardian phone</th><th>Note</th></tr></thead>
            <tbody>
              {riders.map((r) => (
                <tr key={r.id}>
                  <td className="mono"><Link href={`/students/view/${r.student_id}`}>{r.admission_no}</Link></td>
                  <td><b>{r.student_name}</b></td>
                  <td>{r.grade_level_name} {r.stream_name}</td>
                  <td>{r.stop_name ?? '—'}</td>
                  <td>{r.direction === 'BOTH' ? 'Both ways' : r.direction === 'MORNING' ? 'Morning only' : 'Evening only'}</td>
                  <td className="mono">{r.guardian_phone ?? '—'}</td>
                  <td className="tiny">{r.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🧒" title="No riders yet" />}
      </Card>

      <Card>
        <CardHead title="Recent runs" sub="Work tickets issued on this route" />
        {runs.length ? (
          <TableWrap>
            <thead><tr><th>No.</th><th>Date</th><th>Bus</th><th>Driver</th><th className="num">km</th><th>Status</th></tr></thead>
            <tbody>
              {runs.map((t) => (
                <tr key={t.id}>
                  <td className="mono"><Link href={`/transport/work-tickets/${encodeURIComponent(t.no)}`}>{t.no}</Link></td>
                  <td>{formatDate(t.date)}</td>
                  <td><Link href={`/transport/buses/${t.bus_id}`}>{t.registration_no}</Link></td>
                  <td>{t.driver_name}</td>
                  <td className="num">{t.distance_km ?? '—'}</td>
                  <td><Pill status={t.status} tone={t.status === 'OPEN' ? 'warn' : t.status === 'CLOSED' ? 'ok' : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <div className="tiny muted-cell">No tickets on this route yet.</div>}
      </Card>
    </Page>
  );
}
