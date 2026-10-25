-- 새 프로젝트 경로 테스트: 빈 DB에 00 → 01 → 02 적용 후 RPC 검증 (빈 테스트 DB 전용)
--   createdb dbmerge_fresh && psql -v ON_ERROR_STOP=1 -d dbmerge_fresh -f supabase/tests/run_fresh.sql

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

\ir supabase_env.sql
\ir ../00_schema.sql
\ir ../01_rpc_functions.sql
\ir ../02_lockdown.sql
\ir ../03_remove_row_storage.sql
\ir ../03_remove_row_storage.sql
\ir 10_seed.sql
\ir 20_rpc_test.sql

-- 새 스키마에서만 있는 제약 확인
select test.err($$insert into dbmerge_licenses (name, phone, password) values ('x', '01055556666', 'x')$$,
                'duplicate key', '전화번호 중복 저장 불가 (unique)');

\echo 'FRESH SQL TESTS PASSED'
