-- Boarding status, house and class capacity; fee items that apply to boarders / day scholars / opt-in;
-- per-student optional items and discounts; the contra-income account discounts post to.
ALTER TABLE "student" ADD COLUMN "boarding_status" TEXT NOT NULL DEFAULT 'DAY';
ALTER TABLE "student" ADD COLUMN "house" TEXT;
ALTER TABLE "fee_item" ADD COLUMN "applies_to" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "stream" ADD COLUMN "capacity" INTEGER;
ALTER TABLE "organisation" ADD COLUMN "fee_discount_account_id" INTEGER;

CREATE TABLE "student_fee_option" (
    "id" SERIAL NOT NULL,
    "student_id" INTEGER NOT NULL,
    "fee_item_id" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TEXT,
    "created_by" TEXT,
    CONSTRAINT "student_fee_option_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ux_student_fee_option" ON "student_fee_option"("student_id", "fee_item_id");

CREATE TABLE "student_fee_discount" (
    "id" SERIAL NOT NULL,
    "student_id" INTEGER NOT NULL,
    "fee_item_id" INTEGER,
    "percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "from_term_id" INTEGER,
    "to_term_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TEXT,
    "created_by" TEXT,
    CONSTRAINT "student_fee_discount_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ix_student_fee_discount_student" ON "student_fee_discount"("student_id");
