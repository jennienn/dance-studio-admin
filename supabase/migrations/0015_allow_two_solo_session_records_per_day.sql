-- 운영자 수업 기록도 같은 수강권·같은 날짜에 최대 2회까지 허용한다.
drop index if exists idx_sessions_no_duplicate_date;
create index idx_sessions_cycle_date on sessions(cycle_id, date) where date is not null;

create or replace function record_solo_session_atomic(
  p_cycle_id uuid, p_session_index integer, p_date date, p_expired boolean, p_note text
) returns integer language plpgsql as $$
declare
  v_cycle enrollment_cycles%rowtype;
  v_updated integer;
begin
  select ec.* into v_cycle from enrollment_cycles ec
    join enrollments e on e.id = ec.enrollment_id
    where ec.id = p_cycle_id and ec.status = 'active' and e.kind = 'solo'
    for update of ec;
  if not found then
    raise exception 'NOT_FOUND: 활성 개인레슨 주기를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if (
    select count(*) from sessions
    where cycle_id = p_cycle_id and date = p_date and status in ('done', 'auto')
  ) >= 2 then
    raise exception 'SAME_DAY_SESSION_LIMIT' using errcode = '22023';
  end if;
  update sessions
  set date = p_date, status = case when p_expired then 'auto' else 'done' end, note = p_note
  where cycle_id = p_cycle_id and session_index = p_session_index and status = 'pending';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'VALIDATION_ERROR: 이미 기록되었거나 존재하지 않는 회차입니다' using errcode = '22023';
  end if;
  update enrollment_cycles
  set used_count = (select count(*) from sessions where cycle_id = p_cycle_id and status in ('done', 'auto')),
      first_class_date = coalesce(first_class_date, p_date),
      valid_end_date = coalesce(valid_end_date, fixed_term_valid_end(p_date, case plan when 4 then 5 when 8 then 9 when 12 then 13 end))
  where id = p_cycle_id
  returning used_count into v_updated;
  perform sync_package_validity_for_cycle(p_cycle_id);
  return v_updated;
end;
$$;
