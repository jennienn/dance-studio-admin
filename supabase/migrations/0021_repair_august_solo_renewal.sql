-- 2026-08-30 개인 8회 재등록 1건이 0018의 누적 로직으로 16회·18주가 된 데이터를
-- 기존 완료 cycle과 신규 8회 cycle로 분리한다. 대상 상태가 달라졌으면 아무것도 변경하지 않고 중단한다.
do $$
declare
  v_old_cycle_id constant uuid := 'd60bbd43-aaa4-48a2-94b8-7e28ac5cdec2';
  v_enrollment_id constant uuid := '6aaf4f1d-574a-4fb9-b418-d2796af73bee';
  v_new_cycle_id uuid;
  v_matches integer;
begin
  select count(*) into v_matches
  from enrollment_cycles
  where id = v_old_cycle_id
    and enrollment_id = v_enrollment_id
    and status = 'active'
    and plan = 8
    and base_count = 16
    and carry_over_count = 0
    and total_count = 16
    and used_count = 8
    and first_class_date = date '2026-07-22'
    and valid_end_date = date '2026-11-24'
    and valid_weeks = 18
    and payment_date = date '2026-08-30';

  if v_matches = 0 then
    return;
  end if;

  if (select count(*) from sessions where cycle_id = v_old_cycle_id and session_index between 1 and 8 and status = 'done') <> 8
    or exists (select 1 from sessions where cycle_id = v_old_cycle_id and session_index between 9 and 16 and status <> 'pending')
    or (select count(*) from sessions where cycle_id = v_old_cycle_id) <> 16
    or (select count(*) from payments where cycle_id = v_old_cycle_id and purchased_count = 8 and status = 'completed') <> 2
    or (select count(*) from payments where cycle_id = v_old_cycle_id and payment_date = date '2026-08-30') <> 1
    or exists (select 1 from solo_bookings where cycle_id = v_old_cycle_id and booking_date > date '2026-08-30') then
    raise exception 'REPAIR_ABORTED: 대상 cycle의 회차·결제·예약 상태가 확인 시점과 다릅니다';
  end if;

  update enrollment_cycles
  set base_count = 8,
      total_count = 8,
      used_count = 8,
      valid_weeks = 9,
      valid_end_date = fixed_term_valid_end(date '2026-07-22', 9),
      payment_date = date '2026-07-22',
      status = 'completed',
      notify_status = 'sent',
      notify_date = (
        select max(sent_at) from notifications
        where cycle_id = v_old_cycle_id and trigger_type = 'auto' and status = 'sent'
      )
  where id = v_old_cycle_id;

  insert into enrollment_cycles(
    enrollment_id, plan, base_count, carry_over_count, total_count, used_count,
    first_class_date, valid_end_date, payment_date, valid_weeks, status,
    notify_status, notify_date
  ) values (
    v_enrollment_id, 8, 8, 0, 8, 0,
    null, null, date '2026-08-30', 9, 'active',
    'sent', (
      select max(sent_at) from notifications
      where cycle_id = v_old_cycle_id and trigger_type = 'manual_renew' and status = 'sent'
    )
  ) returning id into v_new_cycle_id;

  update sessions
  set cycle_id = v_new_cycle_id,
      session_index = session_index - 8
  where cycle_id = v_old_cycle_id and session_index between 9 and 16;

  update payments
  set cycle_id = v_new_cycle_id
  where cycle_id = v_old_cycle_id and payment_date = date '2026-08-30';

  update notifications
  set cycle_id = v_new_cycle_id
  where cycle_id = v_old_cycle_id and trigger_type = 'manual_renew';
end;
$$;
