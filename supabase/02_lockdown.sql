-- 2단계: 브라우저(anon 키)의 dbmerge 테이블 직접 접근을 막음. 새 앱 배포 후 실행
--
-- 적용 후 관리자 콘솔(admin-james)의 DB통합정제 탭은 anon 키 대신 service_role 키로 연결해야 함
-- 되돌리기: 기존 "anon all" 정책을 다시 만들고 grant all ... to anon 실행

-- 세 테이블의 기존 정책을 모두 제거 ("anon all ..." 등)
do $$
declare
  p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('dbmerge_licenses', 'dbmerge_jobs', 'dbmerge_rows')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

alter table public.dbmerge_licenses enable row level security;
alter table public.dbmerge_jobs     enable row level security;
alter table public.dbmerge_rows     enable row level security;

-- RLS만으로는 PATCH가 0건 성공(200)으로 보일 수 있어 권한 자체도 회수 → 명확한 권한 오류
revoke all on public.dbmerge_licenses, public.dbmerge_jobs, public.dbmerge_rows from anon, authenticated;
