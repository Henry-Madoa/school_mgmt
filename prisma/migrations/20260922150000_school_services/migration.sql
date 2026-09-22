-- School services: transport (drivers, buses as fixed assets, routes and stops, student rides, work tickets),
-- hostel (blocks, rooms, beds, allocations) and library (setup, catalogue, copies, loans).
CREATE TABLE "driver_profile" ("id" SERIAL NOT NULL, "employee_id" INTEGER NOT NULL, "licence_no" TEXT NOT NULL, "licence_class" TEXT, "licence_expiry" TEXT, "psv_badge_no" TEXT, "psv_expiry" TEXT, "notes" TEXT, "created_at" TEXT, CONSTRAINT "driver_profile_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ux_driver_profile_employee" ON "driver_profile"("employee_id");

CREATE TABLE "school_bus" ("id" SERIAL NOT NULL, "fixed_asset_no" TEXT NOT NULL, "registration_no" TEXT NOT NULL, "make_model" TEXT, "capacity" INTEGER NOT NULL DEFAULT 0, "driver_employee_id" INTEGER, "route_id" INTEGER, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "insurance_expiry" TEXT, "inspection_expiry" TEXT, "odometer" INTEGER NOT NULL DEFAULT 0, "notes" TEXT, "created_at" TEXT, "created_by" TEXT, CONSTRAINT "school_bus_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ux_school_bus_asset" ON "school_bus"("fixed_asset_no");
CREATE UNIQUE INDEX "ux_school_bus_reg" ON "school_bus"("registration_no");
CREATE INDEX "ix_school_bus_route" ON "school_bus"("route_id");

CREATE TABLE "transport_route" ("id" SERIAL NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "term_fare" BIGINT NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "created_at" TEXT, CONSTRAINT "transport_route_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "transport_route_code_key" ON "transport_route"("code");

CREATE TABLE "transport_stop" ("id" SERIAL NOT NULL, "route_id" INTEGER NOT NULL, "name" TEXT NOT NULL, "pickup_time" TEXT, "dropoff_time" TEXT, "sort" INTEGER NOT NULL DEFAULT 1, CONSTRAINT "transport_stop_pkey" PRIMARY KEY ("id"));
CREATE INDEX "ix_transport_stop_route" ON "transport_stop"("route_id");

CREATE TABLE "student_transport" ("id" SERIAL NOT NULL, "student_id" INTEGER NOT NULL, "route_id" INTEGER NOT NULL, "stop_id" INTEGER, "direction" TEXT NOT NULL DEFAULT 'BOTH', "note" TEXT, "created_at" TEXT, "created_by" TEXT, CONSTRAINT "student_transport_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ux_student_transport_student" ON "student_transport"("student_id");
CREATE INDEX "ix_student_transport_route" ON "student_transport"("route_id");

CREATE TABLE "bus_work_ticket" ("id" SERIAL NOT NULL, "no" TEXT NOT NULL, "bus_id" INTEGER NOT NULL, "driver_employee_id" INTEGER NOT NULL, "route_id" INTEGER, "date" TEXT NOT NULL, "purpose" TEXT NOT NULL DEFAULT 'ROUTE_RUN', "destination" TEXT, "odometer_start" INTEGER, "odometer_end" INTEGER, "fuel_litres" DOUBLE PRECISION NOT NULL DEFAULT 0, "fuel_cost" BIGINT NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'OPEN', "remarks" TEXT, "authorised_by" TEXT, "created_at" TEXT, "closed_at" TEXT, CONSTRAINT "bus_work_ticket_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "bus_work_ticket_no_key" ON "bus_work_ticket"("no");
CREATE INDEX "ix_work_ticket_bus_date" ON "bus_work_ticket"("bus_id", "date");
CREATE INDEX "ix_work_ticket_driver_date" ON "bus_work_ticket"("driver_employee_id", "date");

CREATE TABLE "hostel" ("id" SERIAL NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "gender" TEXT NOT NULL DEFAULT 'MIXED', "warden_employee_id" INTEGER, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "notes" TEXT, CONSTRAINT "hostel_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "hostel_code_key" ON "hostel"("code");
CREATE TABLE "hostel_room" ("id" SERIAL NOT NULL, "hostel_id" INTEGER NOT NULL, "name" TEXT NOT NULL, "floor" TEXT, "sort" INTEGER NOT NULL DEFAULT 1, CONSTRAINT "hostel_room_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ux_hostel_room" ON "hostel_room"("hostel_id", "name");
CREATE TABLE "hostel_bed" ("id" SERIAL NOT NULL, "room_id" INTEGER NOT NULL, "label" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'AVAILABLE', CONSTRAINT "hostel_bed_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ux_hostel_bed" ON "hostel_bed"("room_id", "label");
CREATE TABLE "bed_allocation" ("id" SERIAL NOT NULL, "bed_id" INTEGER NOT NULL, "student_id" INTEGER NOT NULL, "academic_year_id" INTEGER NOT NULL, "from_date" TEXT NOT NULL, "to_date" TEXT, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "created_by" TEXT, "created_at" TEXT, CONSTRAINT "bed_allocation_pkey" PRIMARY KEY ("id"));
CREATE INDEX "ix_bed_allocation_student" ON "bed_allocation"("student_id", "status");
CREATE INDEX "ix_bed_allocation_bed" ON "bed_allocation"("bed_id", "status");

CREATE TABLE "library_setup" ("id" INTEGER NOT NULL DEFAULT 1, "loan_days" INTEGER NOT NULL DEFAULT 14, "fine_per_day" BIGINT NOT NULL DEFAULT 0, "max_loans_student" INTEGER NOT NULL DEFAULT 2, "max_loans_staff" INTEGER NOT NULL DEFAULT 5, "fine_gl_account_id" INTEGER, CONSTRAINT "library_setup_pkey" PRIMARY KEY ("id"));
CREATE TABLE "library_book" ("id" SERIAL NOT NULL, "isbn" TEXT, "title" TEXT NOT NULL, "author" TEXT, "publisher" TEXT, "year" INTEGER, "category" TEXT, "location" TEXT, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "created_at" TEXT, CONSTRAINT "library_book_pkey" PRIMARY KEY ("id"));
CREATE INDEX "ix_library_book_title" ON "library_book"("title");
CREATE TABLE "library_copy" ("id" SERIAL NOT NULL, "book_id" INTEGER NOT NULL, "accession_no" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'AVAILABLE', "condition" TEXT, "added_at" TEXT, CONSTRAINT "library_copy_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ux_library_copy_accession" ON "library_copy"("accession_no");
CREATE INDEX "ix_library_copy_book" ON "library_copy"("book_id");
CREATE TABLE "library_loan" ("id" SERIAL NOT NULL, "copy_id" INTEGER NOT NULL, "student_id" INTEGER, "employee_id" INTEGER, "issued_on" TEXT NOT NULL, "due_on" TEXT NOT NULL, "returned_on" TEXT, "status" TEXT NOT NULL DEFAULT 'ON_LOAN', "fine_amount" BIGINT NOT NULL DEFAULT 0, "fine_invoice_no" TEXT, "issued_by" TEXT, "returned_by" TEXT, "remarks" TEXT, CONSTRAINT "library_loan_pkey" PRIMARY KEY ("id"));
CREATE INDEX "ix_library_loan_copy" ON "library_loan"("copy_id", "status");
CREATE INDEX "ix_library_loan_student" ON "library_loan"("student_id", "status");
CREATE INDEX "ix_library_loan_employee" ON "library_loan"("employee_id", "status");
