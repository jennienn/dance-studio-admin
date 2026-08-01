create extension if not exists btree_gist;

create table if not exists solo_bookings (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references enrollment_cycles(id) on delete cascade,
  member_id bigint not null references members(id) on delete cascade,
  booking_date date not null,
  start_minute integer not null check (start_minute between 600 and 1260 and start_minute % 30 = 0),
  status text not null default 'confirmed' check (status in ('confirmed', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table solo_bookings add constraint solo_bookings_no_overlap
  exclude using gist (booking_date with =, int4range(start_minute, start_minute + 60, '[)') with &&)
  where (status = 'confirmed');
create unique index if not exists idx_solo_booking_cycle_date on solo_bookings(cycle_id, booking_date) where status = 'confirmed';
create index if not exists idx_solo_bookings_date on solo_bookings(booking_date, start_minute);
alter table solo_bookings enable row level security;
create policy "authenticated_full_access" on solo_bookings for all to authenticated using (true) with check (true);
grant select, insert, update, delete on solo_bookings to authenticated, service_role;

create or replace function create_solo_booking_atomic(p_cycle_id uuid, p_date date, p_start_minute integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cycle enrollment_cycles%rowtype; v_member bigint; v_end date; v_id uuid; v_weekday integer;
begin
  select ec.* into v_cycle from enrollment_cycles ec join enrollments e on e.id=ec.enrollment_id
  where ec.id=p_cycle_id and ec.status='active' and e.status='active' and e.kind='solo' for update of ec;
  if not found then raise exception 'NOT_FOUND: 활성 개인레슨 수강권이 없습니다' using errcode='P0002'; end if;
  select e.member_id into v_member from enrollments e where e.id=v_cycle.enrollment_id;
  v_end := coalesce(v_cycle.valid_end_date, v_cycle.payment_date + case v_cycle.plan when 4 then 35 when 8 then 63 when 12 then 84 end);
  if p_date < greatest(current_date, v_cycle.payment_date) or p_date > v_end then raise exception 'BOOKING_DATE_INVALID' using errcode='22023'; end if;
  if p_start_minute < 600 or p_start_minute > 1260 or p_start_minute % 30 <> 0 then raise exception 'BOOKING_TIME_INVALID' using errcode='22023'; end if;
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

create or replace function complete_solo_booking_atomic(p_booking_id uuid, p_session_index integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_booking solo_bookings%rowtype;
  v_used_count integer;
begin
  select * into v_booking from solo_bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'confirmed' then
    raise exception 'NOT_FOUND: 확인 가능한 예약이 없습니다' using errcode = 'P0002';
  end if;

  select record_solo_session_atomic(
    v_booking.cycle_id,
    p_session_index,
    v_booking.booking_date,
    false,
    '수강생 직접 예약'
  ) into v_used_count;

  update solo_bookings set status = 'completed', updated_at = now() where id = p_booking_id;
  return v_used_count;
end; $$;

revoke all on function complete_solo_booking_atomic(uuid,integer) from public, anon;
grant execute on function complete_solo_booking_atomic(uuid,integer) to authenticated, service_role;
