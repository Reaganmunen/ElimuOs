-- 007_tenant_isolation_hardening.sql
--
-- Closes three gaps found during a full backend review:
--
-- 1. school_subscriptions had RLS disabled entirely — every other
--    tenant-owned table has ENABLE ROW LEVEL SECURITY + a
--    tenant_isolation_* policy; this one, which gates paid access to the
--    whole platform, had neither. It was only safe because every model
--    function happened to include "WHERE school_id = $x" by hand — there
--    was no database-level backstop if a future query missed it.
--
-- 2. guardians.user_id had no unique index, unlike students.user_id
--    (idx_students_user_id). Under a race between two concurrent
--    "create portal account" calls for the same guardian, two different
--    user rows could each get linked, one silently overwriting the
--    other in the UPDATE — an orphaned, unreachable login with no
--    error raised anywhere.
--
-- 3. student_guardians' RLS policy only checks that student_id belongs
--    to the current tenant; it never checks guardian_id at all, so a
--    cross-tenant guardianId can be linked to a student with no error.
--    RLS alone can't fully close this (guardian_id has no tenant column
--    to compare against without a subquery per-row on every operation),
--    so the real fix is at the application layer (see guardian.model.js
--    linkToStudent). This migration tightens the policy to at least
--    reject guardians that don't belong to ANY school matching the
--    current tenant, as defense in depth alongside that app-level check.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. school_subscriptions: enable RLS + tenant isolation policy
-- ---------------------------------------------------------------------
ALTER TABLE public.school_subscriptions ENABLE ROW LEVEL SECURITY;

-- Mirrors the audit_logs / mpesa_transactions / users pattern: permissive
-- when no tenant context is set (plain query() calls — super_admin's
-- listAllSubscriptions, expireOldTrials, and activate/cancel which are
-- resolved by subscription id first, then re-scoped by school_id in the
-- WHERE clause of the UPDATE itself) but strictly scoped whenever
-- app.current_school_id IS set (i.e. anything running through
-- withTenantClient).
CREATE POLICY tenant_isolation_school_subscriptions ON public.school_subscriptions
  USING (
    (current_setting('app.current_school_id'::text, true) IS NULL)
    OR (school_id = (current_setting('app.current_school_id'::text, true))::bigint)
  );

-- ---------------------------------------------------------------------
-- 2. guardians.user_id: one portal account per guardian, enforced by DB
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_guardians_user_id
  ON public.guardians (user_id)
  WHERE (user_id IS NOT NULL);

-- ---------------------------------------------------------------------
-- 3. student_guardians: tighten the policy to also require the guardian
--    belong to the same tenant as the student, not just the student.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation_student_guardians ON public.student_guardians;

CREATE POLICY tenant_isolation_student_guardians ON public.student_guardians
  USING (
    student_id IN (
      SELECT id FROM public.students
      WHERE school_id = (current_setting('app.current_school_id'::text))::bigint
    )
    AND guardian_id IN (
      SELECT id FROM public.guardians
      WHERE school_id = (current_setting('app.current_school_id'::text))::bigint
    )
  );

COMMIT;

-- After running this, verify the connection role used by the app
-- (see config/db.js) does NOT have BYPASSRLS or superuser — if it does,
-- every policy in this database (not just the ones touched here) is
-- silently ignored:
--
--   SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user';
--
-- Both rolsuper and rolbypassrls must be false.
