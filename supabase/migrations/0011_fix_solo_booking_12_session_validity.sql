-- 개인레슨 12회권의 직접 예약 가능 기간을 실제 수강 유효기간과 같은 13주로 맞춘다.
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
  v_end := coalesce(v_cycle.valid_end_date, v_cycle.payment_date + case v_cycle.plan when 4 then 35 when 8 then 63 when 12 then 91 end);

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
