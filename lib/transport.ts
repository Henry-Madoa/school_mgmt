/*
 * School transport — routes and stops, the buses (each one a fixed asset in the FA register),
 * the drivers (employees with a driver profile), which students ride which route, and the work
 * tickets that authorise every journey and record odometer and fuel on return.
 *
 * The money side stays where it belongs: the bus's cost and depreciation are the fixed asset's;
 * the fare is the TRANSPORT fee item on the student's invoice (a route may set its own termly
 * fare); fuel spend on a work ticket is a record for the fleet report — it is paid through petty
 * cash / imprest / a payment voucher like any other expense.
 */
import { one, all, run, tx, audit, hasAnyRow, nextSequence } from './db.ts';
import { AppError } from './errors.ts';
import type {
  Actor, Cents, DriverProfile, DriverView, IsoDate, RideDirection, RiderView, SchoolBus, SchoolBusView, TransportRoute, TransportRouteView, TransportStop,
  WorkTicket, WorkTicketPurpose, WorkTicketView,
} from './types.ts';

const now = () => new Date().toISOString();

/* ------------------------------------------------------------------- drivers */

const DRIVER_SELECT = `
  SELECT d.*, e.employee_no, e.first_name, e.last_name, e.phone, e.status AS employee_status,
         b.id AS bus_id, b.registration_no AS bus_registration_no, r.name AS route_name,
         (SELECT COUNT(*)::int FROM bus_work_ticket t WHERE t.driver_employee_id = d.employee_id AND t.status = 'OPEN') AS open_tickets
  FROM driver_profile d JOIN employee e ON e.id = d.employee_id
  LEFT JOIN school_bus b ON b.driver_employee_id = d.employee_id AND b.status <> 'RETIRED'
  LEFT JOIN transport_route r ON r.id = b.route_id`;

export const listDrivers = (): Promise<DriverView[]> => all<DriverView>(`${DRIVER_SELECT} ORDER BY e.last_name, e.first_name`);
export const getDriver = (employeeId: number): Promise<DriverView | undefined> => one<DriverView>(`${DRIVER_SELECT} WHERE d.employee_id = ?`, employeeId);

export const listEmployeesNotDrivers = (): Promise<{ id: number; employee_no: string; first_name: string; last_name: string; job_title: string | null }[]> =>
  all(`SELECT e.id, e.employee_no, e.first_name, e.last_name, e.job_title FROM employee e
       WHERE e.status IN ('ACTIVE', 'ON_LEAVE') AND NOT EXISTS (SELECT 1 FROM driver_profile d WHERE d.employee_id = e.id) ORDER BY e.last_name, e.first_name`);

export interface DriverInput { employeeId: number; licenceNo: string; licenceClass?: string | null; licenceExpiry?: IsoDate | null; psvBadgeNo?: string | null; psvExpiry?: IsoDate | null; notes?: string | null }

const isoOrNull = (v: string | null | undefined, label: string): string | null => {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new AppError(`${label} must be a date`, 'VALIDATION');
  return s;
};

export async function saveDriver(input: DriverInput, user: Actor): Promise<{ id: number }> {
  const emp = await one<{ id: number; employee_no: string }>('SELECT id, employee_no FROM employee WHERE id = ?', input.employeeId);
  if (!emp) throw new AppError('Employee not found — drivers are onboarded under HR › Employees first', 'NOT_FOUND');
  const licence = String(input.licenceNo || '').trim().toUpperCase();
  if (!licence) throw new AppError('A driving licence number is required', 'VALIDATION');
  const row = [licence, input.licenceClass?.trim() || null, isoOrNull(input.licenceExpiry, 'Licence expiry'), input.psvBadgeNo?.trim() || null, isoOrNull(input.psvExpiry, 'PSV badge expiry'), input.notes?.trim() || null];
  const existing = await one<DriverProfile>('SELECT * FROM driver_profile WHERE employee_id = ?', input.employeeId);
  if (existing) {
    await run('UPDATE driver_profile SET licence_no=?, licence_class=?, licence_expiry=?, psv_badge_no=?, psv_expiry=?, notes=? WHERE id=?', ...row, existing.id);
    await audit(user, 'DRIVER_UPDATE', 'driver_profile', existing.id, { employee: emp.employee_no });
    return { id: existing.id };
  }
  const info = await run('INSERT INTO driver_profile (employee_id, licence_no, licence_class, licence_expiry, psv_badge_no, psv_expiry, notes, created_at) VALUES (?,?,?,?,?,?,?,?)', input.employeeId, ...row, now());
  await audit(user, 'DRIVER_CREATE', 'driver_profile', info.lastInsertRowid, { employee: emp.employee_no });
  return { id: Number(info.lastInsertRowid) };
}

export async function removeDriver(employeeId: number, user: Actor): Promise<void> {
  if (await hasAnyRow('school_bus', "driver_employee_id = ? AND status <> 'RETIRED'", employeeId)) throw new AppError('This driver is assigned to a bus — reassign the bus first', 'IN_USE');
  if (await hasAnyRow('bus_work_ticket', "driver_employee_id = ? AND status = 'OPEN'", employeeId)) throw new AppError('This driver has an open work ticket', 'IN_USE');
  await run('DELETE FROM driver_profile WHERE employee_id = ?', employeeId);
  await audit(user, 'DRIVER_REMOVE', 'driver_profile', employeeId, {});
}

/** Papers that have expired or expire within 30 days — the transport office's checklist. */
export const expiringPapers = async (): Promise<{ kind: string; who: string; expiry: IsoDate; days: number }[]> => {
  const today = now().slice(0, 10);
  const rows = await all<{ kind: string; who: string; expiry: IsoDate }>(
    `SELECT 'Driving licence' AS kind, e.first_name || ' ' || e.last_name AS who, d.licence_expiry AS expiry FROM driver_profile d JOIN employee e ON e.id = d.employee_id WHERE d.licence_expiry IS NOT NULL
     UNION ALL SELECT 'PSV badge', e.first_name || ' ' || e.last_name, d.psv_expiry FROM driver_profile d JOIN employee e ON e.id = d.employee_id WHERE d.psv_expiry IS NOT NULL
     UNION ALL SELECT 'Insurance', b.registration_no, b.insurance_expiry FROM school_bus b WHERE b.insurance_expiry IS NOT NULL AND b.status <> 'RETIRED'
     UNION ALL SELECT 'Inspection', b.registration_no, b.inspection_expiry FROM school_bus b WHERE b.inspection_expiry IS NOT NULL AND b.status <> 'RETIRED'`,
  );
  return rows
    .map((r) => ({ ...r, days: Math.round((Date.parse(r.expiry) - Date.parse(today)) / 86_400_000) }))
    .filter((r) => r.days <= 30)
    .sort((a, b) => a.days - b.days);
};

/* --------------------------------------------------------------------- buses */

const BUS_SELECT = `
  SELECT b.*, fa.description AS asset_description,
         CASE WHEN e.id IS NULL THEN NULL ELSE e.first_name || ' ' || e.last_name END AS driver_name, e.employee_no AS driver_employee_no,
         r.name AS route_name, r.code AS route_code,
         (SELECT COUNT(*)::int FROM student_transport st JOIN student s ON s.id = st.student_id WHERE st.route_id = b.route_id AND s.status = 'ACTIVE') AS riders,
         (SELECT COUNT(*)::int FROM bus_work_ticket t WHERE t.bus_id = b.id AND t.status = 'OPEN') AS open_tickets
  FROM school_bus b
  JOIN fixed_asset fa ON fa.no = b.fixed_asset_no
  LEFT JOIN employee e ON e.id = b.driver_employee_id
  LEFT JOIN transport_route r ON r.id = b.route_id`;

export const listBuses = (): Promise<SchoolBusView[]> => all<SchoolBusView>(`${BUS_SELECT} ORDER BY b.status, b.registration_no`);
export const getBus = (id: number): Promise<SchoolBusView | undefined> => one<SchoolBusView>(`${BUS_SELECT} WHERE b.id = ?`, id);

/** Vehicles in the FA register not yet set up as a bus — what "Add a bus" offers. */
export const listVehicleAssets = (): Promise<{ no: string; description: string; serial_no: string | null }[]> =>
  all(`SELECT fa.no, fa.description, fa.serial_no FROM fixed_asset fa
       WHERE fa.fa_class_code = 'VEHICLES' AND fa.blocked = 0 AND NOT EXISTS (SELECT 1 FROM school_bus b WHERE b.fixed_asset_no = fa.no) ORDER BY fa.no`);

export interface BusInput {
  fixedAssetNo: string; registrationNo: string; makeModel?: string | null; capacity: number; driverEmployeeId?: number | null; routeId?: number | null;
  status?: string | null; insuranceExpiry?: IsoDate | null; inspectionExpiry?: IsoDate | null; odometer?: number | null; notes?: string | null;
}

async function assertBusInput(i: BusInput, id: number | null): Promise<void> {
  const fa = await one<{ fa_class_code: string | null; blocked: number }>('SELECT fa_class_code, blocked FROM fixed_asset WHERE no = ?', i.fixedAssetNo);
  if (!fa) throw new AppError('Pick the vehicle from the Fixed Asset register — a bus is a fixed asset first', 'VALIDATION');
  if (fa.fa_class_code !== 'VEHICLES') throw new AppError('That fixed asset is not in the VEHICLES class', 'VALIDATION');
  if (!String(i.registrationNo || '').trim()) throw new AppError('A registration number is required', 'VALIDATION');
  if (!(Number(i.capacity) > 0)) throw new AppError('Seating capacity is required', 'VALIDATION');
  if (i.driverEmployeeId && !(await hasAnyRow('driver_profile', 'employee_id = ?', i.driverEmployeeId))) throw new AppError('The driver must have a driver profile (licence) first', 'VALIDATION');
  if (i.driverEmployeeId && await hasAnyRow('school_bus', `driver_employee_id = ? AND status <> 'RETIRED' ${id ? 'AND id <> ?' : ''}`, ...(id ? [i.driverEmployeeId, id] : [i.driverEmployeeId]))) {
    throw new AppError('That driver is already assigned to another bus', 'VALIDATION');
  }
  if (i.routeId && !(await hasAnyRow('transport_route', 'id = ?', i.routeId))) throw new AppError('Route not found', 'NOT_FOUND');
  if (await hasAnyRow('school_bus', `registration_no = ? ${id ? 'AND id <> ?' : ''}`, ...(id ? [i.registrationNo.trim().toUpperCase(), id] : [i.registrationNo.trim().toUpperCase()]))) throw new AppError('A bus with that registration already exists', 'DUPLICATE');
  if (await hasAnyRow('school_bus', `fixed_asset_no = ? ${id ? 'AND id <> ?' : ''}`, ...(id ? [i.fixedAssetNo, id] : [i.fixedAssetNo]))) throw new AppError('That fixed asset is already a bus', 'DUPLICATE');
}

export async function saveBus(id: number | null, input: BusInput, user: Actor): Promise<{ id: number }> {
  await assertBusInput(input, id);
  const status = ['ACTIVE', 'WORKSHOP', 'RETIRED'].includes(String(input.status)) ? String(input.status) : 'ACTIVE';
  const row = [input.fixedAssetNo, input.registrationNo.trim().toUpperCase(), input.makeModel?.trim() || null, Math.round(Number(input.capacity)), input.driverEmployeeId || null, input.routeId || null, status,
    isoOrNull(input.insuranceExpiry, 'Insurance expiry'), isoOrNull(input.inspectionExpiry, 'Inspection expiry'), Math.max(0, Math.round(Number(input.odometer) || 0)), input.notes?.trim() || null];
  if (id) {
    await run('UPDATE school_bus SET fixed_asset_no=?, registration_no=?, make_model=?, capacity=?, driver_employee_id=?, route_id=?, status=?, insurance_expiry=?, inspection_expiry=?, odometer=?, notes=? WHERE id=?', ...row, id);
    await audit(user, 'BUS_UPDATE', 'school_bus', id, { registration: row[1] });
    return { id };
  }
  const info = await run('INSERT INTO school_bus (fixed_asset_no, registration_no, make_model, capacity, driver_employee_id, route_id, status, insurance_expiry, inspection_expiry, odometer, notes, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ...row, now(), user.username);
  await audit(user, 'BUS_CREATE', 'school_bus', info.lastInsertRowid, { registration: row[1] });
  return { id: Number(info.lastInsertRowid) };
}

/* -------------------------------------------------------------------- routes */

export const listRoutes = async (): Promise<TransportRouteView[]> => {
  const [routes, stops, buses] = await Promise.all([
    all<TransportRoute & { riders: number }>(
      `SELECT r.*, (SELECT COUNT(*)::int FROM student_transport st JOIN student s ON s.id = st.student_id WHERE st.route_id = r.id AND s.status = 'ACTIVE') AS riders
       FROM transport_route r ORDER BY r.status, r.code`,
    ),
    all<TransportStop>('SELECT * FROM transport_stop ORDER BY route_id, sort, id'),
    all<{ id: number; registration_no: string; route_id: number | null; driver_name: string | null }>(
      `SELECT b.id, b.registration_no, b.route_id, CASE WHEN e.id IS NULL THEN NULL ELSE e.first_name || ' ' || e.last_name END AS driver_name FROM school_bus b LEFT JOIN employee e ON e.id = b.driver_employee_id WHERE b.status <> 'RETIRED'`,
    ),
  ]);
  return routes.map((r) => ({ ...r, stops: stops.filter((s) => s.route_id === r.id), buses: buses.filter((b) => b.route_id === r.id).map((b) => ({ id: b.id, registration_no: b.registration_no, driver_name: b.driver_name })) }));
};
export const getRoute = async (id: number): Promise<TransportRouteView | undefined> => (await listRoutes()).find((r) => r.id === id);

export interface RouteInput { code: string; name: string; description?: string | null; termFare?: Cents | null; status?: string | null }

export async function saveRoute(id: number | null, input: RouteInput, user: Actor): Promise<{ id: number }> {
  const code = String(input.code || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  if (!code || !name) throw new AppError('A route needs a code and a name', 'VALIDATION');
  if (await hasAnyRow('transport_route', `code = ? ${id ? 'AND id <> ?' : ''}`, ...(id ? [code, id] : [code]))) throw new AppError(`Route ${code} already exists`, 'DUPLICATE');
  const fare = Math.max(0, Math.round(Number(input.termFare) || 0));
  const status = input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  if (id) {
    await run('UPDATE transport_route SET code=?, name=?, description=?, term_fare=?, status=? WHERE id=?', code, name, input.description?.trim() || null, fare, status, id);
    await audit(user, 'ROUTE_UPDATE', 'transport_route', id, { code });
    return { id };
  }
  const info = await run('INSERT INTO transport_route (code, name, description, term_fare, status, created_at) VALUES (?,?,?,?,?,?)', code, name, input.description?.trim() || null, fare, status, now());
  await audit(user, 'ROUTE_CREATE', 'transport_route', info.lastInsertRowid, { code });
  return { id: Number(info.lastInsertRowid) };
}

export async function deleteRoute(id: number, user: Actor): Promise<void> {
  if (await hasAnyRow('student_transport', 'route_id = ?', id)) throw new AppError('Students ride this route — move them first', 'IN_USE');
  await tx(async () => {
    await run('UPDATE school_bus SET route_id = NULL WHERE route_id = ?', id);
    await run('DELETE FROM transport_stop WHERE route_id = ?', id);
    await run('DELETE FROM transport_route WHERE id = ?', id);
  });
  await audit(user, 'ROUTE_DELETE', 'transport_route', id, {});
}

export interface StopDraft { id?: number | string | null; name: string; pickupTime?: string | null; dropoffTime?: string | null }

/** Replaces the route's stops in the order given (a stop still used by riders keeps its id when the name matches). */
export async function saveStops(routeId: number, stops: StopDraft[], user: Actor): Promise<{ saved: number }> {
  const kept = stops.filter((s) => String(s.name || '').trim());
  await tx(async () => {
    const existing = await all<TransportStop>('SELECT * FROM transport_stop WHERE route_id = ?', routeId);
    const keepIds = new Set<number>();
    let sort = 0;
    for (const s of kept) {
      sort += 1;
      const name = s.name.trim();
      const match = existing.find((e) => e.id === Number(s.id)) ?? existing.find((e) => e.name.toLowerCase() === name.toLowerCase());
      if (match) {
        await run('UPDATE transport_stop SET name=?, pickup_time=?, dropoff_time=?, sort=? WHERE id=?', name, s.pickupTime?.trim() || null, s.dropoffTime?.trim() || null, sort, match.id);
        keepIds.add(match.id);
      } else {
        const info = await run('INSERT INTO transport_stop (route_id, name, pickup_time, dropoff_time, sort) VALUES (?,?,?,?,?)', routeId, name, s.pickupTime?.trim() || null, s.dropoffTime?.trim() || null, sort);
        keepIds.add(Number(info.lastInsertRowid));
      }
    }
    for (const e of existing) {
      if (keepIds.has(e.id)) continue;
      await run('UPDATE student_transport SET stop_id = NULL WHERE stop_id = ?', e.id);
      await run('DELETE FROM transport_stop WHERE id = ?', e.id);
    }
  });
  await audit(user, 'ROUTE_STOPS_SAVE', 'transport_route', routeId, { stops: kept.length });
  return { saved: kept.length };
}

/* -------------------------------------------------------------------- riders */

const RIDER_SELECT = `
  SELECT st.*, s.admission_no, s.first_name || ' ' || s.last_name AS student_name, g.name AS grade_level_name, sm.name AS stream_name, pg.phone AS guardian_phone,
         r.name AS route_name, sp.name AS stop_name
  FROM student_transport st
  JOIN student s ON s.id = st.student_id
  JOIN transport_route r ON r.id = st.route_id
  LEFT JOIN transport_stop sp ON sp.id = st.stop_id
  LEFT JOIN grade_level g ON g.id = s.current_grade_level_id LEFT JOIN stream sm ON sm.id = s.current_stream_id
  LEFT JOIN LATERAL (SELECT gu.phone FROM student_guardian sg JOIN guardian gu ON gu.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) pg ON true`;

export const listRiders = (routeId?: number | null): Promise<RiderView[]> =>
  all<RiderView>(`${RIDER_SELECT} WHERE s.status = 'ACTIVE' ${routeId ? 'AND st.route_id = ?' : ''} ORDER BY r.code, sp.sort NULLS LAST, s.last_name`, ...(routeId ? [routeId] : []));
export const getStudentTransport = (studentId: number): Promise<RiderView | undefined> => one<RiderView>(`${RIDER_SELECT} WHERE st.student_id = ?`, studentId);

/** Puts a student on a route (and opts them into the TRANSPORT fee item so the fare is billed); routeId null takes them off. */
export async function setStudentTransport(studentId: number, input: { routeId: number | null; stopId?: number | null; direction?: RideDirection | string | null; note?: string | null }, user: Actor): Promise<void> {
  if (!(await hasAnyRow('student', 'id = ?', studentId))) throw new AppError('Student not found', 'NOT_FOUND');
  const transportItems = await all<{ id: number }>("SELECT id FROM fee_item WHERE code = 'TRANSPORT' OR name ILIKE '%transport%' ORDER BY code = 'TRANSPORT' DESC LIMIT 1");
  await tx(async () => {
    if (!input.routeId) {
      await run('DELETE FROM student_transport WHERE student_id = ?', studentId);
      if (transportItems[0]) await run('DELETE FROM student_fee_option WHERE student_id = ? AND fee_item_id = ?', studentId, transportItems[0].id);
      return;
    }
    if (!(await hasAnyRow('transport_route', "id = ? AND status = 'ACTIVE'", input.routeId))) throw new AppError('Pick an active route', 'VALIDATION');
    if (input.stopId && !(await hasAnyRow('transport_stop', 'id = ? AND route_id = ?', input.stopId, input.routeId))) throw new AppError('That stop is not on the route', 'VALIDATION');
    const direction = ['BOTH', 'MORNING', 'EVENING'].includes(String(input.direction)) ? String(input.direction) : 'BOTH';
    await run(
      `INSERT INTO student_transport (student_id, route_id, stop_id, direction, note, created_at, created_by) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (student_id) DO UPDATE SET route_id = EXCLUDED.route_id, stop_id = EXCLUDED.stop_id, direction = EXCLUDED.direction, note = EXCLUDED.note`,
      studentId, input.routeId, input.stopId || null, direction, input.note?.trim() || null, now(), user.username,
    );
    if (transportItems[0]) {
      await run('INSERT INTO student_fee_option (student_id, fee_item_id, note, created_at, created_by) VALUES (?,?,?,?,?) ON CONFLICT (student_id, fee_item_id) DO UPDATE SET note = EXCLUDED.note',
        studentId, transportItems[0].id, null, now(), user.username);
    }
  });
  await audit(user, 'STUDENT_TRANSPORT_SET', 'student', studentId, { route: input.routeId });
}

/* ------------------------------------------------------------- work tickets */

const TICKET_SELECT = `
  SELECT t.*, b.registration_no, e.first_name || ' ' || e.last_name AS driver_name, e.employee_no AS driver_employee_no, r.name AS route_name,
         CASE WHEN t.odometer_end IS NOT NULL AND t.odometer_start IS NOT NULL THEN t.odometer_end - t.odometer_start END AS distance_km
  FROM bus_work_ticket t JOIN school_bus b ON b.id = t.bus_id JOIN employee e ON e.id = t.driver_employee_id LEFT JOIN transport_route r ON r.id = t.route_id`;

export const listWorkTickets = (opts: { busId?: number | null; driverId?: number | null; status?: string | null; limit?: number } = {}): Promise<WorkTicketView[]> =>
  all<WorkTicketView>(
    `${TICKET_SELECT} WHERE 1=1 ${opts.busId ? 'AND t.bus_id = @bus' : ''} ${opts.driverId ? 'AND t.driver_employee_id = @driver' : ''} ${opts.status ? 'AND t.status = @status' : ''}
     ORDER BY t.date DESC, t.id DESC LIMIT ${Math.max(1, Math.min(opts.limit ?? 300, 2000))}`, { bus: opts.busId ?? null, driver: opts.driverId ?? null, status: opts.status ?? null },
  );
export const getWorkTicket = (no: string): Promise<WorkTicketView | undefined> => one<WorkTicketView>(`${TICKET_SELECT} WHERE t.no = ?`, no);

export interface WorkTicketInput {
  busId: number; driverEmployeeId?: number | null; routeId?: number | null; date: IsoDate; purpose: WorkTicketPurpose | string; destination?: string | null;
  odometerStart?: number | null; remarks?: string | null;
}

/** Opens a ticket: the bus must be on the road, the driver licensed, and the bus must not already be out. */
export async function openWorkTicket(input: WorkTicketInput, user: Actor): Promise<{ no: string }> {
  const bus = await one<SchoolBus>('SELECT * FROM school_bus WHERE id = ?', input.busId);
  if (!bus) throw new AppError('Bus not found', 'NOT_FOUND');
  if (bus.status !== 'ACTIVE') throw new AppError(`${bus.registration_no} is ${bus.status.toLowerCase()} — not available`, 'VALIDATION');
  const driverId = input.driverEmployeeId || bus.driver_employee_id;
  if (!driverId) throw new AppError('Pick a driver — the bus has none assigned', 'VALIDATION');
  const driver = await one<DriverProfile>('SELECT * FROM driver_profile WHERE employee_id = ?', driverId);
  if (!driver) throw new AppError('The driver has no driver profile (licence) on file', 'VALIDATION');
  const today = input.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new AppError('A date is required', 'VALIDATION');
  if (driver.licence_expiry && driver.licence_expiry < today) throw new AppError('The driver’s licence has expired — renew it before issuing a ticket', 'VALIDATION');
  if (bus.insurance_expiry && bus.insurance_expiry < today) throw new AppError(`${bus.registration_no}'s insurance has expired`, 'VALIDATION');
  if (await hasAnyRow('bus_work_ticket', "bus_id = ? AND status = 'OPEN'", bus.id)) throw new AppError(`${bus.registration_no} already has an open work ticket — close it first`, 'VALIDATION');
  if (!['ROUTE_RUN', 'TRIP', 'MAINTENANCE'].includes(String(input.purpose))) throw new AppError('Pick the purpose', 'VALIDATION');
  if (input.purpose === 'TRIP' && !input.destination?.trim()) throw new AppError('A trip needs a destination', 'VALIDATION');
  const start = input.odometerStart == null || input.odometerStart === ('' as unknown) ? bus.odometer : Math.round(Number(input.odometerStart));
  if (start < bus.odometer) throw new AppError(`The odometer reads ${bus.odometer} km — it cannot start lower`, 'VALIDATION');
  const no = await nextSequence('WORK_TICKET');
  await run(
    `INSERT INTO bus_work_ticket (no, bus_id, driver_employee_id, route_id, date, purpose, destination, odometer_start, status, remarks, authorised_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,'OPEN',?,?,?)`,
    no, bus.id, driverId, input.routeId ?? (input.purpose === 'ROUTE_RUN' ? bus.route_id : null), today, input.purpose, input.destination?.trim() || null, start, input.remarks?.trim() || null, user.username, now(),
  );
  await audit(user, 'WORK_TICKET_OPEN', 'bus_work_ticket', no, { bus: bus.registration_no, driver: driverId });
  return { no };
}

/** Closes a ticket on return: the odometer reading (must not go backwards), fuel taken and its cost; the bus's odometer moves on. */
export async function closeWorkTicket(no: string, input: { odometerEnd: number; fuelLitres?: number | null; fuelCost?: Cents | null; remarks?: string | null }, user: Actor): Promise<{ distance: number }> {
  const t = await one<WorkTicket>('SELECT * FROM bus_work_ticket WHERE no = ?', no);
  if (!t) throw new AppError('Work ticket not found', 'NOT_FOUND');
  if (t.status !== 'OPEN') throw new AppError('This ticket is already closed', 'VALIDATION');
  const end = Math.round(Number(input.odometerEnd));
  if (!(end >= (t.odometer_start ?? 0))) throw new AppError(`The closing odometer cannot be below the opening reading (${t.odometer_start ?? 0} km)`, 'VALIDATION');
  const litres = Math.max(0, Number(input.fuelLitres) || 0);
  const cost = Math.max(0, Math.round(Number(input.fuelCost) || 0));
  await tx(async () => {
    await run('UPDATE bus_work_ticket SET odometer_end=?, fuel_litres=?, fuel_cost=?, remarks=COALESCE(?, remarks), status=?, closed_at=? WHERE id=?', end, litres, cost, input.remarks?.trim() || null, 'CLOSED', now(), t.id);
    await run('UPDATE school_bus SET odometer = GREATEST(odometer, ?) WHERE id = ?', end, t.bus_id);
  });
  await audit(user, 'WORK_TICKET_CLOSE', 'bus_work_ticket', no, { distance: end - (t.odometer_start ?? 0), litres, cost });
  return { distance: end - (t.odometer_start ?? 0) };
}

export async function cancelWorkTicket(no: string, reason: string, user: Actor): Promise<void> {
  const t = await one<WorkTicket>('SELECT * FROM bus_work_ticket WHERE no = ?', no);
  if (!t) throw new AppError('Work ticket not found', 'NOT_FOUND');
  if (t.status !== 'OPEN') throw new AppError('Only an open ticket can be cancelled', 'VALIDATION');
  await run("UPDATE bus_work_ticket SET status = 'CANCELLED', remarks = ?, closed_at = ? WHERE id = ?", reason?.trim() || t.remarks, now(), t.id);
  await audit(user, 'WORK_TICKET_CANCEL', 'bus_work_ticket', no, { reason });
}

/** Fleet figures for a period — distance, fuel and cost per bus, from closed tickets. */
export const fleetSummary = (from: IsoDate, to: IsoDate): Promise<{ bus_id: number; registration_no: string; trips: number; km: number; litres: number; fuel_cost: Cents; km_per_litre: number | null }[]> =>
  all(
    `SELECT b.id AS bus_id, b.registration_no, COUNT(t.id)::int AS trips,
            COALESCE(SUM(t.odometer_end - t.odometer_start), 0)::int AS km, COALESCE(SUM(t.fuel_litres), 0)::float AS litres, COALESCE(SUM(t.fuel_cost), 0) AS fuel_cost,
            CASE WHEN COALESCE(SUM(t.fuel_litres), 0) > 0 THEN ROUND((SUM(t.odometer_end - t.odometer_start) / SUM(t.fuel_litres))::numeric, 1)::float END AS km_per_litre
     FROM school_bus b LEFT JOIN bus_work_ticket t ON t.bus_id = b.id AND t.status = 'CLOSED' AND t.date BETWEEN ? AND ?
     WHERE b.status <> 'RETIRED' GROUP BY b.id ORDER BY b.registration_no`, from, to,
  );
