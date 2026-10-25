# 보안 구조 개선 체크리스트

- [x] 현재 스키마를 재현한 테스트용 SQL (`supabase/tests/00_fixture.sql`)
- [x] 1단계 SQL: 서버 함수(RPC)·세션 테이블 추가 (`supabase/01_rpc_functions.sql`)
- [x] 2단계 SQL: 테이블 직접 접근 차단 (`supabase/02_lockdown.sql`)
- [x] SQL 테스트 (`supabase/tests/rpc_test.sql`) 로컬 Postgres에서 통과
- [x] `lib/license.ts` RPC 기반으로 교체 (로그인·가입·세션 갱신·로그아웃)
- [x] `lib/db.ts` RPC 기반으로 교체 (작업 시작·행 저장·실패 시 취소·이력 조회)
- [x] `ResultPanel`·`LicenseDialog` 연결 수정
- [x] vitest 테스트 갱신 및 통과, 타입 검사·빌드 통과
- [x] `CLAUDE.md` 문서 갱신
- [x] PR 생성
