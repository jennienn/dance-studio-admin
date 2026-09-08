create table if not exists solo_booking_blocks (
  id uuid primary key default gen_random_uuid(),
  block_date date not null,
  start_minute integer not null check (start_minute between 600 and 1350 and start_minute % 30 = 0),
  end_minute integer not null check (end_minute between 630 and 1380 and end_minute % 30 = 0),
  reason text,
  created_at timestamptz not null default now(),
  constraint solo_booking_blocks_valid_range check (start_minute < end_minute)
);

alter table solo_booking_blocks add constraint solo_booking_blocks_no_overlap
  exclude using gist (block_date with =, int4range(start_minute, end_minute, '[)') with &&);
create index if not exists idx_solo_booking_blocks_date on solo_booking_blocks(block_date, start_minute);

alter table solo_booking_blocks enable row level security;
create policy "authenticated_full_access" on solo_booking_blocks
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on solo_booking_blocks to authenticated, service_role;

create or replace function create_solo_booking_block_atomic(
  p_date date, p_start_minute integer, p_end_minute integer, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_korea_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_date is null or p_date < v_korea_today
    or p_start_minute < 600 or p_end_minute > 1380
    or p_start_minute % 30 <> 0 or p_end_minute % 30 <> 0
    or p_start_minute >= p_end_minute then
    raise exception 'BLOCK_VALIDATION_ERROR' using errcode = '22023';
  end if;

  -- 같은 날짜의 예약 생성과 차단 생성을 직렬화해 동시 요청 경합을 막는다.
  perform pg_advisory_xact_lock(hashtext('solo_booking:' || p_date::text));

  if exists (
    select 1 from solo_bookings
    where booking_date = p_date and status = 'confirmed'
      and int4range(start_minute, start_minute + 60, '[)')
        && int4range(p_start_minute, p_end_minute, '[)')
  ) then
    raise exception 'BLOCK_BOOKING_CONFLICT' using errcode = '22023';
  end if;

  insert into solo_booking_blocks(block_date, start_minute, end_minute, reason)
  values(p_date, p_start_minute, p_end_minute, nullif(trim(p_reason), ''))
  returning id into v_id;
  return v_id;
exception when exclusion_violation then
  raise exception 'BLOCK_OVERLAP' using errcode = '23P01';
end;
$$;

revoke all on function create_solo_booking_block_atomic(date,integer,integer,text) from public, anon;
grant execute on function create_solo_booking_block_atomic(date,integer,integer,text) to authenticated, service_role;

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
  -- 같은 날짜의 차단 생성과 예약 생성을 직렬화해 검사 직후 삽입되는 경합을 막는다.
  perform pg_advisory_xact_lock(hashtext('solo_booking:' || p_date::text));
  if p_date = v_korea_now::date then
    v_minimum_start := extract(hour from v_korea_now)::integer * 60 + extract(minute from v_korea_now)::integer + 120;
    if p_start_minute < v_minimum_start then raise exception 'BOOKING_ADVANCE_NOTICE_REQUIRED' using errcode='22023'; end if;
  end if;
  if exists (
    select 1 from solo_booking_blocks
    where block_date = p_date
      and int4range(start_minute, end_minute, '[)') && int4range(p_start_minute, p_start_minute + 60, '[)')
  ) then
    raise exception 'BOOKING_BLOCKED' using errcode='22023';
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
end;
$$;

revoke all on function create_solo_booking_atomic(uuid,date,integer) from public, anon;
grant execute on function create_solo_booking_atomic(uuid,date,integer) to service_role;
