// 수신거부 번호 정리와 서버 호출(1000개씩 나눠 보내기)을 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('./supabase', () => ({ isConfigured: true, supabase: { rpc } }));
vi.mock('./license', () => ({ getSession: vi.fn(() => ({ token: 'tok' })) }));

import { normalizeOptoutPhones, addOptouts, checkOptouts, deleteOptouts } from './optout';

beforeEach(() => { rpc.mockReset(); });

describe('normalizeOptoutPhones', () => {
  it('010 형식으로 정리하고 오류번호는 따로, 같은 번호는 하나만', () => {
    expect(normalizeOptoutPhones(['010-1111-2222', ' 01011112222 ', '011-234-5678', '02-123-4567', ''])).toEqual({
      valid: ['010-1111-2222', '010-5234-5678'],
      invalid: ['02-123-4567'],
    });
  });
});

describe('서버 호출', () => {
  it('등록은 1000개씩 나눠 보내고 합산', async () => {
    const sizes: number[] = [];
    rpc.mockImplementation(async (_fn: string, args: { p_items: { fixed_phone: string; memo: string }[] }) => {
      sizes.push(args.p_items.length);
      return { data: args.p_items.length, error: null };
    });
    const phones = Array.from({ length: 1200 }, (_, i) => `010-2000-${String(i).padStart(4, '0')}`);
    expect(await addOptouts(phones, '요청')).toBe(1200);
    expect(sizes).toEqual([1000, 200]);
    expect(rpc.mock.calls[0][1].p_items[0]).toEqual({ fixed_phone: '010-2000-0000', memo: '요청' });
  });

  it('확인은 수신거부 번호 집합을 돌려줌', async () => {
    rpc.mockResolvedValue({ data: ['010-1111-2222'], error: null });
    expect(await checkOptouts(['010-1111-2222', '010-1111-2222', '010-3333-4444', ''])).toEqual(new Set(['010-1111-2222']));
    expect(rpc).toHaveBeenCalledWith('dbmerge_optout_check', { p_token: 'tok', p_phones: ['010-1111-2222', '010-3333-4444'] });
  });

  it('해제 요청과 서버 오류 전달', async () => {
    rpc.mockResolvedValueOnce({ data: 1, error: null });
    expect(await deleteOptouts(['010-1111-2222'])).toBe(1);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'DB 저장 권한이 없습니다.' } });
    await expect(deleteOptouts(['010-1111-2222'])).rejects.toThrow('DB 저장 권한이 없습니다.');
  });
});
