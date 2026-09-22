-- The organisation card's SACCO-era column names, renamed for a school; the theme preset key with them.
ALTER TABLE "organisation" RENAME COLUMN "society_type" TO "school_type";
ALTER TABLE "organisation" RENAME COLUMN "sasra_licence_no" TO "licence_no";
ALTER TABLE "organisation" ALTER COLUMN "school_type" SET DEFAULT 'Private Primary School';
UPDATE "organisation" SET "school_type" = 'Private Primary School' WHERE "school_type" = 'Deposit Taking SACCO';
UPDATE "theme" SET "preset" = 'school-blue' WHERE "preset" = 'sacco-blue';
