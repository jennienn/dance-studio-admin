-- 개인레슨 재등록은 기존 cycle에 누적하지 않고 새 cycle을 생성한다.
-- 기존 cycle은 완료 처리하여 수업·결제 이력을 보존하고, 남은 횟수만 새 cycle로 이월한다.
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
  v_carry integer := 0;
  v_cycle_id uuid;
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

  v_carry := greatest(0, v_current.total_count - v_current.used_count);
  update enrollment_cycles set status = 'completed' where id = v_current.id;

  insert into enrollment_cycles(
    enrollment_id, plan, base_count, carry_over_count, total_count, used_count,
    payment_date, valid_weeks
  ) values (
    p_enrollment_id, p_plan, p_plan, v_carry, p_plan + v_carry, 0,
    p_payment_date, case p_plan when 4 then 5 when 8 then 9 when 12 then 13 end
  ) returning id into v_cycle_id;

  insert into sessions(cycle_id, session_index, status)
  select v_cycle_id, n, 'pending'
  from generate_series(1, p_plan + v_carry) n;

  insert into payments(cycle_id, amount, method, payment_date, status, purchased_count)
  values(v_cycle_id, p_amount, p_method, p_payment_date, 'completed', p_plan);

  update enrollments set status = 'active', ended_date = null, end_reason = null
  where id = p_enrollment_id;

  cycle_id := v_cycle_id;
  total_count := p_plan + v_carry;
  return next;
end;
$$;

revoke all on function renew_enrollment_atomic(uuid,integer,bigint[],integer,text,date) from public, anon;
grant execute on function renew_enrollment_atomic(uuid,integer,bigint[],integer,text,date) to authenticated, service_role;
