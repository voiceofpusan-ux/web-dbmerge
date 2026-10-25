// 로그인·세션 갱신이 서버 함수(RPC)를 올바르게 호출하는지 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('./supabase', () => ({ isConfigured: true, supabase: { rpc } }));
vi.mock('./machineId', () => ({ getMachineId: async () => 'machine-1' }));

import { login, register, logout, getSession, refreshSession } from './license';

const profile = { id: 'u1', name: '홍길동', phone: '01012345678', is_admin: false, quota: 300, used: 0 };

beforeEach(() => {
  rpc.mockReset();
  const store = new Map<string, string>();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});

describe('login / register', () => {
  it('서버가 준 토큰과 정보를 세션에 저장', async () => {
    rpc.mockResolvedValue({ data: { token: 'tok', profile }, error: null });
    await login('01012345678', 'pw123456');

    expect(rpc).toHaveBeenCalledWith('dbmerge_login', {
      p_phone: '01012345678', p_password: 'pw123456', p_machine_id: 'machine-1',
    });
    expect(getSession()).toEqual({ token: 'tok', ...profile });
  });

  it('가입도 서버 함수로 처리', async () => {
    rpc.mockResolvedValue({ data: { token: 'tok', profile }, error: null });
    await register('홍길동', '01012345678', 'pw123456');
    expect(rpc).toHaveBeenCalledWith('dbmerge_register', {
      p_name: '홍길동', p_phone: '01012345678', p_password: 'pw123456', p_machine_id: 'machine-1',
    });
  });

  it('서버 오류 메시지를 그대로 전달하고 세션은 만들지 않음', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: '전화번호 또는 비밀번호가 올바르지 않습니다.' } });
    await expect(login('01012345678', 'x')).rejects.toThrow('올바르지 않습니다');
    expect(getSession()).toBeNull();
  });
});

describe('getSession', () => {
  it('토큰 없는 이전 형식 세션은 무시 (다시 로그인)', () => {
    localStorage.setItem('dbmerge_session', JSON.stringify(profile));
    expect(getSession()).toBeNull();
  });
});

describe('refreshSession', () => {
  beforeEach(() => {
    localStorage.setItem('dbmerge_session', JSON.stringify({ token: 'tok', ...profile }));
  });

  it('서버의 최신 사용 건수로 갱신', async () => {
    rpc.mockResolvedValue({ data: { ...profile, used: 120 }, error: null });
    expect((await refreshSession())?.used).toBe(120);
    expect(rpc).toHaveBeenCalledWith('dbmerge_me', { p_token: 'tok' });
    expect(getSession()?.token).toBe('tok');
  });

  it('토큰이 무효(28000)면 로그아웃', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '28000', message: '사용이 차단된 계정입니다.' } });
    expect(await refreshSession()).toBeNull();
    expect(getSession()).toBeNull();
  });

  it('네트워크 등 다른 오류면 세션 유지', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '', message: 'Failed to fetch' } });
    expect((await refreshSession())?.token).toBe('tok');
    expect(getSession()).not.toBeNull();
  });
});

describe('logout', () => {
  it('로컬 세션 삭제 + 서버 토큰 폐기', async () => {
    localStorage.setItem('dbmerge_session', JSON.stringify({ token: 'tok', ...profile }));
    rpc.mockResolvedValue({ data: null, error: null });
    await logout();
    expect(getSession()).toBeNull();
    expect(rpc).toHaveBeenCalledWith('dbmerge_logout', { p_token: 'tok' });
  });
});
