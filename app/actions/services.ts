'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireAnyAction } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import * as transport from '@/lib/transport';
import * as hostel from '@/lib/hostel';
import * as library from '@/lib/library';
import type { ActionResult, FormValues } from '@/lib/types';

const str = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number | null => (v === undefined || v === '' || v === null ? null : Number(v));
const cents = (v: unknown): number => Math.round((Number(v) || 0) * 100);
const paths = (...p: string[]) => { for (const x of p) revalidatePath(x, 'layout'); };

/* ================================================================== transport */

export async function saveDriverRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('TRANSPORT_MANAGE');
    const r = await transport.saveDriver({ employeeId: Number(values.employee_id), licenceNo: str(values.licence_no), licenceClass: str(values.licence_class) || null, licenceExpiry: str(values.licence_expiry) || null, psvBadgeNo: str(values.psv_badge_no) || null, psvExpiry: str(values.psv_expiry) || null, notes: str(values.notes) || null }, user);
    paths('/transport'); return r;
  });
}
export async function removeDriverRequest(employeeId: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('TRANSPORT_MANAGE'); await transport.removeDriver(employeeId, user); paths('/transport'); return { deleted: true }; });
}

export async function saveBusRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('TRANSPORT_MANAGE');
    const r = await transport.saveBus(values.id ? Number(values.id) : null, {
      fixedAssetNo: str(values.fixed_asset_no), registrationNo: str(values.registration_no), makeModel: str(values.make_model) || null, capacity: Number(values.capacity) || 0,
      driverEmployeeId: num(values.driver_employee_id), routeId: num(values.route_id), status: str(values.status) || 'ACTIVE',
      insuranceExpiry: str(values.insurance_expiry) || null, inspectionExpiry: str(values.inspection_expiry) || null, odometer: num(values.odometer), notes: str(values.notes) || null,
    }, user);
    paths('/transport'); return r;
  });
}

export async function saveRouteRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('TRANSPORT_MANAGE');
    const r = await transport.saveRoute(values.id ? Number(values.id) : null, { code: str(values.code), name: str(values.name), description: str(values.description) || null, termFare: cents(values.term_fare), status: str(values.status) || 'ACTIVE' }, user);
    paths('/transport'); return r;
  });
}
export async function deleteRouteRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('TRANSPORT_MANAGE'); await transport.deleteRoute(id, user); paths('/transport'); return { deleted: true }; });
}
export async function saveStopsRequest(routeId: number, stops: transport.StopDraft[]): Promise<ActionResult<{ saved: number }>> {
  return actionResult(async () => { const user = await requireAction('TRANSPORT_MANAGE'); const r = await transport.saveStops(routeId, stops, user); paths('/transport'); return r; });
}

export async function setStudentTransportRequest(studentId: number, values: FormValues): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAnyAction('TRANSPORT_MANAGE', 'STUDENTS_UPDATE');
    await transport.setStudentTransport(studentId, { routeId: num(values.route_id), stopId: num(values.stop_id), direction: str(values.direction) || 'BOTH', note: str(values.note) || null }, user);
    paths('/transport', '/students'); revalidatePath(`/students/view/${studentId}`);
    return { saved: true };
  });
}

export async function openWorkTicketRequest(values: FormValues): Promise<ActionResult<{ no: string }>> {
  return actionResult(async () => {
    const user = await requireAction('TRANSPORT_WORK_TICKETS');
    const r = await transport.openWorkTicket({ busId: Number(values.bus_id), driverEmployeeId: num(values.driver_employee_id), routeId: num(values.route_id), date: str(values.date), purpose: str(values.purpose) || 'ROUTE_RUN', destination: str(values.destination) || null, odometerStart: num(values.odometer_start), remarks: str(values.remarks) || null }, user);
    paths('/transport'); return r;
  });
}
export async function closeWorkTicketRequest(no: string, values: FormValues): Promise<ActionResult<{ distance: number }>> {
  return actionResult(async () => {
    const user = await requireAction('TRANSPORT_WORK_TICKETS');
    const r = await transport.closeWorkTicket(no, { odometerEnd: Number(values.odometer_end), fuelLitres: Number(values.fuel_litres) || 0, fuelCost: cents(values.fuel_cost), remarks: str(values.remarks) || null }, user);
    paths('/transport'); return r;
  });
}
export async function cancelWorkTicketRequest(no: string, reason: string): Promise<ActionResult<{ cancelled: true }>> {
  return actionResult(async () => { const user = await requireAction('TRANSPORT_WORK_TICKETS'); await transport.cancelWorkTicket(no, reason, user); paths('/transport'); return { cancelled: true }; });
}

/* ==================================================================== hostel */

export async function saveHostelRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HOSTEL_MANAGE');
    const r = await hostel.saveHostel(values.id ? Number(values.id) : null, { code: str(values.code), name: str(values.name), gender: str(values.gender) || 'MIXED', wardenEmployeeId: num(values.warden_employee_id), status: str(values.status) || 'ACTIVE', notes: str(values.notes) || null }, user);
    paths('/hostel'); return r;
  });
}
export async function saveRoomRequest(hostelId: number, values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const user = await requireAction('HOSTEL_MANAGE'); const r = await hostel.saveRoom(hostelId, { id: num(values.id), name: str(values.name), floor: str(values.floor) || null, beds: Number(values.beds) || 0 }, user); paths('/hostel'); return r; });
}
export async function deleteRoomRequest(roomId: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => { const user = await requireAction('HOSTEL_MANAGE'); await hostel.deleteRoom(roomId, user); paths('/hostel'); return { deleted: true }; });
}
export async function setBedStatusRequest(bedId: number, status: 'AVAILABLE' | 'OUT_OF_SERVICE'): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const user = await requireAction('HOSTEL_MANAGE'); await hostel.setBedStatus(bedId, status, user); paths('/hostel'); return { id: bedId }; });
}
export async function allocateBedRequest(bedId: number, values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('HOSTEL_MANAGE');
    const r = await hostel.allocateBed(bedId, Number(values.student_id), str(values.from_date), user);
    paths('/hostel', '/students'); return r;
  });
}
export async function vacateBedRequest(allocationId: number, toDate: string): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const user = await requireAction('HOSTEL_MANAGE'); await hostel.vacateBed(allocationId, toDate, user); paths('/hostel', '/students'); return { id: allocationId }; });
}

/* =================================================================== library */

export async function saveLibrarySetupRequest(values: FormValues): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('LIBRARY_SETUP_MANAGE');
    await library.saveLibrarySetup({ loanDays: Number(values.loan_days), finePerDay: cents(values.fine_per_day), maxLoansStudent: Number(values.max_loans_student), maxLoansStaff: Number(values.max_loans_staff), fineGlAccountId: num(values.fine_gl_account_id) }, user);
    paths('/library'); return { saved: true };
  });
}
export async function saveBookRequest(values: FormValues): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => {
    const user = await requireAction('LIBRARY_MANAGE');
    const r = await library.saveBook(values.id ? Number(values.id) : null, { isbn: str(values.isbn) || null, title: str(values.title), author: str(values.author) || null, publisher: str(values.publisher) || null, year: num(values.year), category: str(values.category) || null, location: str(values.location) || null, status: str(values.status) || 'ACTIVE' }, user);
    // A new title usually arrives with its copies in the same box.
    if (!values.id && Number(values.copies) > 0) await library.addCopies(r.id, Number(values.copies), user, 'NEW');
    paths('/library'); return r;
  });
}
export async function addCopiesRequest(bookId: number, count: number, condition?: string | null): Promise<ActionResult<{ added: string[] }>> {
  return actionResult(async () => { const user = await requireAction('LIBRARY_MANAGE'); const r = await library.addCopies(bookId, count, user, condition); paths('/library'); return r; });
}
export async function setCopyStatusRequest(copyId: number, status: 'AVAILABLE' | 'LOST' | 'DAMAGED' | 'WITHDRAWN'): Promise<ActionResult<{ id: number }>> {
  return actionResult(async () => { const user = await requireAction('LIBRARY_MANAGE'); await library.setCopyStatus(copyId, status, user); paths('/library'); return { id: copyId }; });
}
export async function issueLoanRequest(values: FormValues): Promise<ActionResult<{ id: number; dueOn: string }>> {
  return actionResult(async () => {
    const user = await requireAction('LIBRARY_MANAGE');
    const r = await library.issueLoan({ accessionNo: str(values.accession_no), studentId: str(values.borrower_kind) === 'STAFF' ? null : num(values.student_id), employeeId: str(values.borrower_kind) === 'STAFF' ? num(values.employee_id) : null, issuedOn: str(values.issued_on) || null, dueOn: str(values.due_on) || null }, user);
    paths('/library', '/students', '/portal'); return r;
  });
}
export async function returnLoanRequest(loanId: number, values: FormValues): Promise<ActionResult<{ fine: number; daysLate: number }>> {
  return actionResult(async () => { const user = await requireAction('LIBRARY_MANAGE'); const r = await library.returnLoan(loanId, { returnedOn: str(values.returned_on) || null, lost: str(values.lost) === '1', remarks: str(values.remarks) || null }, user); paths('/library', '/students', '/portal'); return r; });
}
export async function chargeFineRequest(loanId: number): Promise<ActionResult<{ invoiceNo: string }>> {
  return actionResult(async () => { const user = await requireAction('LIBRARY_SETUP_MANAGE'); const r = await library.chargeFineToFeeAccount(loanId, user); paths('/library', '/students', '/fees'); return r; });
}
