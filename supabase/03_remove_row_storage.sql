-- DB 저장 기능 제거: 이전 버전의 00~02를 이미 적용한 프로젝트에서 연락처 행 저장 함수·테이블을 삭제
--
-- 적용: 이전 버전 SQL을 실행한 프로젝트에서 한 번 실행 (새 프로젝트도 00→01→02 다음에 실행해도 무해, 반복 실행 가능)
-- ⚠️ dbmerge_rows 테이블(저장돼 있던 연락처 행)을 삭제함. 되돌릴 수 없음
-- 남는 것: dbmerge_start_job(차감 + 사용 기록), dbmerge_get_jobs(사용 이력)

drop function if exists public.dbmerge_add_rows(text, text, jsonb);
drop function if exists public.dbmerge_get_rows(text, text, int, int);
drop function if exists public.dbmerge_abort_job(text, text);
drop function if exists public._dbmerge_own_job(public.dbmerge_licenses, text);

drop table if exists public.dbmerge_rows;
