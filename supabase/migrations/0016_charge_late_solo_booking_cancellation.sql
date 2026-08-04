alter table solo_bookings
  add column if not exists cancellation_charged boolean not null default false;

create or replace function cancel_solo_booking_atomic(p_booking_id uuid, p_member_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_booking solo_bookings%rowtype;
  v_session_index integer;
  v_is_late boolean;
begin
  select * into v_booking
  from solo_bookings
  where id = p_booking_id and member_id = p_member_id
  for update;

  if not found or v_booking.status <> 'confirmed' then
    raise exception 'NOT_FOUND: 취소 가능한 예약이 없습니다' using errcode = 'P0002';
  end if;

  v_is_late := timezone('Asia/Seoul', now()) >= ((v_booking.booking_date - 1)::timestamp + time '20:00');

  if v_is_late then
    select min(session_index) into v_session_index
    from sessions
    where cycle_id = v_booking.cycle_id and status = 'pending';

    if v_session_index is not null then
      update sessions
      set date = v_booking.booking_date,
          status = 'done',
          note = '예약 취소 가능 시간 이후 취소 (횟수 차감)'
      where cycle_id = v_booking.cycle_id and session_index = v_session_index and status = 'pending';

      update enrollment_cycles
      set used_count = (
            select count(*) from sessions
            where cycle_id = v_booking.cycle_id and status in ('done', 'auto')
          ),
          first_class_date = coalesce(first_class_date, v_booking.booking_date),
          valid_end_date = coalesce(
            valid_end_date,
            fixed_term_valid_end(v_booking.booking_date, case plan when 4 then 5 when 8 then 9 when 12 then 13 end)
          )
      where id = v_booking.cycle_id;

      perform sync_package_validity_for_cycle(v_booking.cycle_id);
    end if;
  end if;

  update solo_bookings
  set status = 'cancelled', cancellation_charged = v_is_late, updated_at = now()
  where id = p_booking_id;

  return v_is_late;
end;
$$;

revoke all on function cancel_solo_booking_atomic(uuid,bigint) from public, anon, authenticated;
grant execute on function cancel_solo_booking_atomic(uuid,bigint) to service_role;
