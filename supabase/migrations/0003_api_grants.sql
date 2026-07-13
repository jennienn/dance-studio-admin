-- Supabase projects created with auto_expose_new_tables=false do not implicitly grant
-- Data API privileges. RLS still controls row access after these object grants.
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on table
  members,
  classes,
  class_schedules,
  enrollments,
  enrollment_cycles,
  cycle_schedules,
  payments,
  sessions,
  attendance_logs,
  notifications
to authenticated, service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
