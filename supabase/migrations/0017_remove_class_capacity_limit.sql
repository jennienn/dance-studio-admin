-- 단체반 수강 인원 제한을 제거한다.
-- classes.capacity 컬럼은 기존 데이터와의 호환성을 위해 유지하지만 등록 검증에는 사용하지 않는다.
drop trigger if exists trg_check_class_capacity on cycle_schedules;
drop function if exists check_class_capacity();
