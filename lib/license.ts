import { supabase, isConfigured } from './supabase';
import { Session } from '@/types';
import { getMachineId } from './machineId';

export { isConfigured };

const SESSION_KEY = 'dbmerge_session';

// 서버 함수가 토큰 오류(로그인 필요·차단)일 때 쓰는 errcode
const AUTH_ERROR_CODE = '28000';

type Profile = Omit<Session, 'token'>;

function saveSession(token: string, profile: Profile): Session {
  const session: Session = {
    token,
    id:       profile.id,
    name:     profile.name,
    phone:    profile.phone,
    is_admin: profile.is_admin,
    quota:    profile.quota,
    used:     profile.used,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

/**
 * 화면 표시용 세션. 권한·잔여건수 판단은 서버에서 하므로
 * 여기 값을 수정해도 실제 처리에는 영향 없음
 */
export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    // 토큰 없는 이전 형식 세션은 다시 로그인 필요
    return s.token ? s : null;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  const session = getSession();
  localStorage.removeItem(SESSION_KEY);
  if (supabase && session) {
    await supabase.rpc('dbmerge_logout', { p_token: session.token });
  }
}

async function authRpc(fn: 'dbmerge_login' | 'dbmerge_register', args: Record<string, string>): Promise<Session> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
  const { data, error } = await supabase.rpc(fn, { ...args, p_machine_id: await getMachineId() });
  if (error) throw new Error(error.message);
  const { token, profile } = data as { token: string; profile: Profile };
  return saveSession(token, profile);
}

export async function login(phone: string, password: string): Promise<Session> {
  return authRpc('dbmerge_login', { p_phone: phone, p_password: password });
}

export async function register(name: string, phone: string, password: string): Promise<Session> {
  return authRpc('dbmerge_register', { p_name: name, p_phone: phone, p_password: password });
}

/** 서버에서 최신 잔여건수를 받아 세션 갱신. 토큰이 무효(만료·차단)면 로그아웃 */
export async function refreshSession(): Promise<Session | null> {
  if (!supabase) return null;
  const session = getSession();
  if (!session) return null;

  const { data, error } = await supabase.rpc('dbmerge_me', { p_token: session.token });
  if (error) {
    if (error.code === AUTH_ERROR_CODE) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  }
  return saveSession(session.token, data as Profile);
}
