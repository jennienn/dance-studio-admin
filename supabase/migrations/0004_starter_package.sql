-- 0004_starter_package.sql
-- 스타터 패키지(개인레슨 2회 + 단체레슨 4회, 첫 수업일로부터 3주 공통 유효기간) 신규 도입.
-- 이 마이그레이션은 개인레슨 12회권 유효기간 버그(12주 -> 13주)도 함께 고친다 —
-- 같은 함수(record_solo_session_atomic/delete_solo_session_atomic)를 어차피 재정의하기 때문.

-- ========== enrollment_packages (패키지 구매 1건 = 개인/단체 enrollment 2개를 묶는 결제 원장) ==========
create table if not exists enrollment_packages (
  id uuid primary key default gen_random_uuid(),
  member_id bigint not null references members(id) on delete cascade,
  package_type text not null default 'starter' check (package_type in ('starter')),
  valid_weeks integer not null default 3,
  amount integer not null,
  method text not null check (method in ('card', 'transfer', 'cash')),
  payment_date date not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now()
);
create index if not exists idx_packages_member on enrollment_packages (member_id);

-- payments 테이블은 cycle_id가 1:1 UNIQUE라서 결제 1건을 두 cycle에 나눠 걸 수 없다.
-- 패키지 결제 원장은 enrollment_packages 행 자체가 맡고, payments 테이블에는 별도 행을 만들지 않는다.
alter table enrollments add column if not exists package_id uuid references enrollment_packages(id) on delete set null;
create index if not exists idx_enrollments_package on enrollments (package_id) where package_id is not null;

alter table enrollment_packages enable row level security;
drop policy if exists "authenticated_full_access" on enrollment_packages;
create policy "authenticated_full_access" on enrollment_packages for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select, insert, update, delete on enrollment_packages to authenticated, service_role;

-- ========== sync_package_validity_for_cycle ==========
-- 패키지 소속 cycle이 아니면 즉시 no-op. 패키지 소속이면 개인/단체 cycle 중
-- 먼저 기록된 출석 날짜(sessions.done/auto ∪ attendance_logs.attended)를 찾아
-- 두 cycle의 first_class_date/valid_end_date를 동일하게 맞춘다. 기록/취소 어느 쪽이든
-- 호출 후 항상 올바른 상태로 수렴하도록 매번 처음부터 다시 계산한다(멱등).
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

  if v_package_id is null then
    return;
  end if;

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
      valid_end_date = case when v_min_date is null then null else v_min_date + (v_valid_weeks * 7) end
  where id in (v_solo_cycle_id, v_group_cycle_id);
end;
$$;

-- ========== create_starter_package_atomic ==========
-- 개인 2회 + 단체(반 1개 선택) 4회를 한 결제로 원자적으로 생성한다.
-- 반/요일 검증 로직은 create_enrollment_with_cycle_atomic의 group 분기를 그대로 따른다.
create or replace function create_starter_package_atomic(
  p_member_id bigint,
  p_class_name text,
  p_schedule_ids bigint[],
  p_amount integer,
  p_method text,
  p_payment_date date
) returns table(package_id uuid, solo_enrollment_id uuid, solo_cycle_id uuid, group_enrollment_id uuid, group_cycle_id uuid)
language plpgsql
as $$
declare
  v_class_id bigint;
  v_package_id uuid;
  v_solo_enrollment_id uuid;
  v_solo_cycle_id uuid;
  v_group_enrollment_id uuid;
  v_group_cycle_id uuid;
begin
  if p_amount <= 0 or p_payment_date is null or p_method not in ('card', 'transfer', 'cash') then
    raise exception 'VALIDATION_ERROR: 결제 정보를 확인해주세요' using errcode = '22023';
  end if;

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

  insert into enrollment_packages(member_id, package_type, valid_weeks, amount, method, payment_date)
  values (p_member_id, 'starter', 3, p_amount, p_method, p_payment_date)
  returning id into v_package_id;

  insert into enrollments(member_id, kind, class_id, package_id)
  values (p_member_id, 'solo', null, v_package_id)
  returning id into v_solo_enrollment_id;

  insert into enrollment_cycles(
    enrollment_id, plan, base_count, carry_over_count, total_count, used_count, payment_date
  ) values (
    v_solo_enrollment_id, null, 2, 0, 2, 0, p_payment_date
  ) returning id into v_solo_cycle_id;

  insert into sessions(cycle_id, session_index, status)
  select v_solo_cycle_id, n, 'pending' from generate_series(1, 2) n;

  insert into enrollments(member_id, kind, class_id, package_id)
  values (p_member_id, 'group', v_class_id, v_package_id)
  returning id into v_group_enrollment_id;

  insert into enrollment_cycles(
    enrollment_id, plan, base_count, carry_over_count, total_count, used_count, payment_date
  ) values (
    v_group_enrollment_id, null, 4, 0, 4, 0, p_payment_date
  ) returning id into v_group_cycle_id;

  insert into cycle_schedules(cycle_id, schedule_id)
  select v_group_cycle_id, sid from unnest(p_schedule_ids) sid;

  package_id := v_package_id;
  solo_enrollment_id := v_solo_enrollment_id;
  solo_cycle_id := v_solo_cycle_id;
  group_enrollment_id := v_group_enrollment_id;
  group_cycle_id := v_group_cycle_id;
  return next;
end;
$$;

-- ========== record_solo_session_atomic 재정의 ==========
-- 1) 12회권 유효기간을 84일(12주) -> 91일(13주)로 수정.
-- 2) "plan is null이면 개인레슨 cycle이 아니다"라는 기존 가드가 스타터 패키지(plan=null인 정상 solo cycle)를
--    잘못 튕겨내던 문제를 수정 — enrollments.kind='solo'로 직접 조회한다.
-- 3) 끝에서 sync_package_validity_for_cycle 호출 — 패키지 소속이면 공통 유효기간을 동기화한다.
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
      valid_end_date = coalesce(valid_end_date, p_date + case plan when 4 then 35 when 8 then 63 when 12 then 91 end)
  where id = p_cycle_id
  returning used_count into v_updated;
  perform sync_package_validity_for_cycle(p_cycle_id);
  return v_updated;
end;
$$;

-- ========== delete_solo_session_atomic 재정의 ==========
-- record_solo_session_atomic과 동일한 이유로 가드/day-case/sync 호출을 함께 수정.
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
      valid_end_date = case when v_first is null then null else v_first + case v_plan when 4 then 35 when 8 then 63 when 12 then 91 end end
  where id = p_cycle_id;
  perform sync_package_validity_for_cycle(p_cycle_id);
  return v_used;
end;
$$;

-- ========== save_attendance_atomic 재정의 ==========
-- 각 record 처리 후 sync_package_validity_for_cycle 호출을 추가한 것 외 기존 로직과 동일.
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
    perform sync_package_validity_for_cycle(v_cycle_id);
  end loop;
  return v_processed;
end;
$$;

-- ========== delete_attendance_atomic 재정의 ==========
-- sync_package_validity_for_cycle 호출을 추가한 것 외 기존 로직과 동일.
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
  perform sync_package_validity_for_cycle(v_cycle_id);
end;
$$;

revoke all on function create_starter_package_atomic(bigint,text,bigint[],integer,text,date) from public, anon;
revoke all on function sync_package_validity_for_cycle(uuid) from public, anon;
grant execute on function create_starter_package_atomic(bigint,text,bigint[],integer,text,date) to authenticated, service_role;
grant execute on function sync_package_validity_for_cycle(uuid) to authenticated, service_role;
