-- Electives per student, grading scales per education level with points, fee instalments,
-- the admissions pipeline and student incidents (discipline / medical / exeats).
CREATE TABLE "student_subject" (
    "id" SERIAL NOT NULL,
    "student_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "academic_year_id" INTEGER NOT NULL,
    "created_at" TEXT,
    "created_by" TEXT,
    CONSTRAINT "student_subject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ux_student_subject" ON "student_subject"("student_id", "subject_id", "academic_year_id");
CREATE INDEX "ix_student_subject_subject_year" ON "student_subject"("subject_id", "academic_year_id");

ALTER TABLE "grading_scale" ADD COLUMN "education_level_id" INTEGER;
ALTER TABLE "assessment_band" ADD COLUMN "points" INTEGER;

ALTER TABLE "fee_invoice_run" ADD COLUMN "instalments" TEXT;
ALTER TABLE "fee_invoice" ADD COLUMN "instalment_no" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "ux_fee_invoice_student_term";
CREATE UNIQUE INDEX "ux_fee_invoice_student_term" ON "fee_invoice"("student_id", "term_id", "instalment_no");

CREATE TABLE "admission_application" (
    "id" SERIAL NOT NULL,
    "no" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT NOT NULL,
    "gender" TEXT,
    "date_of_birth" TEXT,
    "previous_school" TEXT,
    "grade_level_id" INTEGER NOT NULL,
    "academic_year_id" INTEGER NOT NULL,
    "boarding_status" TEXT NOT NULL DEFAULT 'DAY',
    "guardian_name" TEXT NOT NULL,
    "guardian_phone" TEXT NOT NULL,
    "guardian_email" TEXT,
    "guardian_relationship" TEXT NOT NULL DEFAULT 'Parent',
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENQUIRY',
    "student_id" INTEGER,
    "applied_at" TEXT NOT NULL,
    "decided_at" TEXT,
    "created_by" TEXT,
    CONSTRAINT "admission_application_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admission_application_no_key" ON "admission_application"("no");
CREATE INDEX "ix_admission_application_status" ON "admission_application"("status");

CREATE TABLE "student_incident" (
    "id" SERIAL NOT NULL,
    "student_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "action_taken" TEXT,
    "follow_up" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "recorded_by" TEXT,
    "recorded_at" TEXT,
    CONSTRAINT "student_incident_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ix_student_incident_student" ON "student_incident"("student_id", "date");
