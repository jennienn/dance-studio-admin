-- SOLAPI 실제 발송을 위한 상태/응답 필드와 cycle+알림종류 단위 idempotency.
alter table enrollment_cycles
  drop constraint if exists enrollment_cycles_notify_status_check;
alter table enrollment_cycles
  add constraint enrollment_cycles_notify_status_check
  check (notify_status in ('processing', 'pending', 'sent', 'skipped', 'failed', 'not_required'));

alter table notifications add column if not exists provider text;
alter table notifications add column if not exists provider_group_id text;
alter table notifications add column if not exists provider_message_id text;
alter table notifications add column if not exists error_code text;
alter table notifications add column if not exists updated_at timestamptz not null default now();

alter table notifications
  drop constraint if exists notifications_trigger_type_check;
alter table notifications
  add constraint notifications_trigger_type_check
  check (trigger_type in ('auto', 'registration', 'manual_renew', 'manual_resend'));

-- 기존 더미 구현이 같은 종류의 이력을 중복 생성했을 수 있으므로 최신 1건만 보존한다.
delete from notifications older
using notifications newer
where older.cycle_id = newer.cycle_id
  and older.trigger_type = newer.trigger_type
  and older.id < newer.id;

create unique index if not exists idx_notifications_cycle_trigger
  on notifications (cycle_id, trigger_type);

-- 완료 알림 상태가 자동 결제 임박 알림을 막지 않도록 자동 알림 상태를 분리한다.
update enrollment_cycles ec
set notify_status = 'not_required',
    notify_date = null
where ec.notify_status = 'sent'
  and exists (
    select 1 from notifications n
    where n.cycle_id = ec.id and n.trigger_type = 'manual_renew'
  )
  and not exists (
    select 1 from notifications n
    where n.cycle_id = ec.id and n.trigger_type = 'auto'
  );

create or replace function set_notification_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_notifications_updated_at on notifications;
create trigger trg_notifications_updated_at
before update on notifications
for each row execute function set_notification_updated_at();
