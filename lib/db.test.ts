// 엑셀받기 건수 차감·사용 이력이 서버 함수(RPC)를 올바르게 호출하는지 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessResult, RowRecord } from '@/types';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('./supabase', () => ({ isConfigured: true, supabase: { rpc } }));
vi.mock('./license', () => ({ getSession: vi.fn() }));

import { chargeExport, getJobs } from './db';
import { getSession } from './license';

function makeResult(n: number): ProcessResult {
  const row = (i: number): RowRecord => ({
    group: '', name: `이름${i}`, 수정전이름: '', 이름처리: '', 긴이름나머지: '', phone: '', memo: '',
    원본번호: '', 출처파일: 'a.xlsx [S]', 수정번호: `010-0000-${String(i).padStart(4, '0')}`,
    비고작업: '', 중복작업: '', 주소: '', 당원구분: '권리당원', 비고1: '', 비고2: '', 비고3: '', 비고4: '', 비고5: '',
  });
  const rows = Array.from({ length: n }, (_, i) => row(i));
  return { uniqueRows: rows, allRows: rows, stats: { total: n + 2, unique: n, duplicate: 2, converted: 0, error: 1 } };
}

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(getSession).mockReturnValue({ token: 'tok', id: 'u1', name: '', phone: '', is_admin: false, quota: 0, used: 0 });
});

describe('chargeExport', () => {
  it('통계만 서버로 보내 차감 (연락처 행은 보내지 않음)', async () => {
    rpc.mockResolvedValue({ data: 'job-1', error: null });

    expect(await chargeExport(makeResult(120), ['a.xlsx'])).toBe('job-1');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('dbmerge_start_job', {
      p_token: 'tok', p_total: 122, p_unique: 120, p_duplicate: 2, p_converted: 0, p_error: 1, p_file_names: ['a.xlsx'],
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('권리당원');
  });

  it('잔여 건수 부족 등 서버 거부 메시지를 그대로 전달', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: '잔여 건수가 부족합니다.' } });
    await expect(chargeExport(makeResult(10), [])).rejects.toThrow('잔여 건수가 부족합니다.');
  });

  it('로그인하지 않으면 서버를 호출하지 않음', async () => {
    vi.mocked(getSession).mockReturnValue(null);
    await expect(chargeExport(makeResult(1), [])).rejects.toThrow('로그인이 필요합니다.');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('getJobs', () => {
  it('내 사용 이력 조회', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'job-1' }], error: null });
    expect(await getJobs()).toEqual([{ id: 'job-1' }]);
    expect(rpc).toHaveBeenCalledWith('dbmerge_get_jobs', { p_token: 'tok' });
  });
});
