-- 009_guardian_enquiry_forwarding.sql
--
-- Lets a school admin forward a guardian's enquiry to the teacher who should
-- answer it. The teacher then sees it in their own "Guardian inbox" and can
-- reply; the guardian sees the reply in the parent portal as before.
--
-- Assumes guardian_enquiries already exists (created outside the numbered
-- migrations in this repo) with users.id / school_id as bigint.

BEGIN;

ALTER TABLE public.guardian_enquiries
  ADD COLUMN IF NOT EXISTS assigned_to  bigint REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forwarded_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forwarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS forward_note text;

CREATE INDEX IF NOT EXISTS idx_guardian_enquiries_assigned
  ON public.guardian_enquiries (school_id, assigned_to)
  WHERE assigned_to IS NOT NULL;

-- Helps the class-teacher scoping of absence notices.
CREATE INDEX IF NOT EXISTS idx_absence_reports_student
  ON public.absence_reports (school_id, student_id);

COMMIT;
