// 작업 저장·이력 조회가 서버 함수(RPC)를 올바르게 호출하는지 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessResult, RowRecord } from '@/types';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('./supabase', () => ({ isConfigured: true, supabase: { rpc } }));
vi.mock('./license', () => ({ getSession: vi.fn() }));

import { saveJob, getRows } from './db';
import { getSession } from './license';

function makeResult(n: number): ProcessResult {
  const row = (i: number): RowRecord => ({
    group: '', name: `이름${i}`, 수정전이름: '', 이름처리: '', 긴이름나머지: '', phone: '', memo: '',
    원본번호: '', 출처파일: 'a.xlsx [S]', 수정번호: `010-0000-${String(i).padStart(4, '0')}`,
    비고작업: '', 중복작업: '', 주소: '', 당원구분: '', 비고1: '', 비고2: '', 비고3: '', 비고4: '', 비고5: '',
  });
  const rows = Array.from({ length: n }, (_, i) => row(i));
  return { uniqueRows: rows, allRows: rows, stats: { total: n, unique: n, duplicate: 0, converted: 0, error: 0 } };
}

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(getSession).mockReturnValue({ token: 'tok', id: 'u1', name: '', phone: '', is_admin: false, quota: 0, used: 0 });
});

describe('saveJob', () => {
  it('작업 시작 후 500행씩 나눠 저장 (job_id·user_id는 보내지 않음)', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'dbmerge_start_job' ? { data: 'job-1', error: null } : { data: 500, error: null });

    expect(await saveJob(makeResult(1200), ['a.xlsx'])).toBe('job-1');

    expect(rpc.mock.calls[0]).toEqual(['dbmerge_start_job', expect.objectContaining({ p_token: 'tok', p_unique: 1200, p_file_names: ['a.xlsx'] })]);
    const addCalls = rpc.mock.calls.filter(([fn]) => fn === 'dbmerge_add_rows');
    expect(addCalls.map(([, a]) => a.p_rows.length)).toEqual([500, 500, 200]);
    expect(addCalls[0][1].p_rows[0]).not.toHaveProperty('job_id');
    expect(addCalls[0][1].p_rows[0]).not.toHaveProperty('user_id');
  });

  it('행 저장이 실패하면 작업을 취소(서버에서 삭제·환불)하고 오류', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'dbmerge_start_job') return { data: 'job-1', error: null };
      if (fn === 'dbmerge_add_rows')  return { data: null, error: { message: 'network' } };
      return { data: null, error: null };
    });

    await expect(saveJob(makeResult(10), [])).rejects.toThrow('network');
    expect(rpc).toHaveBeenLastCalledWith('dbmerge_abort_job', { p_token: 'tok', p_job_id: 'job-1' });
  });

  it('잔여 건수 부족 등 서버 거부 메시지를 그대로 전달', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: '잔여 건수가 부족합니다.' } });
    await expect(saveJob(makeResult(10), [])).rejects.toThrow('잔여 건수가 부족합니다.');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('로그인하지 않으면 서버를 호출하지 않음', async () => {
    vi.mocked(getSession).mockReturnValue(null);
    await expect(saveJob(makeResult(1), [])).rejects.toThrow('로그인이 필요합니다.');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('getRows', () => {
  it('1000행 제한을 넘는 작업도 페이지로 나눠 전부 받음', async () => {
    const sizes = [1000, 1000, 500];
    rpc.mockImplementation(async () => ({ data: Array(sizes.shift()).fill({}), error: null }));

    expect(await getRows('job-1')).toHaveLength(2500);
    expect(rpc.mock.calls.map(([, a]) => a.p_offset)).toEqual([0, 1000, 2000]);
  });
});
