-- User Setup "Teacher": the Teacher Portal shows inside Employee Self Service only for logins marked as teaching staff.
ALTER TABLE "approval_user_setup" ADD COLUMN "is_teacher" INTEGER NOT NULL DEFAULT 0;
