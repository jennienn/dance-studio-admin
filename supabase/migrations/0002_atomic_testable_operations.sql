-- Multi-table writes must be atomic. Every exception raised inside these functions
-- rolls the complete statement back, so API callers never observe half-created data.

create or replace function check_class_capacity()
returns trigger as $$
declare
  v_class_id bigint;
  v_capacity integer;
  v_enrollment_id uuid;
  v_current_count integer;
begin
  select cs.class_id, c.capacity into v_class_id, v_capacity
  from class_schedules cs
  join classes c on c.id = cs.class_id
  where cs.id = new.schedule_id;

  select enrollment_id into v_enrollment_id
  from enrollment_cycles
  where id = new.cycle_id;

  -- A second weekday for an enrollment already counted in this class does not consume another seat.
  if exists (
    select 1
    from cycle_schedules csch
    join enrollment_cycles ec on ec.id = csch.cycle_id
    join class_schedules cs on cs.id = csch.schedule_id
    where cs.class_id = v_class_id
      and ec.enrollment_id = v_enrollment_id
      and ec.status = 'active'
  ) then
    return new;
  end if;

  select count(distinct ec.enrollment_id) into v_current_count
  from cycle_schedules csch
  join enrollment_cycles ec on ec.id = csch.cycle_id
  join enrollments e on e.id = ec.enrollment_id
  join class_schedules cs2 on cs2.id = csch.schedule_id
  where cs2.class_id = v_class_id
    and ec.status = 'active'
    and e.status = 'active';

  if v_current_count >= v_capacity then
    raise exception 'CLASS_CAPACITY_EXCEEDED: 반 정원(%)을 초과했습니다', v_capacity
      using errcode = '23514';
  end if;
  return new;
end;
$$ language plpgsql;

create or replace function create_enrollment_with_cycle_atomic(
  p_member_id bigint,
  p_kind text,
  p_plan integer,
  p_class_name text,
  p_schedule_ids bigint[],
  p_amount integer,
  p_method text,
  p_payment_date date
) returns table(enrollment_id uuid, cycle_id uuid)
language plpgsql
as $$
declare
  v_class_id bigint;
  v_base_count integer;
  v_enrollment_id uuid;
  v_cycle_id uuid;
begin
  if p_kind not in ('solo', 'group') then
    raise exception 'VALIDATION_ERROR: 잘못된 수강 종류입니다' using errcode = '22023';
  end if;
  if p_amount <= 0 or p_payment_date is null or p_method not in ('card', 'transfer', 'cash') then
    raise exception 'VALIDATION_ERROR: 결제 정보를 확인해주세요' using errcode = '22023';
  end if;

  if p_kind = 'solo' then
    if p_plan not in (4, 8, 12) then
      raise exception 'VALIDATION_ERROR: 개인레슨 회차를 확인해주세요' using errcode = '22023';
    end if;
    v_base_count := p_plan;
  else
    select id into v_class_id from classes where name = p_class_name and active = true;
    if v_class_id is null or coalesce(array_length(p_schedule_ids, 1), 0) = 0 then
      raise exception 'VALIDATION_ERROR: 반과 요일을 확인해주세요' using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(p_schedule_ids) sid
      left join class_schedules cs on cs.id = sid and cs.class_id = v_class_id
      where cs.id is null
    ) then
      raise exception 'VALIDATION_ERROR: 선택한 반에 속하지 않는 요일입니다' using errcode = '22023';
    end if;
    v_base_count := 8;
  end if;

  insert into enrollments(member_id, kind, class_id)
  values (p_member_id, p_kind, v_class_id)
  returning id into v_enrollment_id;

  insert into enrollment_cycles(
    enrollment_id, plan, base_count, carry_over_count, total_count, used_count,
    next_due_date, payment_date
  ) values (
    v_enrollment_id,
    case when p_kind = 'solo' then p_plan else null end,
    v_base_count, 0, v_base_count, 0,
    case when p_kind = 'group' then p_payment_date + 35 else null end,
    p_payment_date
  ) returning id into v_cycle_id;

  if p_kind = 'solo' then
    insert into sessions(cycle_id, session_index, status)
    select v_cycle_id, n, 'pending' from generate_series(1, v_base_count) n;
  else
    insert into cycle_schedules(cycle_id, schedule_id)
    select v_cycle_id, sid from unnest(p_schedule_ids) sid;
  end if;

  insert into payments(cycle_id, amount, method, payment_date, status)
  values (v_cycle_id, p_amount, p_method, p_payment_date, 'completed');
  enrollment_id := v_enrollment_id;
  cycle_id := v_cycle_id;
  return next;
end;
$$;

create or replace function create_member_with_enrollment_atomic(
  p_name text,
  p_phone text,
  p_kind text,
  p_plan integer,
  p_class_name text,
  p_schedule_ids bigint[],
  p_amount integer,
  p_method text,
  p_payment_date date
) returns table(member_id bigint, enrollment_id uuid, cycle_id uuid)
language plpgsql
as $$
begin
  if nullif(trim(p_name), '') is null or nullif(trim(p_phone), '') is null then
    raise exception 'VALIDATION_ERROR: 이름과 연락처를 입력해주세요' using errcode = '22023';
  end if;
  insert into members(name, phone) values (trim(p_name), trim(p_phone)) returning id into member_id;
  select result.enrollment_id, result.cycle_id into enrollment_id, cycle_id
  from create_enrollment_with_cycle_atomic(
    member_id, p_kind, p_plan, p_class_name, p_schedule_ids, p_amount, p_method, p_payment_date
  ) result;
  return next;
end;
$$;

create or replace function renew_enrollment_atomic(
  p_enrollment_id uuid,
  p_plan integer,
  p_schedule_ids bigint[],
  p_amount integer,
  p_method text,
  p_payment_date date
) returns table(cycle_id uuid, total_count integer)
language plpgsql
as $$
declare
  v_enrollment enrollments%rowtype;
  v_current enrollment_cycles%rowtype;
  v_base integer;
  v_carry integer := 0;
  v_schedule_ids bigint[];
  v_cycle_id uuid;
  v_total_count integer;
begin
  select * into v_enrollment from enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'NOT_FOUND: 수강권을 찾을 수 없습니다' using errcode = 'P0002'; end if;
  if p_amount <= 0 or p_payment_date is null or p_method not in ('card', 'transfer', 'cash') then
    raise exception 'VALIDATION_ERROR: 결제 정보를 확인해주세요' using errcode = '22023';
  end if;

  select * into v_current from enrollment_cycles
  where enrollment_id = p_enrollment_id and status = 'active' for update;

  if v_enrollment.kind = 'solo' then
    if p_plan not in (4, 8, 12) then
      raise exception 'VALIDATION_ERROR: 개인레슨 회차를 확인해주세요' using errcode = '22023';
    end if;
    v_base := p_plan;
    if v_current.id is not null then v_carry := greatest(0, v_current.total_count - v_current.used_count); end if;
  else
    v_base := 8;
    v_schedule_ids := p_schedule_ids;
    if coalesce(array_length(v_schedule_ids, 1), 0) = 0 and v_current.id is not null then
      select array_agg(schedule_id order by schedule_id) into v_schedule_ids
      from cycle_schedules where cycle_schedules.cycle_id = v_current.id;
    end if;
    if coalesce(array_length(v_schedule_ids, 1), 0) = 0 then
      raise exception 'VALIDATION_ERROR: 요일을 하나 이상 선택해주세요' using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(v_schedule_ids) sid
      left join class_schedules cs on cs.id = sid and cs.class_id = v_enrollment.class_id
      where cs.id is null
    ) then
      raise exception 'VALIDATION_ERROR: 선택한 반에 속하지 않는 요일입니다' using errcode = '22023';
    end if;
  end if;

  if v_current.id is not null then
    update enrollment_cycles set status = 'completed' where id = v_current.id;
  end if;

  insert into enrollment_cycles(
    enrollment_id, plan, base_count, carry_over_count, total_count, used_count,
    next_due_date, payment_date
  ) values (
    p_enrollment_id, case when v_enrollment.kind = 'solo' then p_plan else null end,
    v_base, v_carry, v_base + v_carry, 0,
    case when v_enrollment.kind = 'group' then p_payment_date + 35 else null end,
    p_payment_date
  ) returning id, enrollment_cycles.total_count into v_cycle_id, v_total_count;

  if v_enrollment.kind = 'solo' then
    insert into sessions(cycle_id, session_index, status)
    select v_cycle_id, n, 'pending' from generate_series(1, v_total_count) n;
  else
    insert into cycle_schedules(cycle_id, schedule_id)
    select v_cycle_id, sid from unnest(v_schedule_ids) sid;
  end if;

  insert into payments(cycle_id, amount, method, payment_date, status)
  values (v_cycle_id, p_amount, p_method, p_payment_date, 'completed');
  update enrollments set status = 'active', ended_date = null, end_reason = null where id = p_enrollment_id;
  cycle_id := v_cycle_id;
  total_count := v_total_count;
  return next;
end;
$$;

create or replace function replace_cycle_schedules_atomic(p_cycle_id uuid, p_schedule_ids bigint[])
returns void language plpgsql as $$
declare v_class_id bigint;
begin
  if coalesce(array_length(p_schedule_ids, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: 요일을 하나 이상 선택해주세요' using errcode = '22023';
  end if;
  select e.class_id into v_class_id
  from enrollment_cycles ec join enrollments e on e.id = ec.enrollment_id
  where ec.id = p_cycle_id and ec.status = 'active' for update of ec;
  if v_class_id is null then raise exception 'NOT_FOUND: 활성 단체 주기를 찾을 수 없습니다' using errcode = 'P0002'; end if;
  if exists (
    select 1 from unnest(p_schedule_ids) sid
    left join class_schedules cs on cs.id = sid and cs.class_id = v_class_id
    where cs.id is null
  ) then raise exception 'VALIDATION_ERROR: 선택한 반에 속하지 않는 요일입니다' using errcode = '22023'; end if;
  delete from cycle_schedules where cycle_id = p_cycle_id;
  insert into cycle_schedules(cycle_id, schedule_id) select p_cycle_id, sid from unnest(p_schedule_ids) sid;
end;
$$;

create or replace function record_solo_session_atomic(
  p_cycle_id uuid, p_session_index integer, p_date date, p_expired boolean, p_note text
) returns integer language plpgsql as $$
declare
  v_cycle enrollment_cycles%rowtype;
  v_updated integer;
begin
  select * into v_cycle from enrollment_cycles where id = p_cycle_id and status = 'active' for update;
  if not found or v_cycle.plan is null then
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
      valid_end_date = coalesce(valid_end_date, p_date + case plan when 4 then 35 when 8 then 63 when 12 then 84 end)
  where id = p_cycle_id
  returning used_count into v_updated;
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
  select plan into v_plan from enrollment_cycles where id = p_cycle_id and status = 'active' for update;
  if v_plan is null then raise exception 'NOT_FOUND: 활성 개인레슨 주기를 찾을 수 없습니다' using errcode = 'P0002'; end if;
  update sessions set date = null, status = 'pending', note = null
  where cycle_id = p_cycle_id and session_index = p_session_index;
  select count(*), min(date) into v_used, v_first
  from sessions where cycle_id = p_cycle_id and status in ('done', 'auto');
  update enrollment_cycles
  set used_count = v_used,
      first_class_date = v_first,
      valid_end_date = case when v_first is null then null else v_first + case v_plan when 4 then 35 when 8 then 63 when 12 then 84 end end
  where id = p_cycle_id;
  return v_used;
end;
$$;

create or replace function save_attendance_atomic(p_date date, p_records jsonb)
returns integer language plpgsql as $$
declare
  v_record jsonb;
  v_cycle_id uuid;
  v_schedule_id bigint;
  v_attended boolean;
  v_exists boolean;
  v_processed integer := 0;
begin
  if p_date is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'VALIDATION_ERROR: 날짜와 출석 목록을 확인해주세요' using errcode = '22023';
  end if;
  for v_record in select value from jsonb_array_elements(p_records) loop
    v_cycle_id := (v_record->>'cycleId')::uuid;
    v_schedule_id := (v_record->>'scheduleId')::bigint;
    v_attended := (v_record->>'attended')::boolean;
    perform 1 from enrollment_cycles where id = v_cycle_id and status = 'active' for update;
    if not found or not exists (
      select 1 from cycle_schedules where cycle_id = v_cycle_id and schedule_id = v_schedule_id
    ) then raise exception 'VALIDATION_ERROR: 주기와 요일 정보가 일치하지 않습니다' using errcode = '22023'; end if;
    select exists(
      select 1 from attendance_logs
      where cycle_id = v_cycle_id and schedule_id = v_schedule_id and date = p_date
    ) into v_exists;
    if v_attended and not v_exists then
      insert into attendance_logs(cycle_id, schedule_id, date, attended)
      values (v_cycle_id, v_schedule_id, p_date, true);
      v_processed := v_processed + 1;
    elsif not v_attended and v_exists then
      delete from attendance_logs
      where cycle_id = v_cycle_id and schedule_id = v_schedule_id and date = p_date;
      v_processed := v_processed + 1;
    end if;
    update enrollment_cycles
    set used_count = (select count(*) from attendance_logs where cycle_id = v_cycle_id and attended = true)
    where id = v_cycle_id;
  end loop;
  return v_processed;
end;
$$;

create or replace function delete_attendance_atomic(p_attendance_id bigint)
returns void language plpgsql as $$
declare v_cycle_id uuid;
begin
  select cycle_id into v_cycle_id from attendance_logs where id = p_attendance_id for update;
  if not found then raise exception 'NOT_FOUND: 출석 기록을 찾을 수 없습니다' using errcode = 'P0002'; end if;
  delete from attendance_logs where id = p_attendance_id;
  update enrollment_cycles
  set used_count = (select count(*) from attendance_logs where cycle_id = v_cycle_id and attended = true)
  where id = v_cycle_id;
end;
$$;

revoke all on function create_enrollment_with_cycle_atomic(bigint,text,integer,text,bigint[],integer,text,date) from public, anon;
revoke all on function create_member_with_enrollment_atomic(text,text,text,integer,text,bigint[],integer,text,date) from public, anon;
revoke all on function renew_enrollment_atomic(uuid,integer,bigint[],integer,text,date) from public, anon;
revoke all on function replace_cycle_schedules_atomic(uuid,bigint[]) from public, anon;
revoke all on function record_solo_session_atomic(uuid,integer,date,boolean,text) from public, anon;
revoke all on function delete_solo_session_atomic(uuid,integer) from public, anon;
revoke all on function save_attendance_atomic(date,jsonb) from public, anon;
revoke all on function delete_attendance_atomic(bigint) from public, anon;
grant execute on function create_enrollment_with_cycle_atomic(bigint,text,integer,text,bigint[],integer,text,date) to authenticated, service_role;
grant execute on function create_member_with_enrollment_atomic(text,text,text,integer,text,bigint[],integer,text,date) to authenticated, service_role;
grant execute on function renew_enrollment_atomic(uuid,integer,bigint[],integer,text,date) to authenticated, service_role;
grant execute on function replace_cycle_schedules_atomic(uuid,bigint[]) to authenticated, service_role;
grant execute on function record_solo_session_atomic(uuid,integer,date,boolean,text) to authenticated, service_role;
grant execute on function delete_solo_session_atomic(uuid,integer) to authenticated, service_role;
grant execute on function save_attendance_atomic(date,jsonb) to authenticated, service_role;
grant execute on function delete_attendance_atomic(bigint) to authenticated, service_role;
