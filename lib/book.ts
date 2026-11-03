// 주소록 정리: 내 DB와 번호 비교·DB 정리(저장)·중복 행 삭제를 서버 함수로 호출
import { supabase } from './supabase';
import { getSession } from './license';
import { BookRow, RowRecord } from '@/types';

const CHUNK = 1000;   // 서버 함수가 한 번에 받는 최대 개수

function requireToken(): string {
  const token = getSession()?.token;
  if (!token) throw new Error('로그인이 필요합니다.');
  return token;
}

/** DB 비교·저장 대상: 오류번호가 아닌 정제결과 행 */
export function bookTargets(rows: RowRecord[]): RowRecord[] {
  return rows.filter((r) => r.비고작업 !== '오류번호' && r.수정번호);
}

function toBookRow(r: RowRecord) {
  return {
    fixed_phone: r.수정번호,
    orig_phone:  r.원본번호,
    grp:         r.group,
    name:        r.name,
    memo:        r.memo,
    address:     r.주소,
    party_type:  r.당원구분,
    note1:       r.비고1,
    note2:       r.비고2,
    note3:       r.비고3,
    note4:       r.비고4,
    note5:       r.비고5,
    source:      r.출처파일,
  };
}

/** 번호별로 내 DB에 이미 있는 행을 모두 찾음 (1000개씩 나눠 조회) */
export async function findExisting(phones: string[]): Promise<Map<string, BookRow[]>> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
  const token = requireToken();
  const unique = [...new Set(phones.filter(Boolean))];
  const byPhone = new Map<string, BookRow[]>();

  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await supabase.rpc('dbmerge_book_find', {
      p_token:  token,
      p_phones: unique.slice(i, i + CHUNK),
    });
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as BookRow[]) {
      const list = byPhone.get(row.fixed_phone);
      if (list) list.push(row);
      else byPhone.set(row.fixed_phone, [row]);
    }
  }
  return byPhone;
}

/**
 * DB 정리: 신규 번호는 저장(신규 건수만큼 차감), 이미 있는 번호는 빈 칸만 채움
 * 1000행씩 나눠 같은 묶음에 이어서 저장. 중간에 실패하면 그 전까지 저장·차감된 것은 남음
 */
export async function saveBook(
  fileName: string,
  rows: RowRecord[],
  onProgress?: (pct: number) => void,
): Promise<{ inserted: number; filled: number }> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
  const token = requireToken();
  let bookId: string | null = null;
  let inserted = 0;
  let filled = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await supabase.rpc('dbmerge_book_save', {
      p_token:     token,
      p_book_id:   bookId,
      p_file_name: fileName,
      p_rows:      rows.slice(i, i + CHUNK).map(toBookRow),
    });
    if (error) throw new Error(error.message);
    const res = data as { book_id: string; inserted: number; filled: number };
    bookId = res.book_id;
    inserted += res.inserted;
    filled += res.filled;
    onProgress?.(Math.round((Math.min(i + CHUNK, rows.length) / rows.length) * 100));
  }
  return { inserted, filled };
}

/** 중복 검토에서 고른 내 DB 행 삭제 */
export async function deleteBookRows(rowIds: number[]): Promise<number> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
  const { data, error } = await supabase.rpc('dbmerge_book_delete_rows', {
    p_token:   requireToken(),
    p_row_ids: rowIds,
  });
  if (error) throw new Error(error.message);
  return data as number;
}
