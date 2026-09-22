# School Management System

A complete school back office and its portals on one double-entry ledger: student admission and
placement, guardians, classes and streams, timetables, daily registers, assessments and CBC-style
competency report cards, fee structures invoiced **through the general ledger** and settled by
receipts or M-Pesa, plus the finance, HR & payroll, procurement, fixed-asset and inventory modules a
school's accounts office runs on — and an **Admin Centre** where the school's information, academic
structure and the entire visual theme are configured at runtime.

Every shilling in the system moves through one posting engine. Nothing writes a balance directly.

Built with **Next.js 16 (App Router) and TypeScript**: pages are React Server Components that query
the domain services directly, and every mutation is a Server Action. Records are edited **in place
on their card** (the Business Central card pattern) rather than in pop-ups; pop-ups are kept for
creating a new record from a list, after which the new card opens. There is no REST layer between
the UI and the business logic — the OData V4 / SOAP web services under `/ODataV4` and `/WS` exist
for external consumers (a parents' app, a USSD gateway, Power BI), not for the UI.

---

## Running it

```bash
npm install
npm run db:migrate   # apply the Prisma schema to DATABASE_URL
npm run dev
```

Then open **http://localhost:3000**.

The database is PostgreSQL, reached through `DATABASE_URL` in `.env` (`docker-compose.yml` brings
one up locally; Neon works too — keep migrations on the direct endpoint, see `prisma.config.ts`).
On first request the system seeds itself; outside production that includes a demonstration school —
an academic year in progress with three terms, 12 classes from PP1 to Grade 8, teaching staff on the
payroll, ~160 students with guardians, a term's timetable, registers, marks, a published set of
report cards, a fee structure invoiced for two terms and part-paid, plus fixed assets, suppliers and
a balanced ledger. `npm run seed` does the same from the command line; `SEED_DEMO_DATA=false` seeds
setup data only (and in production `admin` gets the password from `ADMIN_INITIAL_PASSWORD`, or a
random one logged once at boot).

> On a remote database far from the machine running the seed (250 ms round trips), the first seed
> takes a while — it posts a few hundred fee invoices and receipts through the ledger. Run it from
> the same region as the database (a Vercel build, or `npm run seed` on a server) and it is seconds.

### Sign-in accounts

| Username     | Password         | Role                 | What they see |
|--------------|------------------|----------------------|---------------|
| `admin`      | `admin123`       | System Administrator | Everything, including the Admin Centre |
| `principal`  | `principal123`   | Principal            | The whole school; approves HR, payroll, receipts and journals |
| `registrar`  | `registrar123`   | Academics Officer    | Admissions, classes, timetables, registers, marks, report cards |
| `teacher`    | `teacher123`     | Teacher              | Employee Self Service with the **Teacher Portal** — own classes, register, marks, timetable |
| `bursar`     | `bursar123`      | Bursar               | Fees, receipts, M-Pesa, receivables, the cash office |
| `accountant` | `accountant123`  | Accountant           | Journals, periods, payables, fixed assets, tax, statements |
| `hr`         | `hr123`          | HR & Payroll Officer | Employees, leave, payroll |
| `parent`     | `parent123`      | Student / Parent     | **Parent Portal** — their child's timetable, grades, attendance, fees |
| `student`    | `student123`     | Student / Parent     | **Student Portal** — the same, for themselves |
| `auditor`    | `auditor123`     | Internal Auditor     | Read-only, including the audit trail |

A login becomes a parent or a student through **Admin Centre → System Security → User Setup**,
which links it to a guardian or a student; an employee login becomes a teacher there too — tick
**Teacher** and the Teacher Portal appears inside their Employee Self Service (and the employee is
listed under Teaching Staff). The portals resolve who you are from that link, never from the URL.

### Other commands

```bash
npm test           # the integrity suite, against TEST_DATABASE_URL (a throwaway database)
npm run typecheck  # tsc --noEmit across the whole codebase
npm run lint
npm run build      # production build
npm run seed       # seed an empty database from the command line
npm run db:migrate # apply pending Prisma migrations
npm run db:studio  # browse the data
npm run reset      # drop, re-migrate and reseed — destroys all data
```

---

## What is implemented

### Academics

- **Students** — admission (Admission No. from a No. Series), bio-data, boarding status and house,
  guardians (shared between siblings, matched by name and phone), photo and documents, placement and
  moves between classes (class capacities enforced) with an enrolment history, status changes, and a
  360° card that also shows fees, attendance and marks.
- **End of year** — copy this year's classes into the next year, then promote a class at a time:
  every student defaults to the same-named stream one grade up; change any to repeat or graduate
  and apply. Enrolment history records PROMOTED / REPEATED / GRADUATED.
- **Admissions** — an enquiry → application → offer pipeline; admitting places the applicant in a
  class and creates the student, guardian and fee account in one step.
- **Academic setup** — years and terms (one current), education levels → grade levels → streams
  (classes) per year with a class teacher and capacity, subjects (core or elective) and which grades
  offer them, grading scales — competency bands or letter grades with points, one per education
  level or a school-wide default — and assessment types with weights. All under Admin Centre → Academics.
- **Electives** — core subjects apply to everyone in the grade; a student's electives are ticked on
  their card, and marks entry and report cards follow that list.
- **Teaching staff** — an employee (HR owns the record; payroll pays them) flagged as a teacher with
  TSC number and specialisation, and subject-class assignments per year.
- **Timetable** — per class and term, with clash checks for the class and the teacher; a teacher's
  own view; copy from a previous term.
- **Attendance** — the daily register per class (everyone starts Present), summaries per student,
  class and term.
- **Assessments & report cards** — marks per subject and assessment type, banded by the default
  grading scale; the report card is the weighted subject averages, the overall standing and class
  position (plus mean points and mean grade on a points scale), attendance, and the class teacher's
  and principal's remarks. Drafts stay off the portal until **published** (per student or a whole
  class at once); printable.
- **Discipline & welfare** — discipline cases, sick-bay visits, exeats and notes on the student card,
  with a school-wide log of what is open.
- **Announcements** — to everyone, staff, teachers, students, guardians, a grade or a class, with a
  publish date and expiry; surfaced on the dashboards and both portals, and sendable by SMS and
  e-mail to the guardians and staff addressed (through the outbox).

### Fees — through the ledger

- **Fee items** are income accounts (Tuition, Boarding, Transport…), each marked for who it is
  billed to — everyone, boarders, day scholars, or students who opt in (transport, clubs, lunch);
  the **fee structure** says what each grade pays per term, item by item.
- **Discounts, bursaries and scholarships** per student — a percentage or a fixed amount per term,
  on one item or the whole invoice, for a run of terms or open-ended. They post as a negative line
  to a contra-income account (School Setup), so gross fee income and what was waived both stay
  visible in the ledger.
- A **fee invoice run** bills a term (optionally one grade), in one invoice or in **instalments**
  (e.g. 60% at term start, 40% mid-term — one invoice each, with its own due date): every Active
  student gets a Sales Invoice on their fee account — a Receivables customer opened at admission — released with the
  run's due date and posted, so *School Fees Receivable* and the income accounts move in the G/L.
  Students already invoiced for the term are skipped; failures are reported per student.
- Payments are ordinary **Customer receipts** (cash, bank, M-Pesa), applied to the open invoices.
  **M-Pesa paybill** confirmations match the admission number, the fee-account number or the
  guardian's phone and post themselves; unmatched ones wait for allocation. Parents can also trigger
  an **STK push** from the portal.
- **Balances, overdue** (by invoice due date), **statements** (per student, or a family statement
  per guardian, both printable) and **fee reminders** by
  SMS and e-mail — on demand per student, class or grade, or on a schedule from the job queue.

### Portals

- **Teacher Portal (`/my-classes`)** — part of Employee Self Service for a login marked as a
  teacher in User Setup: my classes, today's lessons, mark the register, enter marks, notices to my
  class. Every action is checked against the teacher's own assignments.
- **Student Portal and Parent Portal (`/portal`)** — two Role Centres over the same pages. A pupil
  lands on today's lessons, their results and attendance, the books they have out and their bus stop;
  a parent lands on fees across all their children, attendance, report cards and notices. Both reach
  the same pages: timetable, marks and published report cards, attendance, fees with statement and
  *Pay with M-Pesa*, announcements, and the bus, boarding and library page. A parent with several
  children switches between them.

### School services — transport, hostel, library

- **Transport (`/transport`)** — a school bus is a **Fixed Asset first** (class VEHICLES, so it
  depreciates and sits on the balance sheet) and a bus card second: registration, seats, insurance
  and inspection expiry, odometer. A **driver is an employee** (HR owns the record); Transport adds
  the driver profile — licence, class, PSV badge and their expiry dates. Each bus has one driver and
  one route; each driver one bus. **Routes** carry ordered stops with pick-up and drop-off times; a
  student is put on a route from their card, which opts them into the Transport fee item so the
  next invoice run bills the fare. **Work tickets** authorise every journey: opened before the bus
  leaves (refused while another ticket is open, or the driver's licence or the bus's insurance has
  lapsed), closed on return with the odometer and fuel taken — the bus's odometer advances with it
  and the fleet summary shows km, litres and km/L per bus. A printable ticket goes with the driver.
  A driver sees their bus and tickets under Employee Self Service.
- **Hostel (`/hostel`)** — houses (boys', girls' or mixed) with a warden, rooms and numbered beds.
  A bed holds one boarder at a time, of the house's gender; allocations are history, not
  overwrites, so a student's beds read like their enrolment. Boarders without a bed queue on the
  Hostel page; beds can be taken out of service.
- **Library (`/library`)** — a catalogue of titles, each copy with its own accession number from
  the No. Series; the loan desk issues to students or staff within the borrowing limits and the
  loan period, blocks a borrower with an overdue book, and a late return carries a fine at the
  set rate. A student's fine is **charged to their fee account** as a posted Sales Invoice against
  the fines income account, so it appears on the fee statement like any other charge.

Parents and students see the bus stop and times, the bed and the books out under the portal's
*Bus, Boarding & Library* page.

### Finance, HR and operations (the back office)

General Ledger with journals, periods and dimensions; Receivables and Payables with posting groups,
reminders, VAT and withholding tax; Cash Management with bank accounts, receipts, payment vouchers
and reconciliation; Fixed Assets with depreciation books; Inventory and requisitions; Budgets;
Imprest and petty cash; Employees, leave, payroll with Kenyan statutory deductions (PAYE bands, NSSF
tiers, SHIF, housing levy) and P9s; Employee Self Service; Approvals with configurable workflows;
Financial Reports (account schedules); an audit trail and change log; System Automation (job queue);
Company management for a group of schools; an AI assistant that can look up students, fees, marks
and the ledger within the caller's permissions.

### Role Centres

Each profile is a landing page — Super, School Administration, Student Portal, Parent Portal, Finance
Manager, Accountant, HR & Payroll, Employee Self Service (which carries the Teacher Portal for
teaching staff) — and scopes the sidebar to its own area. A profile grants no permissions; those come from the role's permission set and any
per-user overrides. *Explore all* (the ☰ button) maps only the Role Centres the user actually
holds, with pages their permission set does not unlock left out — a pupil sees their own portal,
not the Parent Portal that shares its pages, nor the ledger.

---

## How the money works

`lib/accounting.ts` exposes `postJournal(...)`. It is the **only** code in the system that writes to
`journal`, `journal_line`, or `gl_account.balance`. Fee invoices, receipts, payroll, depreciation and
purchases all raise a business event and hand it balanced lines. The engine refuses anything that
would corrupt the ledger:

- debits must equal credits, and the total must be non-zero
- accounts must exist, be active, and be postable (header accounts are rejected)
- the accounting period must be open
- an idempotency key is never honoured twice — a replayed M-Pesa callback returns the original
  receipt instead of posting a second one
- reversals post compensating entries; the original journal is never mutated

Money is stored as **integer minor units** (cents). There is no floating-point arithmetic anywhere
in the financial path. Dates are ISO-8601; timestamps are UTC.

### Worked example — Term 1 fees for a Grade 4 student, then a paybill payment

```
Fee invoice run posts, per student:
DR  1210  School Fees Receivable     34,000.00
CR  4010  Tuition Fees               24,000.00
DR  4090  Bursaries & Discounts       6,000.00   (a 25% tuition bursary, its own line)
CR  4030  Lunch Programme Fees        9,000.00
CR  4050  Activity Fees               2,500.00
CR  4060  Examination Fees            1,500.00
CR  4080  Books and Stationery        3,000.00

M-Pesa confirmation for the admission number posts a Customer receipt:
DR  1030  M-Pesa Paybill             20,000.00
CR  1210  School Fees Receivable     20,000.00
```

The student's fee account (customer ledger) shows the invoice and the payment applied against it;
the balance owing is 14,000.00 and becomes overdue after the run's due date.

---

## Test coverage

`npm test` runs the integrity suite against `TEST_DATABASE_URL` — a database of its own, because it
posts and reverses real journals. It seeds the demonstration school and then checks:

- **Double-entry integrity** — every journal balanced, the trial balance nets to zero, stored
  balances match the journal lines, assets = liabilities + equity + surplus, dated and dimensional
  trial balances.
- **Posting engine controls** — closed periods, non-postable accounts, idempotency keys, reversals.
- **School** — admission opens the fee account and enrols the student; shared guardians; duplicate
  admission numbers refused; moves and status changes; the fee structure drives the invoice run; a
  posted run raises one Sales Invoice per student and moves the receivable by exactly the invoiced
  amount; a second run skips everyone already billed; receipts reduce the balance and the receivable;
  balances and the overdue filter; M-Pesa confirmations match, post, deduplicate and wait for
  allocation when ambiguous; teacher scoping; timetable clash rules; idempotent registers; marks
  bounds and competency bands; report cards built from marks and published explicitly; portal scoping
  for parents and students; announcement audiences; every web-service procedure names a real
  permission.
- **School services** — a bus must be a VEHICLES fixed asset and a driver an employee with a
  licence on file, one driver per bus; work tickets number from their series, default to the bus's
  driver and route, refuse a second open ticket or lapsed papers, advance the odometer on close and
  feed the fleet report; a route assignment opts the student into the Transport fee item and
  removal takes it away; a bed takes one boarder of the house's gender with the history kept; the
  library numbers copies from its series, enforces the loan period, limits and the overdue block,
  fines late returns and charges a student's fine to the fee account through the G/L.
- **Job queue**, **Fixed Assets**, **Receivables**, **Payables**, **Cash Management, VAT & WHT**,
  **Security**, **Financial Reports**, **Role Centres & Profiles** and **per-user permission
  overrides**.

---

## Layout

```
app/                     routes — one folder per module, each with a layout wrapping the AppShell
  students/ guardians/ teachers/ classes/ timetable/ attendance/ assessments/ report-cards/
  announcements/ fees/   the academics and fees modules
  admissions/ incidents/ the admissions pipeline; discipline, medical and exeat records
  transport/ hostel/ library/  school services — buses (fixed assets), drivers (employees), routes, work tickets; beds; the catalogue and loan desk
  my-classes/            the Teacher Portal (inside Employee Self Service)
  portal/                the student and parent portal
  admin/                 the Admin Centre (setup pool, security, workflows, data, companies)
  actions/               Server Actions — thin permission-checking wrappers over lib/
  api/ ODataV4/ WS/      callbacks (M-Pesa), exports, the OData and SOAP web services
  print/[kind]/[no]/     every printable document (report cards, fee and family statements, class lists and
                         register sheets, student ID cards, leaving certificates, bus work tickets, invoices, payslips…)
components/              UI primitives, layout, the school sheets (register, marks, timetable, report card)
lib/                     the domain services — no HTTP or React
  academics/             setup, teachers, timetable, attendance, assessments
  fees/                  setup, invoices (the run → Sales Invoice bridge), statement, reminders
  transport.ts hostel.ts library.ts  the school services
  students.ts portal.ts announcements.ts mpesa/ accounting.ts gl.ts receipts.ts …
  permissions.ts         the catalogue of pages and actions with their table rights
  nav.ts adminNav.ts     the sidebar and the Admin Centre pool, scoped by Role Centre
  seed.ts                first-boot setup data and the demonstration school
prisma/                  the schema and migrations
test/verify.ts           the integrity suite
```

---

## Production notes

- **Database** — Prisma owns the schema and migrations under `prisma/`. Money columns are `bigint`
  cents. Behind a serverless platform, point `DATABASE_URL` at a pooled endpoint (Neon's `-pooler`
  host) and keep migrations on the direct one — `prisma.config.ts` derives it.
- **Query layer** — every statement goes through the helpers in `lib/db.ts` (`one`, `all`, `run`,
  `tx`), which translate `?`/`@named` placeholders to `$n` and coerce `bigint` to `number` at the
  boundary.
- **Integrations** — M-Pesa Daraja (`MPESA_*`), SMS (`SMS_*`), e-mail through Resend
  (`RESEND_API_KEY`), Cloudinary for photos and documents (`CLOUDINARY_*`), Anthropic for the
  assistant (`ANTHROPIC_API_KEY`). Each degrades gracefully when unset; the outbox keeps what could
  not be sent.
- **Background work** — the job queue (session purge, outbox dispatch, M-Pesa STK follow-up, fee
  reminders) is polled from `instrumentation.ts` in a long-running Node process; on a serverless
  platform call `/api/internal/job-queue-tick` from an external scheduler instead.
- **Security** — the session cookie is `httpOnly`, `sameSite=lax` and `secure` in production;
  forced password change and two-factor enrolment are enforced by `proxy.ts` (Next 16's successor to
  middleware) and `lib/auth.ts`; Server Actions carry Next.js's own origin check. HTTPS termination,
  rate limiting, secret management and backup verification are the deployment's job.
