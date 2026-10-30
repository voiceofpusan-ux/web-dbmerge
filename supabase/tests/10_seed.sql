-- 테스트 도우미 함수와 기존 방식(SHA-256) 사용자 데이터를 넣는 시드

-- ── 테스트 도우미 ─────────────────────────────────────────────
create schema test;
grant usage on schema test to anon;

create function test.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok - %', label;
end $$;

-- sql 실행 시 pattern을 포함한 오류가 나야 통과
create function test.err(sql text, pattern text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(pattern in sqlerrm) > 0 then
      raise notice 'ok - %', label;
      return;
    end if;
    raise exception 'FAIL: % (다른 오류: %)', label, sqlerrm;
  end;
  raise exception 'FAIL: % (오류가 나지 않음)', label;
end $$;
grant execute on all functions in schema test to anon;

-- ── 기존 사용자 (SHA-256 해시, 1단계 적용 전 상태) ────────────
insert into dbmerge_licenses (phone, name, password, quota, used, is_admin, status, machine_id) values
  ('01011112222', '기존', encode(sha256(convert_to('01011112222' || 'pass1234', 'UTF8')), 'hex'), 1000, 0, false, 'active',  ''),
  ('01099990000', '관리', encode(sha256(convert_to('01099990000' || 'admin123', 'UTF8')), 'hex'),    0, 0, true,  'active',  ''),
  ('01033334444', '차단', encode(sha256(convert_to('01033334444' || 'pass1234', 'UTF8')), 'hex'), 1000, 0, false, 'blocked', ''),
  -- 이전 방식으로 기기 1대가 등록된 계정 (01 적용 시 dbmerge_devices로 옮겨져야 함)
  ('01022223333', '기기', encode(sha256(convert_to('01022223333' || 'pass1234', 'UTF8')), 'hex'), 1000, 0, false, 'active',  'legacy-pc');
