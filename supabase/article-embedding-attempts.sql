-- 임베딩 재시도 횟수.
--
-- 기사 임베딩은 처리 마지막에 한 번 시도하고, 실패하면 embedding_status만 failed로 적고 넘어갔다.
-- 그 뒤 아무도 다시 집지 않아 그 기사는 영영 검색에 안 걸렸다. curate 훅이 다시 집도록 바꾸면서,
-- 영구 실패(본문이 이상하거나 API가 계속 거절)를 매 훅마다 다시 집어 헛돌지 않도록 횟수를 센다.
-- 상한(3회)에 닿으면 조회 대상에서 빠진다. 재실행해도 안전하다.
alter table article add column if not exists embedding_attempts int not null default 0;
