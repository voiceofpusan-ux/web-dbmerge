// 주소록 정리(DB 비교·저장·삭제)가 서버 함수를 올바르게 나눠 호출하는지 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RowRecord } from '@/types';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('./supabase', () => ({ isConfigured: true, supabase: { rpc } }));
vi.mock('./license', () => ({ getSession: vi.fn(() => ({ token: 'tok' })) }));

import { bookTargets, findExisting, saveBook, deleteBookRows } from './book';

const row = (phone: string, extra: Partial<RowRecord> = {}): RowRecord => ({
  group: 'G', name: '홍길동', 수정전이름: '', 이름처리: '', 긴이름나머지: '', phone, memo: 'm',
  원본번호: phone, 출처파일: 'a.xlsx [S]', 수정번호: phone, 비고작업: '', 중복작업: '',
  주소: '서울', 당원구분: '권리당원', 비고1: 'n1', 비고2: '', 비고3: '', 비고4: '', 비고5: '', ...extra,
});

beforeEach(() => { rpc.mockReset(); });

describe('bookTargets', () => {
  it('오류번호는 DB 비교·저장 대상에서 제외', () => {
    const rows = [row('010-1111-0001'), row('02-123-4567', { 비고작업: '오류번호' }), row('', { 수정번호: '' })];
    expect(bookTargets(rows).map((r) => r.수정번호)).toEqual(['010-1111-0001']);
  });
});

describe('findExisting', () => {
  it('1000개씩 나눠 조회하고 번호별로 묶음', async () => {
    const phones = Array.from({ length: 2500 }, (_, i) => `010-0000-${String(i).padStart(4, '0')}`);
    const sizes: number[] = [];
    rpc.mockImplementation(async (_fn: string, args: { p_phones: string[] }) => {
      sizes.push(args.p_phones.length);
      const hit = args.p_phones.includes('010-0000-0001');
      return { data: hit ? [{ row_id: 1, fixed_phone: '010-0000-0001' }, { row_id: 2, fixed_phone: '010-0000-0001' }] : [], error: null };
    });
    const map = await findExisting([...phones, '010-0000-0001', '']);
    expect(sizes).toEqual([1000, 1000, 500]);
    expect(map.get('010-0000-0001')?.map((r) => r.row_id)).toEqual([1, 2]);
    expect(map.size).toBe(1);
  });
});

describe('saveBook', () => {
  it('1000행씩 같은 묶음에 이어 저장하고 결과를 합산', async () => {
    const calls: { bookId: string | null; rows: unknown[] }[] = [];
    rpc.mockImplementation(async (_fn: string, args: { p_book_id: string | null; p_rows: unknown[] }) => {
      calls.push({ bookId: args.p_book_id, rows: args.p_rows });
      return { data: { book_id: 'book-1', inserted: args.p_rows.length - 1, filled: 1 }, error: null };
    });
    const rows = Array.from({ length: 1500 }, (_, i) => row(`010-1000-${String(i).padStart(4, '0')}`));
    const progress: number[] = [];

    expect(await saveBook('a.xlsx', rows, (p) => progress.push(p))).toEqual({ inserted: 1498, filled: 2 });
    expect(calls.map((c) => c.bookId)).toEqual([null, 'book-1']);
    expect(calls.map((c) => c.rows.length)).toEqual([1000, 500]);
    expect(progress).toEqual([67, 100]);
    expect(calls[0].rows[0]).toEqual({
      fixed_phone: '010-1000-0000', orig_phone: '010-1000-0000', grp: 'G', name: '홍길동', memo: 'm',
      address: '서울', party_type: '권리당원', note1: 'n1', note2: '', note3: '', note4: '', note5: '', source: 'a.xlsx [S]',
    });
  });

  it('서버 거부(잔여 부족 등) 메시지를 그대로 전달', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: '잔여 건수가 부족합니다.' } });
    await expect(saveBook('a.xlsx', [row('010-1111-0001')])).rejects.toThrow('잔여 건수가 부족합니다.');
  });
});

describe('deleteBookRows', () => {
  it('고른 행 id로 삭제 요청', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    expect(await deleteBookRows([5, 9])).toBe(2);
    expect(rpc).toHaveBeenCalledWith('dbmerge_book_delete_rows', { p_token: 'tok', p_row_ids: [5, 9] });
  });
});

describe('내 주소록 검색·수정', () => {
  it('검색 조건을 그대로 서버에 전달', async () => {
    rpc.mockResolvedValue({ data: { total: 1, rows: [{ row_id: 3 }] }, error: null });
    const { searchBook } = await import('./book');
    expect(await searchBook({ query: '길동', group: null, party: '', hideOptout: true }, 50, 50)).toEqual({ total: 1, rows: [{ row_id: 3 }] });
    expect(rpc).toHaveBeenCalledWith('dbmerge_book_search', {
      p_token: 'tok', p_query: '길동', p_group: null, p_party: '', p_hide_optout: true, p_offset: 50, p_limit: 50,
    });
  });

  it('수정·그룹 변경 요청', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    const { updateBookRow, setBookGroup } = await import('./book');
    await updateBookRow(7, { name: '홍길순' });
    expect(rpc).toHaveBeenLastCalledWith('dbmerge_book_update_row', { p_token: 'tok', p_row_id: 7, p_fields: { name: '홍길순' } });
    expect(await setBookGroup([1, 2], '부산')).toBe(2);
    expect(rpc).toHaveBeenLastCalledWith('dbmerge_book_set_group', { p_token: 'tok', p_row_ids: [1, 2], p_group: '부산' });
  });

  it('서버 오류 메시지를 그대로 전달', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: '수정할 행을 찾을 수 없습니다.' } });
    const { updateBookRow } = await import('./book');
    await expect(updateBookRow(1, { name: 'x' })).rejects.toThrow('수정할 행을 찾을 수 없습니다.');
  });
});
