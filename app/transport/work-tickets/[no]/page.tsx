import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getWorkTicket } from '@/lib/transport';
import { formatDate, formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, Pill, Stat, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { CloseWorkTicketPanel, CancelWorkTicketButton } from '../../transport-forms';

const PURPOSE: Record<string, string> = { ROUTE_RUN: 'Route run (pick-up / drop-off)', TRIP: 'Trip / outing', MAINTENANCE: 'Workshop / maintenance' };

export default async function WorkTicketPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireAction('TRANSPORT_READ');
  const { no: noParam } = await params;
  const no = decodeURIComponent(noParam);
  const [ticket, canTickets] = await Promise.all([getWorkTicket(no), currentCanAction('TRANSPORT_WORK_TICKETS')]);
  if (!ticket) notFound();
  const kmPerL = ticket.distance_km && Number(ticket.fuel_litres) > 0 ? (ticket.distance_km / Number(ticket.fuel_litres)).toFixed(1) : null;

  return (
    <Page title={`Work ticket ${ticket.no}`} crumb={`${ticket.registration_no} · ${ticket.driver_name} · ${formatDate(ticket.date)}`} user={user}>
      <Toolbar>
        <Link href="/transport/work-tickets" className="btn ghost sm">← All work tickets</Link>
        <Spacer />
        <Link href={`/print/work-ticket/${encodeURIComponent(ticket.no)}`} className="btn ghost" target="_blank">Print</Link>
        {canTickets && ticket.status === 'OPEN' ? <CancelWorkTicketButton no={ticket.no} /> : null}
      </Toolbar>
      <div className="grid g4">
        <Stat label="Status" value={ticket.status === 'OPEN' ? 'On the road' : ticket.status === 'CLOSED' ? 'Closed' : 'Cancelled'} accent={ticket.status === 'OPEN'} foot={ticket.closed_at ? `Closed ${formatDateTime(ticket.closed_at)}` : `Issued ${formatDateTime(ticket.created_at)}`} />
        <Stat label="Distance" value={ticket.distance_km !== null ? `${ticket.distance_km.toLocaleString()} km` : '—'} accent={false} foot={ticket.odometer_start !== null ? `Out ${ticket.odometer_start.toLocaleString()}${ticket.odometer_end !== null ? ` → in ${ticket.odometer_end.toLocaleString()}` : ''}` : undefined} />
        <Stat label="Fuel" value={Number(ticket.fuel_litres) ? `${ticket.fuel_litres} L` : '—'} accent={false} foot={Number(ticket.fuel_cost) ? <Money cents={ticket.fuel_cost} /> : undefined} />
        <Stat label="Consumption" value={kmPerL ? `${kmPerL} km/L` : '—'} accent={false} />
      </div>
      <Card>
        <CardHead title="Ticket" sub="Authorises the bus to leave the yard; the odometer and fuel come back with it" />
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <DefinitionList items={[
              ['No.', <span className="mono" key="n">{ticket.no}</span>], ['Date', formatDate(ticket.date)],
              ['Bus', <Link href={`/transport/buses/${ticket.bus_id}`} key="b">{ticket.registration_no}</Link>],
              ['Driver', <Link href={`/transport/drivers/${ticket.driver_employee_id}`} key="d">{ticket.driver_name} <span className="tiny mono">{ticket.driver_employee_no}</span></Link>],
              ['Purpose', PURPOSE[ticket.purpose] ?? ticket.purpose],
            ]} />
          </section>
          <section className="dl-group">
            <DefinitionList items={[
              ['Route', ticket.route_name ? <Link href={`/transport/routes/${ticket.route_id}`} key="r">{ticket.route_name}</Link> : '—'],
              ['Destination', ticket.destination ?? '—'],
              ['Authorised by', ticket.authorised_by ?? '—'],
              ['Status', <Pill key="s" status={ticket.status} tone={ticket.status === 'OPEN' ? 'warn' : ticket.status === 'CLOSED' ? 'ok' : undefined} />],
              ['Remarks', ticket.remarks ?? '—'],
            ]} />
          </section>
        </div>
      </Card>
      {canTickets && ticket.status === 'OPEN' ? (
        <Card>
          <CardHead title="Return" sub="Close the ticket with the odometer reading and any fuel taken — the bus's odometer moves forward with it" />
          <CloseWorkTicketPanel ticket={ticket} />
        </Card>
      ) : null}
    </Page>
  );
}
