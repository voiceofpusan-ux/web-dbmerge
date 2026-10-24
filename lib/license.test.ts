// 라이선스 건수 차감·환불 테스트 (Supabase는 메모리 객체로 대체)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  lic: { id: 'u1', name: '홍길동', phone: '01012345678', is_admin: false, status: 'active', quota: 300, used: 0 },
}));

vi.mock('./supabase', () => ({
  isConfigured: true,
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...db.lic } }) }) }),
      update: (patch: Partial<typeof db.lic>) => ({
        eq: async () => { Object.assign(db.lic, patch); return { error: null }; },
      }),
    }),
  },
}));

import { consumeLicense, refundLicense, getSession } from './license';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  Object.assign(db.lic, { is_admin: false, used: 0 });
  localStorage.setItem('dbmerge_session', JSON.stringify({ ...db.lic }));
});

describe('refundLicense', () => {
  it('DB 저장 실패 시 차감한 건수를 되돌림', async () => {
    expect((await consumeLicense(100)).ok).toBe(true);
    expect(db.lic.used).toBe(100);

    await refundLicense(100);
    expect(db.lic.used).toBe(0);
    expect(getSession()?.used).toBe(0);
  });

  it('사용 건수가 0 아래로 내려가지 않음', async () => {
    await refundLicense(50);
    expect(db.lic.used).toBe(0);
  });

  it('슈퍼어드민은 차감하지 않으므로 환불도 하지 않음', async () => {
    Object.assign(db.lic, { is_admin: true, used: 10 });
    localStorage.setItem('dbmerge_session', JSON.stringify({ ...db.lic }));
    await refundLicense(5);
    expect(db.lic.used).toBe(10);
  });
});
