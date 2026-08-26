-- renew_enrollment_atomic의 OUT 파라미터 total_count와 동일한 컬럼명을
-- UPDATE 표현식에서 명시적으로 수식해 PL/pgSQL 모호성 오류를 방지한다.
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

  update enrollment_cycles as ec
  set base_count = ec.base_count + p_plan,
      total_count = ec.total_count + p_plan,
      valid_weeks = coalesce(ec.valid_weeks, case ec.plan when 4 then 5 when 8 then 9 when 12 then 13 end) + v_added_weeks,
      valid_end_date = case when ec.valid_end_date is null then null else ec.valid_end_date + (v_added_weeks * 7) end,
      payment_date = p_payment_date,
      notify_status = 'not_required',
      notify_date = null
  where ec.id = v_current.id
  returning ec.id, ec.total_count into cycle_id, total_count;

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

revoke all on function renew_enrollment_atomic(uuid,integer,bigint[],integer,text,date) from public, anon;
grant execute on function renew_enrollment_atomic(uuid,integer,bigint[],integer,text,date) to authenticated, service_role;
