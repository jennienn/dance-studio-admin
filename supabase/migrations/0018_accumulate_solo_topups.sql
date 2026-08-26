-- 개인레슨 추가 결제는 새 cycle로 초기화하지 않고 현재 cycle에 횟수와 유효기간을 누적한다.
alter table enrollment_cycles add column if not exists valid_weeks integer;

update enrollment_cycles
set valid_weeks = case plan when 4 then 5 when 8 then 9 when 12 then 13 end
where plan is not null and valid_weeks is null;

update enrollment_cycles ec
set valid_weeks = p.valid_weeks
from enrollments e
join enrollment_packages p on p.id = e.package_id
where e.id = ec.enrollment_id and ec.valid_weeks is null;

alter table enrollment_cycles add constraint enrollment_cycles_valid_weeks_positive
  check (valid_weeks is null or valid_weeks > 0);

create or replace function set_cycle_valid_weeks()
returns trigger language plpgsql as $$
declare v_package_weeks integer;
begin
  if new.valid_weeks is not null then return new; end if;
  if new.plan in (4, 8, 12) then
    new.valid_weeks := case new.plan when 4 then 5 when 8 then 9 when 12 then 13 end;
    return new;
  end if;
  select p.valid_weeks into v_package_weeks
  from enrollments e join enrollment_packages p on p.id = e.package_id
  where e.id = new.enrollment_id;
  new.valid_weeks := v_package_weeks;
  return new;
end;
$$;

drop trigger if exists trg_set_cycle_valid_weeks on enrollment_cycles;
create trigger trg_set_cycle_valid_weeks before insert on enrollment_cycles
for each row execute function set_cycle_valid_weeks();

-- 같은 cycle에 추가 결제 이력을 여러 건 보존한다.
alter table payments drop constraint if exists payments_cycle_id_key;
create index if not exists idx_payments_cycle on payments(cycle_id);
alter table payments add column if not exists purchased_count integer
  check (purchased_count is null or purchased_count > 0);

update payments p
set purchased_count = ec.base_count
from enrollment_cycles ec
join enrollments e on e.id = ec.enrollment_id
where ec.id = p.cycle_id and e.kind = 'solo' and p.purchased_count is null;

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
  v_result record;
  v_added_weeks integer;
  v_previous_total integer;
begin
  if p_amount < 0 or p_payment_date is null or p_method not in ('card', 'transfer', 'cash') then
    raise exception 'VALIDATION_ERROR: 결제 정보를 확인해주세요' using errcode = '22023';
  end if;

  select * into v_enrollment from enrollments where id = p_enrollment_id for update;
  if not found then
    raise exception 'NOT_FOUND: 수강권을 찾을 수 없습니다' using errcode = 'P0002';
  end if;

  if v_enrollment.kind = 'group' then
    select * into v_result from renew_enrollment_amount_legacy(
      p_enrollment_id, p_plan, p_schedule_ids, greatest(p_amount, 1), p_method, p_payment_date
    );
    update payments set amount = p_amount where payments.cycle_id = v_result.cycle_id;
    cycle_id := v_result.cycle_id;
    total_count := v_result.total_count;
    return next;
    return;
  end if;

  if p_plan not in (4, 8, 12) then
    raise exception 'VALIDATION_ERROR: 개인레슨 회차를 확인해주세요' using errcode = '22023';
  end if;

  select * into v_current from enrollment_cycles
  where enrollment_id = p_enrollment_id and status = 'active' for update;
  if not found then
    raise exception 'NOT_FOUND: 활성 개인레슨 주기를 찾을 수 없습니다' using errcode = 'P0002';
  end if;

  v_added_weeks := case p_plan when 4 then 5 when 8 then 9 when 12 then 13 end;
  v_previous_total := v_current.total_count;

  update enrollment_cycles
  set base_count = base_count + p_plan,
      total_count = total_count + p_plan,
      valid_weeks = coalesce(valid_weeks, case plan when 4 then 5 when 8 then 9 when 12 then 13 end) + v_added_weeks,
      valid_end_date = case when valid_end_date is null then null else valid_end_date + (v_added_weeks * 7) end,
      payment_date = p_payment_date,
      notify_status = 'not_required',
      notify_date = null
  where id = v_current.id
  returning id, enrollment_cycles.total_count into cycle_id, total_count;

  insert into sessions(cycle_id, session_index, status)
  select v_current.id, n, 'pending'
  from generate_series(v_previous_total + 1, v_previous_total + p_plan) n;

  insert into payments(cycle_id, amount, method, payment_date, status, purchased_count)
  values (v_current.id, p_amount, p_method, p_payment_date, 'completed', p_plan);

  update enrollments set status = 'active', ended_date = null, end_reason = null
  where id = p_enrollment_id;
  return next;
end;
$$;

create or replace function record_solo_session_atomic(
  p_cycle_id uuid, p_session_index integer, p_date date, p_expired boolean, p_note text
) returns integer language plpgsql as $$
declare v_updated integer;
begin
  perform 1 from enrollment_cycles ec join enrollments e on e.id = ec.enrollment_id
  where ec.id = p_cycle_id and ec.status = 'active' and e.kind = 'solo' for update of ec;
  if not found then raise exception 'NOT_FOUND: 활성 개인레슨 주기를 찾을 수 없습니다' using errcode = 'P0002'; end if;
  if (select count(*) from sessions where cycle_id = p_cycle_id and date = p_date and status in ('done', 'auto')) >= 2 then
    raise exception 'SAME_DAY_SESSION_LIMIT' using errcode = '22023';
  end if;
  update sessions set date = p_date, status = case when p_expired then 'auto' else 'done' end, note = p_note
  where cycle_id = p_cycle_id and session_index = p_session_index and status = 'pending';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'VALIDATION_ERROR: 이미 기록되었거나 존재하지 않는 회차입니다' using errcode = '22023'; end if;
  update enrollment_cycles
  set used_count = (select count(*) from sessions where cycle_id = p_cycle_id and status in ('done', 'auto')),
      first_class_date = coalesce(first_class_date, p_date),
      valid_end_date = coalesce(valid_end_date, fixed_term_valid_end(p_date, valid_weeks))
  where id = p_cycle_id returning used_count into v_updated;
  perform sync_package_validity_for_cycle(p_cycle_id);
  return v_updated;
end;
$$;

create or replace function delete_solo_session_atomic(p_cycle_id uuid, p_session_index integer)
returns integer language plpgsql as $$
declare v_first date; v_used integer; v_valid_weeks integer;
begin
  select ec.valid_weeks into v_valid_weeks from enrollment_cycles ec join enrollments e on e.id = ec.enrollment_id
  where ec.id = p_cycle_id and ec.status = 'active' and e.kind = 'solo' for update of ec;
  if not found then raise exception 'NOT_FOUND: 활성 개인레슨 주기를 찾을 수 없습니다' using errcode = 'P0002'; end if;
  update sessions set date = null, status = 'pending', note = null where cycle_id = p_cycle_id and session_index = p_session_index;
  select count(*), min(date) into v_used, v_first from sessions where cycle_id = p_cycle_id and status in ('done', 'auto');
  update enrollment_cycles set used_count = v_used, first_class_date = v_first,
    valid_end_date = case when v_first is null then null else fixed_term_valid_end(v_first, v_valid_weeks) end
  where id = p_cycle_id;
  perform sync_package_validity_for_cycle(p_cycle_id);
  return v_used;
end;
$$;

create or replace function create_solo_booking_atomic(p_cycle_id uuid, p_date date, p_start_minute integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cycle enrollment_cycles%rowtype; v_member bigint; v_end date; v_id uuid; v_weekday integer;
  v_korea_now timestamp := now() at time zone 'Asia/Seoul'; v_minimum_start integer;
begin
  select ec.* into v_cycle from enrollment_cycles ec join enrollments e on e.id=ec.enrollment_id
  where ec.id=p_cycle_id and ec.status='active' and e.status='active' and e.kind='solo' for update of ec;
  if not found then raise exception 'NOT_FOUND: 활성 개인레슨 수강권이 없습니다' using errcode='P0002'; end if;
  select e.member_id into v_member from enrollments e where e.id=v_cycle.enrollment_id;
  v_end := coalesce(v_cycle.valid_end_date, fixed_term_valid_end(v_cycle.payment_date, v_cycle.valid_weeks));
  if p_date < greatest(v_korea_now::date, v_cycle.payment_date) or p_date > v_end then
    raise exception 'BOOKING_DATE_INVALID' using errcode='22023';
  end if;
  if p_start_minute < 600 or p_start_minute > 1320 or p_start_minute % 30 <> 0 then
    raise exception 'BOOKING_TIME_INVALID' using errcode='22023';
  end if;
  if p_date = v_korea_now::date then
    v_minimum_start := extract(hour from v_korea_now)::integer * 60 + extract(minute from v_korea_now)::integer + 120;
    if p_start_minute < v_minimum_start then raise exception 'BOOKING_ADVANCE_NOTICE_REQUIRED' using errcode='22023'; end if;
  end if;
  v_weekday := extract(dow from p_date);
  if (v_weekday between 1 and 4 and int4range(p_start_minute,p_start_minute+60,'[)') && int4range(1200,1260,'[)'))
    or (v_weekday in (2,4) and int4range(p_start_minute,p_start_minute+60,'[)') && int4range(660,720,'[)')) then
    raise exception 'GROUP_CLASS_OVERLAP' using errcode='22023';
  end if;
  if (select count(*) from solo_bookings where cycle_id=p_cycle_id and booking_date=p_date and status in ('confirmed','completed')) >= 2 then
    raise exception 'SAME_DAY_BOOKING_LIMIT' using errcode='22023';
  end if;
  if (select count(*) from solo_bookings where cycle_id=p_cycle_id and status='confirmed') >= v_cycle.total_count-v_cycle.used_count then
    raise exception 'NO_REMAINING_BOOKINGS' using errcode='22023';
  end if;
  insert into solo_bookings(cycle_id,member_id,booking_date,start_minute)
  values(p_cycle_id,v_member,p_date,p_start_minute) returning id into v_id;
  return v_id;
exception when exclusion_violation then raise exception 'BOOKING_CONFLICT' using errcode='23P01';
end; $$;

create or replace function cancel_solo_booking_atomic(p_booking_id uuid, p_member_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_booking solo_bookings%rowtype; v_session_index integer; v_is_late boolean;
begin
  select * into v_booking from solo_bookings where id = p_booking_id and member_id = p_member_id for update;
  if not found or v_booking.status <> 'confirmed' then
    raise exception 'NOT_FOUND: 취소 가능한 예약이 없습니다' using errcode = 'P0002';
  end if;
  v_is_late := timezone('Asia/Seoul', now()) >= ((v_booking.booking_date - 1)::timestamp + time '20:00');
  if v_is_late then
    select min(session_index) into v_session_index from sessions
    where cycle_id = v_booking.cycle_id and status = 'pending';
    if v_session_index is not null then
      update sessions set date = v_booking.booking_date, status = 'done', note = '예약 취소 가능 시간 이후 취소 (횟수 차감)'
      where cycle_id = v_booking.cycle_id and session_index = v_session_index and status = 'pending';
      update enrollment_cycles
      set used_count = (select count(*) from sessions where cycle_id = v_booking.cycle_id and status in ('done', 'auto')),
          first_class_date = coalesce(first_class_date, v_booking.booking_date),
          valid_end_date = coalesce(valid_end_date, fixed_term_valid_end(v_booking.booking_date, valid_weeks))
      where id = v_booking.cycle_id;
      perform sync_package_validity_for_cycle(v_booking.cycle_id);
    end if;
  end if;
  update solo_bookings set status = 'cancelled', cancellation_charged = v_is_late, updated_at = now()
  where id = p_booking_id;
  return v_is_late;
end;
$$;

revoke all on function renew_enrollment_atomic(uuid,integer,bigint[],integer,text,date) from public, anon;
grant execute on function renew_enrollment_atomic(uuid,integer,bigint[],integer,text,date) to authenticated, service_role;
revoke all on function create_solo_booking_atomic(uuid,date,integer) from public, anon;
grant execute on function create_solo_booking_atomic(uuid,date,integer) to service_role;
revoke all on function cancel_solo_booking_atomic(uuid,bigint) from public, anon, authenticated;
grant execute on function cancel_solo_booking_atomic(uuid,bigint) to service_role;
