-- 008_timetable_generation.sql
--
-- Adds what's needed to auto-generate timetables instead of only
-- hand-creating slots one at a time:
--
-- 1. teaching_assignments.periods_per_week — the generator needs to know
--    how many periods/week each subject-teacher-class combination needs;
--    there was previously no way to express that at all.
-- 2. timetable_configs — one row per school, since "how many periods a
--    day" was explicitly left configurable per school rather than a
--    fixed constant.

BEGIN;

ALTER TABLE public.teaching_assignments
  ADD COLUMN periods_per_week smallint NOT NULL DEFAULT 5
    CHECK (periods_per_week > 0 AND periods_per_week <= 20);

CREATE TABLE public.timetable_configs (
  school_id bigint PRIMARY KEY REFERENCES public.schools(id),
  -- ISO day numbers, 1=Monday .. 7=Sunday, matching timetable_slots.day_of_week's
  -- existing CHECK (day_of_week BETWEEN 1 AND 7).
  working_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  periods_per_day smallint NOT NULL DEFAULT 8 CHECK (periods_per_day > 0 AND periods_per_day <= 15),
  period_duration_minutes smallint NOT NULL DEFAULT 40 CHECK (period_duration_minutes > 0),
  day_start_time time without time zone NOT NULL DEFAULT '08:00',
  -- e.g. [{"after_period": 2, "duration_minutes": 20, "label": "Short break"},
  --       {"after_period": 5, "duration_minutes": 40, "label": "Lunch"}]
  -- Purely for computing display start/end times between periods — breaks
  -- are not themselves schedulable slots, so they don't participate in
  -- the generator's conflict logic at all.
  breaks jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.timetable_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_timetable_configs ON public.timetable_configs
  USING (school_id = (current_setting('app.current_school_id'::text))::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.timetable_configs TO app_user;

COMMIT;
