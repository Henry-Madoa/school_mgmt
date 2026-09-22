/* school services — transport, hostel, library. Import from '@/lib/types', never from here directly. */
import type { Cents, IsoDate, IsoDateTime } from '../types.ts';

/* ----------------------------------------------------------------- transport */

export interface DriverProfile {
  id: number;
  employee_id: number;
  licence_no: string;
  licence_class: string | null;
  licence_expiry: IsoDate | null;
  psv_badge_no: string | null;
  psv_expiry: IsoDate | null;
  notes: string | null;
  created_at: IsoDateTime | null;
}

export interface DriverView extends DriverProfile {
  employee_no: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  employee_status: string;
  /** The bus this driver is assigned to, if any. */
  bus_id: number | null;
  bus_registration_no: string | null;
  route_name: string | null;
  /** Work tickets still open. */
  open_tickets: number;
}

export type BusStatus = 'ACTIVE' | 'WORKSHOP' | 'RETIRED';

export interface SchoolBus {
  id: number;
  fixed_asset_no: string;
  registration_no: string;
  make_model: string | null;
  capacity: number;
  driver_employee_id: number | null;
  route_id: number | null;
  status: BusStatus;
  insurance_expiry: IsoDate | null;
  inspection_expiry: IsoDate | null;
  odometer: number;
  notes: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface SchoolBusView extends SchoolBus {
  asset_description: string;
  driver_name: string | null;
  driver_employee_no: string | null;
  route_name: string | null;
  route_code: string | null;
  /** Students riding the bus's route. */
  riders: number;
  open_tickets: number;
}

export interface TransportRoute {
  id: number;
  code: string;
  name: string;
  description: string | null;
  term_fare: Cents;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: IsoDateTime | null;
}

export interface TransportStop {
  id: number;
  route_id: number;
  name: string;
  pickup_time: string | null;
  dropoff_time: string | null;
  sort: number;
}

export interface TransportRouteView extends TransportRoute {
  stops: TransportStop[];
  riders: number;
  buses: { id: number; registration_no: string; driver_name: string | null }[];
}

export type RideDirection = 'BOTH' | 'MORNING' | 'EVENING';

export interface StudentTransport {
  id: number;
  student_id: number;
  route_id: number;
  stop_id: number | null;
  direction: RideDirection;
  note: string | null;
  created_at: IsoDateTime | null;
  created_by: string | null;
}

export interface RiderView extends StudentTransport {
  admission_no: string;
  student_name: string;
  grade_level_name: string | null;
  stream_name: string | null;
  guardian_phone: string | null;
  route_name: string;
  stop_name: string | null;
}

export type WorkTicketPurpose = 'ROUTE_RUN' | 'TRIP' | 'MAINTENANCE';
export type WorkTicketStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

export interface WorkTicket {
  id: number;
  no: string;
  bus_id: number;
  driver_employee_id: number;
  route_id: number | null;
  date: IsoDate;
  purpose: WorkTicketPurpose;
  destination: string | null;
  odometer_start: number | null;
  odometer_end: number | null;
  fuel_litres: number;
  fuel_cost: Cents;
  status: WorkTicketStatus;
  remarks: string | null;
  authorised_by: string | null;
  created_at: IsoDateTime | null;
  closed_at: IsoDateTime | null;
}

export interface WorkTicketView extends WorkTicket {
  registration_no: string;
  driver_name: string;
  driver_employee_no: string;
  route_name: string | null;
  /** odometer_end − odometer_start when both are in. */
  distance_km: number | null;
}

/* -------------------------------------------------------------------- hostel */

export interface Hostel {
  id: number;
  code: string;
  name: string;
  gender: 'MALE' | 'FEMALE' | 'MIXED';
  warden_employee_id: number | null;
  status: 'ACTIVE' | 'INACTIVE';
  notes: string | null;
}

export interface HostelView extends Hostel {
  warden_name: string | null;
  rooms: number;
  beds: number;
  occupied: number;
}

export interface HostelRoom {
  id: number;
  hostel_id: number;
  name: string;
  floor: string | null;
  sort: number;
}

export interface HostelBed {
  id: number;
  room_id: number;
  label: string;
  status: 'AVAILABLE' | 'OUT_OF_SERVICE';
}

/** A bed with whoever is in it. */
export interface BedView extends HostelBed {
  room_name: string;
  hostel_id: number;
  hostel_name: string;
  hostel_gender: 'MALE' | 'FEMALE' | 'MIXED';
  allocation_id: number | null;
  student_id: number | null;
  admission_no: string | null;
  student_name: string | null;
  grade_level_name: string | null;
  since: IsoDate | null;
}

export interface BedAllocation {
  id: number;
  bed_id: number;
  student_id: number;
  academic_year_id: number;
  from_date: IsoDate;
  to_date: IsoDate | null;
  status: 'ACTIVE' | 'VACATED';
  created_by: string | null;
  created_at: IsoDateTime | null;
}

export interface BedAllocationView extends BedAllocation {
  bed_label: string;
  room_name: string;
  hostel_name: string;
  admission_no: string;
  student_name: string;
}

/* ------------------------------------------------------------------- library */

export interface LibrarySetup {
  id: number;
  loan_days: number;
  fine_per_day: Cents;
  max_loans_student: number;
  max_loans_staff: number;
  fine_gl_account_id: number | null;
}

export interface LibraryBook {
  id: number;
  isbn: string | null;
  title: string;
  author: string | null;
  publisher: string | null;
  year: number | null;
  category: string | null;
  location: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: IsoDateTime | null;
}

export interface LibraryBookView extends LibraryBook {
  copies: number;
  available: number;
  on_loan: number;
}

export type CopyStatus = 'AVAILABLE' | 'ON_LOAN' | 'LOST' | 'DAMAGED' | 'WITHDRAWN';

export interface LibraryCopy {
  id: number;
  book_id: number;
  accession_no: string;
  status: CopyStatus;
  condition: string | null;
  added_at: IsoDateTime | null;
}

export type LoanStatus = 'ON_LOAN' | 'RETURNED' | 'LOST';

export interface LibraryLoan {
  id: number;
  copy_id: number;
  student_id: number | null;
  employee_id: number | null;
  issued_on: IsoDate;
  due_on: IsoDate;
  returned_on: IsoDate | null;
  status: LoanStatus;
  fine_amount: Cents;
  fine_invoice_no: string | null;
  issued_by: string | null;
  returned_by: string | null;
  remarks: string | null;
}

export interface LibraryLoanView extends LibraryLoan {
  accession_no: string;
  title: string;
  author: string | null;
  borrower_name: string;
  borrower_no: string;
  borrower_kind: 'STUDENT' | 'STAFF';
  /** Days past due today (0 when not overdue or returned on time). */
  days_overdue: number;
}
