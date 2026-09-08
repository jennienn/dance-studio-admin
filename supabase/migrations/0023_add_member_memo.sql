alter table members
  add column if not exists operator_memo text;

alter table members
  add constraint members_operator_memo_length
  check (operator_memo is null or char_length(operator_memo) <= 2000);
