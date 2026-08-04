-- 고정 기간형 수강권은 시작일을 1일 차로 포함한다.
-- 예: 9주는 시작일 + 62일이며, 시작일과 종료일을 포함해 총 63일이다.
create or replace function fixed_term_valid_end(p_start_date date, p_valid_weeks integer)
returns date language sql immutable strict as $$
  select p_start_date + (p_valid_weeks * 7 - 1);
$$;

revoke all on function fixed_term_valid_end(date,integer) from public, anon;
grant execute on function fixed_term_valid_end(date,integer) to authenticated, service_role;

create or replace function sync_package_validity_for_cycle(p_cycle_id uuid)
returns void language plpgsql as $$
declare
  v_package_id uuid;
  v_valid_weeks integer;
  v_solo_cycle_id uuid;
  v_group_cycle_id uuid;
  v_min_date date;
begin
  select e.package_id, p.valid_weeks into v_package_id, v_valid_weeks
  from enrollment_cycles ec
  join enrollments e on e.id = ec.enrollment_id
  join enrollment_packages p on p.id = e.package_id and p.status = 'active'
  where ec.id = p_cycle_id;

  if v_package_id is null then return; end if;

  select ec.id into v_solo_cycle_id from enrollment_cycles ec
    join enrollments e on e.id = ec.enrollment_id
    where e.package_id = v_package_id and e.kind = 'solo' and ec.status = 'active';
  select ec.id into v_group_cycle_id from enrollment_cycles ec
    join enrollments e on e.id = ec.enrollment_id
    where e.package_id = v_package_id and e.kind = 'group' and ec.status = 'active';

  select min(d) into v_min_date from (
    select min(date) d from sessions where cycle_id = v_solo_cycle_id and status in ('done', 'auto')
    union all
    select min(date) d from attendance_logs where cycle_id = v_group_cycle_id and attended = true
  ) x;

  update enrollment_cycles
  set first_class_date = v_min_date,
      valid_end_date = case when v_min_date is null then null else fixed_term_valid_end(v_min_date, v_valid_weeks) end
  where id in (v_solo_cycle_id, v_group_cycle_id);
end;
$$;

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

create or replace function delete_solo_session_atomic(p_cycle_id uuid, p_session_index integer)
returns integer language plpgsql as $$
declare
  v_plan integer;
  v_first date;
  v_used integer;
begin
  select ec.plan into v_plan from enrollment_cycles ec
    join enrollments e on e.id = ec.enrollment_id
    where ec.id = p_cycle_id and ec.status = 'active' and e.kind = 'solo'
    for update of ec;
  if not found then
    raise exception 'NOT_FOUND: 활성 개인레슨 주기를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  update sessions set date = null, status = 'pending', note = null
  where cycle_id = p_cycle_id and session_index = p_session_index;
  select count(*), min(date) into v_used, v_first
  from sessions where cycle_id = p_cycle_id and status in ('done', 'auto');
  update enrollment_cycles
  set used_count = v_used,
      first_class_date = v_first,
      valid_end_date = case
        when v_first is null then null
        else fixed_term_valid_end(v_first, case v_plan when 4 then 5 when 8 then 9 when 12 then 13 end)
      end
  where id = p_cycle_id;
  perform sync_package_validity_for_cycle(p_cycle_id);
  return v_used;
end;
$$;

create or replace function create_solo_booking_atomic(p_cycle_id uuid, p_date date, p_start_minute integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cycle enrollment_cycles%rowtype;
  v_member bigint;
  v_end date;
  v_id uuid;
  v_weekday integer;
  v_korea_now timestamp := now() at time zone 'Asia/Seoul';
  v_minimum_start integer;
begin
  select ec.* into v_cycle from enrollment_cycles ec join enrollments e on e.id=ec.enrollment_id
  where ec.id=p_cycle_id and ec.status='active' and e.status='active' and e.kind='solo' for update of ec;
  if not found then raise exception 'NOT_FOUND: 활성 개인레슨 수강권이 없습니다' using errcode='P0002'; end if;
  select e.member_id into v_member from enrollments e where e.id=v_cycle.enrollment_id;
  v_end := coalesce(
    v_cycle.valid_end_date,
    fixed_term_valid_end(v_cycle.payment_date, case v_cycle.plan when 4 then 5 when 8 then 9 when 12 then 13 end)
  );

  if p_date < greatest(v_korea_now::date, v_cycle.payment_date) or p_date > v_end then
    raise exception 'BOOKING_DATE_INVALID' using errcode='22023';
  end if;
  if p_start_minute < 600 or p_start_minute > 1260 or p_start_minute % 30 <> 0 then
    raise exception 'BOOKING_TIME_INVALID' using errcode='22023';
  end if;

  if p_date = v_korea_now::date then
    v_minimum_start := extract(hour from v_korea_now)::integer * 60
      + extract(minute from v_korea_now)::integer + 120;
    if p_start_minute < v_minimum_start then
      raise exception 'BOOKING_ADVANCE_NOTICE_REQUIRED' using errcode='22023';
    end if;
  end if;

  v_weekday := extract(dow from p_date);
  if (v_weekday between 1 and 4 and int4range(p_start_minute,p_start_minute+60,'[)') && int4range(1200,1260,'[)'))
    or (v_weekday in (2,4) and int4range(p_start_minute,p_start_minute+60,'[)') && int4range(660,720,'[)')) then
    raise exception 'GROUP_CLASS_OVERLAP' using errcode='22023';
  end if;
  if (select count(*) from solo_bookings where cycle_id=p_cycle_id and status='confirmed') >= v_cycle.total_count-v_cycle.used_count then
    raise exception 'NO_REMAINING_BOOKINGS' using errcode='22023';
  end if;
  insert into solo_bookings(cycle_id,member_id,booking_date,start_minute) values(p_cycle_id,v_member,p_date,p_start_minute) returning id into v_id;
  return v_id;
exception when exclusion_violation or unique_violation then raise exception 'BOOKING_CONFLICT' using errcode='23P01';
end; $$;

revoke all on function create_solo_booking_atomic(uuid,date,integer) from public, anon;
grant execute on function create_solo_booking_atomic(uuid,date,integer) to service_role;

-- 이미 시작된 수강권도 새 포함 계산법으로 하루 앞당겨 보정한다.
update enrollment_cycles ec
set valid_end_date = fixed_term_valid_end(
  ec.first_class_date,
  case ec.plan when 4 then 5 when 8 then 9 when 12 then 13 end
)
from enrollments e
where e.id = ec.enrollment_id
  and e.kind = 'solo'
  and e.package_id is null
  and ec.first_class_date is not null
  and ec.plan in (4, 8, 12);

update enrollment_cycles ec
set valid_end_date = fixed_term_valid_end(ec.first_class_date, p.valid_weeks)
from enrollments e
join enrollment_packages p on p.id = e.package_id
where e.id = ec.enrollment_id
  and ec.first_class_date is not null;
