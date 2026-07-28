-- 같은 전화번호로 회원이 중복 생성되는 것을 최종적으로 차단한다.
-- 하이픈 등 구분 문자 유무가 달라도 숫자가 같으면 동일한 번호로 취급한다.
-- 기존 중복이 있으면 임의로 데이터를 합치지 않고 migration을 중단한다.
do $$
begin
  if exists (
    select 1
    from members
    group by regexp_replace(phone, '\D', '', 'g')
    having count(*) > 1
  ) then
    raise exception
      'DUPLICATE_PHONE_DATA: 중복 전화번호 회원을 먼저 확인하고 정리해야 합니다.';
  end if;
end;
$$;

create unique index if not exists idx_members_phone_digits_unique
  on members ((regexp_replace(phone, '\D', '', 'g')));
