import { supabase } from './supabase';
import { getSession } from './license';
import { ProcessResult } from '@/types';

export interface JobRecord {
  id: string;
  user_id: string;
  total: number;
  unique_count: number;
  duplicate: number;
  converted: number;
  error: number;
  file_names: string[];
  created_at: string;
}

/**
 * 엑셀받기 건수 차감 + 사용 기록. 연락처 행은 서버로 보내지 않고 통계만 보냄
 * 잔여 건수가 부족하면 서버 오류 메시지로 거부됨
 */
export async function chargeExport(result: ProcessResult, fileNames: string[]): Promise<string> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
  const token = getSession()?.token;
  if (!token) throw new Error('로그인이 필요합니다.');

  const { data, error } = await supabase.rpc('dbmerge_start_job', {
    p_token:      token,
    p_total:      result.stats.total,
    p_unique:     result.stats.unique,
    p_duplicate:  result.stats.duplicate,
    p_converted:  result.stats.converted,
    p_error:      result.stats.error,
    p_file_names: fileNames,
  });

  if (error) throw new Error(error.message);
  return data as string;
}

/** 현재 로그인 사용자의 사용 이력 (엑셀받기 기록) */
export async function getJobs(): Promise<JobRecord[]> {
  if (!supabase) return [];
  const session = getSession();
  if (!session) return [];

  const { data, error } = await supabase.rpc('dbmerge_get_jobs', { p_token: session.token });

  if (error) throw new Error(error.message);
  return (data ?? []) as JobRecord[];
}
