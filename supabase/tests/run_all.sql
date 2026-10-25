-- SQL 테스트 전체 실행 (빈 테스트 DB 전용, 실제 Supabase DB에서 실행하지 말 것)
--   createdb dbmerge_test && psql -v ON_ERROR_STOP=1 -d dbmerge_test -f supabase/tests/run_all.sql

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

\ir 00_fixture.sql
\ir 10_seed.sql

-- 1단계는 여러 번 실행해도 안전해야 함
\ir ../01_rpc_functions.sql
\ir ../01_rpc_functions.sql

-- 1단계만 적용한 상태에서는 기존 앱(테이블 직접 접근)이 계속 동작해야 함
set role anon;
select test.ok((select count(*) from dbmerge_licenses) = 3, '1단계 후에도 기존 앱 직접 조회 동작');
reset role;

\ir ../02_lockdown.sql
\ir ../03_remove_row_storage.sql
\ir ../03_remove_row_storage.sql
\ir 20_rpc_test.sql

\echo 'ALL SQL TESTS PASSED'
