alter function create_enrollment_with_cycle_atomic(bigint,text,integer,text,bigint[],integer,text,date)
  rename to create_enrollment_with_cycle_amount_legacy;

create function create_enrollment_with_cycle_atomic(
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
declare v_result record;
begin
  if p_amount < 0 then
    raise exception 'VALIDATION_ERROR: 결제 금액을 확인해주세요' using errcode = '22023';
  end if;
  select * into v_result from create_enrollment_with_cycle_amount_legacy(
    p_member_id, p_kind, p_plan, p_class_name, p_schedule_ids,
    greatest(p_amount, 1), p_method, p_payment_date
  );
  update payments set amount = p_amount where payments.cycle_id = v_result.cycle_id;
  enrollment_id := v_result.enrollment_id;
  cycle_id := v_result.cycle_id;
  return next;
end;
$$;

alter function renew_enrollment_atomic(uuid,integer,bigint[],integer,text,date)
  rename to renew_enrollment_amount_legacy;

create function renew_enrollment_atomic(
  p_enrollment_id uuid,
  p_plan integer,
  p_schedule_ids bigint[],
  p_amount integer,
  p_method text,
  p_payment_date date
) returns table(cycle_id uuid, total_count integer)
language plpgsql
as $$
declare v_result record;
begin
  if p_amount < 0 then
    raise exception 'VALIDATION_ERROR: 결제 금액을 확인해주세요' using errcode = '22023';
  end if;
  select * into v_result from renew_enrollment_amount_legacy(
    p_enrollment_id, p_plan, p_schedule_ids, greatest(p_amount, 1), p_method, p_payment_date
  );
  update payments set amount = p_amount where payments.cycle_id = v_result.cycle_id;
  cycle_id := v_result.cycle_id;
  total_count := v_result.total_count;
  return next;
end;
$$;

alter function create_starter_package_atomic(bigint,text,bigint[],integer,text,date)
  rename to create_starter_package_amount_legacy;

create function create_starter_package_atomic(
  p_member_id bigint,
  p_class_name text,
  p_schedule_ids bigint[],
  p_amount integer,
  p_method text,
  p_payment_date date
) returns table(package_id uuid, solo_enrollment_id uuid, solo_cycle_id uuid, group_enrollment_id uuid, group_cycle_id uuid)
language plpgsql
as $$
declare v_result record;
begin
  if p_amount < 0 then
    raise exception 'VALIDATION_ERROR: 결제 금액을 확인해주세요' using errcode = '22023';
  end if;
  select * into v_result from create_starter_package_amount_legacy(
    p_member_id, p_class_name, p_schedule_ids, greatest(p_amount, 1), p_method, p_payment_date
  );
  update enrollment_packages set amount = p_amount where id = v_result.package_id;
  package_id := v_result.package_id;
  solo_enrollment_id := v_result.solo_enrollment_id;
  solo_cycle_id := v_result.solo_cycle_id;
  group_enrollment_id := v_result.group_enrollment_id;
  group_cycle_id := v_result.group_cycle_id;
  return next;
end;
$$;

revoke all on function create_enrollment_with_cycle_atomic(bigint,text,integer,text,bigint[],integer,text,date) from public, anon;
revoke all on function renew_enrollment_atomic(uuid,integer,bigint[],integer,text,date) from public, anon;
revoke all on function create_starter_package_atomic(bigint,text,bigint[],integer,text,date) from public, anon;
grant execute on function create_enrollment_with_cycle_atomic(bigint,text,integer,text,bigint[],integer,text,date) to authenticated, service_role;
grant execute on function renew_enrollment_atomic(uuid,integer,bigint[],integer,text,date) to authenticated, service_role;
grant execute on function create_starter_package_atomic(bigint,text,bigint[],integer,text,date) to authenticated, service_role;
