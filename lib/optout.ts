// 수신거부 목록: 등록·조회·해제·번호 확인을 서버 함수로 호출
import { supabase } from './supabase';
import { getSession } from './license';
import { normalizePhone } from './normalizer';

const CHUNK = 1000;   // 서버 함수가 한 번에 받는 최대 개수

export interface OptoutRow { fixed_phone: string; memo: string; created_at: string }

function requireToken(): string {
  const token = getSession()?.token;
  if (!token) throw new Error('로그인이 필요합니다.');
  return token;
}

function client() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
  return supabase;
}

/** 입력 번호들을 010 형식으로 정리. 오류번호는 invalid로 따로 돌려줌 (같은 번호는 하나만) */
export function normalizeOptoutPhones(raws: string[]): { valid: string[]; invalid: string[] } {
  const valid = new Set<string>();
  const invalid: string[] = [];
  for (const raw of raws.map((r) => r.trim()).filter(Boolean)) {
    const [fixed, remark] = normalizePhone(raw);
    if (remark === '오류번호') invalid.push(raw);
    else valid.add(fixed);
  }
  return { valid: [...valid], invalid };
}

/** 등록 (1000개씩). 새로 등록된 수 반환. 이미 있는 번호는 서버가 건너뜀 */
export async function addOptouts(phones: string[], memo: string): Promise<number> {
  const token = requireToken();
  let added = 0;
  for (let i = 0; i < phones.length; i += CHUNK) {
    const { data, error } = await client().rpc('dbmerge_optout_add', {
      p_token: token,
      p_items: phones.slice(i, i + CHUNK).map((fixed_phone) => ({ fixed_phone, memo })),
    });
    if (error) throw new Error(error.message);
    added += data as number;
  }
  return added;
}

/** 목록 (번호 일부·메모 검색, 최신순) */
export async function listOptouts(query: string, offset: number, limit: number): Promise<{ total: number; rows: OptoutRow[] }> {
  const { data, error } = await client().rpc('dbmerge_optout_list', {
    p_token: requireToken(), p_query: query, p_offset: offset, p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return data as { total: number; rows: OptoutRow[] };
}

/** 해제 (1000개씩). 해제된 수 반환 */
export async function deleteOptouts(phones: string[]): Promise<number> {
  const token = requireToken();
  let removed = 0;
  for (let i = 0; i < phones.length; i += CHUNK) {
    const { data, error } = await client().rpc('dbmerge_optout_delete', { p_token: token, p_phones: phones.slice(i, i + CHUNK) });
    if (error) throw new Error(error.message);
    removed += data as number;
  }
  return removed;
}

/** 주어진 번호 중 수신거부인 번호 (1000개씩 확인) */
export async function checkOptouts(phones: string[]): Promise<Set<string>> {
  const token = requireToken();
  const unique = [...new Set(phones.filter(Boolean))];
  const found = new Set<string>();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await client().rpc('dbmerge_optout_check', { p_token: token, p_phones: unique.slice(i, i + CHUNK) });
    if (error) throw new Error(error.message);
    for (const p of data as string[]) found.add(p);
  }
  return found;
}
