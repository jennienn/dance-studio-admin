-- 0001_init.sql
-- 댄스학원 관리 시스템 스키마 v2
-- 핵심 구조: members → enrollments(수강권 정체성) → enrollment_cycles(재등록마다 새로 생성)
--            → payments / sessions / attendance_logs / notifications / cycle_schedules
-- classes → class_schedules(요일별 정규수업) ← cycle_schedules(회원이 실제 선택한 요일 조합)

-- ========== members ==========
create table if not exists members (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_members_name on members using gin (to_tsvector('simple', name));
create index if not exists idx_members_phone on members (phone);

-- ========== classes (단체레슨 반) ==========
create table if not exists classes (
  id bigint generated always as identity primary key,
  name text not null unique,
  capacity integer not null default 10,
  active boolean not null default true
);

-- ========== class_schedules (반의 정규 요일) ==========
-- 예: kpop반 = 월/화/수/목 각각 1행. curriculum_group으로 "월-화 같은 진도" / "수-목 같은 진도"를 표현.
create table if not exists class_schedules (
  id bigint generated always as identity primary key,
  class_id bigint not null references classes(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6), -- 0=일 ... 6=토
  start_time time,
  curriculum_group text, -- 같은 진도를 듣는 요일끼리 묶는 값 (예: 'A', 'B')
  unique (class_id, weekday)
);

-- ========== enrollments (수강권 자체의 정체성 — 재등록해도 이 행은 유지) ==========
create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  member_id bigint not null references members(id) on delete cascade,
  kind text not null check (kind in ('solo', 'group')),
  class_id bigint references classes(id), -- kind='group'일 때만
  status text not null default 'active' check (status in ('active', 'ended')),
  ended_date date,
  end_reason text, -- 예: "재등록 의사 없음", "이사", 운영자가 자유 기술
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_requires_class check (
    (kind = 'group' and class_id is not null) or (kind = 'solo' and class_id is null)
  )
);
create index if not exists idx_enrollments_member on enrollments (member_id);
create index if not exists idx_enrollments_status on enrollments (status);

-- ========== enrollment_cycles (결제/재등록 1회 = 1개 주기) ==========
create table if not exists enrollment_cycles (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments(id) on delete cascade,

  plan integer check (plan in (4, 8, 12)), -- solo 전용
  base_count integer not null,             -- 이번에 새로 결제한 횟수 (solo: plan, group: 8)
  carry_over_count integer not null default 0, -- 이전 주기에서 이월된 잔여
  total_count integer not null,            -- base_count + carry_over_count
  used_count integer not null default 0,

  -- solo 전용: 첫 수업을 실제로 기록하기 전까지는 미정(NULL)으로 둔다
  first_class_date date,
  valid_end_date date,

  -- group 전용
  next_due_date date,

  payment_date date not null,
  status text not null default 'active' check (status in ('active', 'completed', 'expired')),

  -- 알림톡 상태를 주기별로 denormalize (조회 성능 목적, notifications 테이블이 원본)
  notify_status text not null default 'not_required'
    check (notify_status in ('pending', 'sent', 'skipped', 'failed', 'not_required')),
  notify_date timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint solo_cycle_fields check (
    (plan is not null) or (plan is null) -- group cycle은 plan NULL
  )
);
create index if not exists idx_cycles_enrollment on enrollment_cycles (enrollment_id);
create index if not exists idx_cycles_active_solo on enrollment_cycles (status, valid_end_date);
create index if not exists idx_cycles_active_group on enrollment_cycles (status, next_due_date);

-- 한 enrollment에 "active" 주기는 항상 최대 1개만 존재해야 함 (동시에 두 주기가 진행되면 안 됨)
create unique index if not exists idx_one_active_cycle_per_enrollment
  on enrollment_cycles (enrollment_id) where (status = 'active');

-- ========== cycle_schedules (이 주기에서 회원이 실제로 다니는 요일 조합) ==========
-- 예: kpop반 월+수 조합 회원이면 이 테이블에 2행(월요일 schedule, 수요일 schedule)이 들어감
create table if not exists cycle_schedules (
  cycle_id uuid not null references enrollment_cycles(id) on delete cascade,
  schedule_id bigint not null references class_schedules(id) on delete cascade,
  primary key (cycle_id, schedule_id)
);

-- ========== payments (결제 내역 — cycle당 1건만) ==========
create table if not exists payments (
  id bigint generated always as identity primary key,
  cycle_id uuid not null unique references enrollment_cycles(id) on delete cascade,
  amount integer not null,
  method text not null check (method in ('card', 'transfer', 'cash', 'other')),
  payment_date date not null,
  status text not null default 'completed'
    check (status in ('completed', 'cancelled', 'refunded', 'partially_refunded')),
  refunded_amount integer not null default 0,
  note text
);

-- ========== sessions (개인레슨 회차 — cycle 기준) ==========
create table if not exists sessions (
  id bigint generated always as identity primary key,
  cycle_id uuid not null references enrollment_cycles(id) on delete cascade,
  session_index integer not null,
  date date,
  status text not null default 'pending' check (status in ('pending', 'done', 'auto')),
  note text,
  unique (cycle_id, session_index)
);
-- 같은 주기 안에서 같은 날짜에 두 회차를 동시에 기록하는 실수를 방지
create unique index if not exists idx_sessions_no_duplicate_date
  on sessions (cycle_id, date) where (date is not null);

-- ========== attendance_logs (단체레슨 출석 — cycle+요일스케줄 기준) ==========
create table if not exists attendance_logs (
  id bigint generated always as identity primary key,
  cycle_id uuid not null references enrollment_cycles(id) on delete cascade,
  schedule_id bigint not null references class_schedules(id),
  date date not null,
  attended boolean not null default true,
  created_at timestamptz not null default now(),
  unique (cycle_id, schedule_id, date)
);

-- ========== notifications (알림톡 발송 이력 — cycle 기준) ==========
create table if not exists notifications (
  id bigint generated always as identity primary key,
  cycle_id uuid not null references enrollment_cycles(id) on delete cascade,
  status text not null check (status in ('sent', 'failed')),
  trigger_type text not null check (trigger_type in ('auto', 'manual_renew', 'manual_resend')),
  message text,
  fail_reason text,
  sent_at timestamptz not null default now()
);
create index if not exists idx_notifications_cycle on notifications (cycle_id);

-- ========== updated_at 자동 갱신 ==========
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_members_updated_at on members;
create trigger trg_members_updated_at before update on members
  for each row execute function set_updated_at();

drop trigger if exists trg_enrollments_updated_at on enrollments;
create trigger trg_enrollments_updated_at before update on enrollments
  for each row execute function set_updated_at();

drop trigger if exists trg_cycles_updated_at on enrollment_cycles;
create trigger trg_cycles_updated_at before update on enrollment_cycles
  for each row execute function set_updated_at();

-- ========== 단체반 정원 검증 ==========
-- cycle_schedules에 새 행이 들어갈 때, 해당 class_schedule이 속한 반의 정원을 초과하지 않는지 확인.
-- "현재 인원"은 종료(ended)되지 않은 enrollment + active 상태의 cycle만 카운트한다.
create or replace function check_class_capacity()
returns trigger as $$
declare
  v_class_id bigint;
  v_capacity integer;
  v_current_count integer;
begin
  select cs.class_id, c.capacity into v_class_id, v_capacity
  from class_schedules cs
  join classes c on c.id = cs.class_id
  where cs.id = new.schedule_id;

  select count(distinct ec.enrollment_id) into v_current_count
  from cycle_schedules csch
  join enrollment_cycles ec on ec.id = csch.cycle_id
  join enrollments e on e.id = ec.enrollment_id
  join class_schedules cs2 on cs2.id = csch.schedule_id
  where cs2.class_id = v_class_id
    and ec.status = 'active'
    and e.status = 'active';

  if v_current_count >= v_capacity then
    raise exception 'CLASS_CAPACITY_EXCEEDED: 반 정원(%)을 초과했습니다', v_capacity
      using errcode = '23514';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_class_capacity on cycle_schedules;
create trigger trg_check_class_capacity before insert on cycle_schedules
  for each row execute function check_class_capacity();

-- ========== Row Level Security ==========
-- 운영자(인증된 사용자)만 전체 접근 가능. 여러 운영자가 생기고 권한 분리가 필요해지면
-- auth.users에 role을 별도 관리하고 정책을 세분화할 것.
alter table members enable row level security;
alter table classes enable row level security;
alter table class_schedules enable row level security;
alter table enrollments enable row level security;
alter table enrollment_cycles enable row level security;
alter table cycle_schedules enable row level security;
alter table payments enable row level security;
alter table sessions enable row level security;
alter table attendance_logs enable row level security;
alter table notifications enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'members', 'classes', 'class_schedules', 'enrollments', 'enrollment_cycles',
    'cycle_schedules', 'payments', 'sessions', 'attendance_logs', 'notifications'
  ] loop
    execute format(
      'create policy "authenticated_full_access" on %I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')',
      t
    );
  end loop;
end $$;

-- ========== 초기 데이터: 지금 운영 중인 두 반 ==========
insert into classes (name, capacity) values ('kpop반', 10), ('다이어트 댄스반', 10)
  on conflict (name) do nothing;

insert into class_schedules (class_id, weekday, curriculum_group)
select c.id, v.weekday, v.curriculum_group from (
  values
    ('kpop반', 1, 'A'), ('kpop반', 2, 'A'), ('kpop반', 3, 'B'), ('kpop반', 4, 'B'),
    ('다이어트 댄스반', 2, 'A'), ('다이어트 댄스반', 4, 'A')
) as v(class_name, weekday, curriculum_group)
join classes c on c.name = v.class_name
on conflict (class_id, weekday) do nothing;
