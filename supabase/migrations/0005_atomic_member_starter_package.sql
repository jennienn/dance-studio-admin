-- 신규 회원 등록 화면에서 회원과 스타터 패키지를 한 트랜잭션으로 생성한다.
-- 패키지/정원 검증이 실패하면 먼저 만든 member 행도 함께 롤백된다.
create or replace function create_member_with_starter_package_atomic(
  p_name text,
  p_phone text,
  p_class_name text,
  p_schedule_ids bigint[],
  p_amount integer,
  p_method text,
  p_payment_date date
) returns table(
  member_id bigint,
  package_id uuid,
  solo_enrollment_id uuid,
  solo_cycle_id uuid,
  group_enrollment_id uuid,
  group_cycle_id uuid
)
language plpgsql
as $$
declare
  v_member_id bigint;
  v_package record;
begin
  if nullif(trim(p_name), '') is null or nullif(trim(p_phone), '') is null then
    raise exception 'VALIDATION_ERROR: 이름과 연락처를 입력해주세요' using errcode = '22023';
  end if;

  insert into members(name, phone)
  values (trim(p_name), trim(p_phone))
  returning id into v_member_id;

  select result.* into v_package
  from create_starter_package_atomic(
    v_member_id,
    p_class_name,
    p_schedule_ids,
    p_amount,
    p_method,
    p_payment_date
  ) result;

  member_id := v_member_id;
  package_id := v_package.package_id;
  solo_enrollment_id := v_package.solo_enrollment_id;
  solo_cycle_id := v_package.solo_cycle_id;
  group_enrollment_id := v_package.group_enrollment_id;
  group_cycle_id := v_package.group_cycle_id;
  return next;
end;
$$;

revoke all on function create_member_with_starter_package_atomic(text,text,text,bigint[],integer,text,date)
  from public, anon;
grant execute on function create_member_with_starter_package_atomic(text,text,text,bigint[],integer,text,date)
  to authenticated, service_role;
