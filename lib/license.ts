import { supabase, isConfigured } from './supabase';
import { LicenseInfo, Session } from '@/types';

export { isConfigured };

const SESSION_KEY = 'dbmerge_session';

async function hashPassword(phone: string, password: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(phone + password));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function saveSession(lic: LicenseInfo): Session {
  const session: Session = {
    id:       lic.id,
    name:     lic.name,
    phone:    lic.phone,
    is_admin: lic.is_admin,
    quota:    lic.quota,
    used:     lic.used,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Session; } catch { return null; }
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
}

export async function login(phone: string, password: string): Promise<Session> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
  const hashed = await hashPassword(phone, password);

  const { data, error } = await supabase
    .from('dbmerge_licenses')
    .select('*')
    .eq('phone', phone)
    .eq('password', hashed)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('전화번호 또는 비밀번호가 올바르지 않습니다.');

  const lic = data as LicenseInfo;
  if (lic.status === 'blocked') throw new Error('사용이 차단된 계정입니다. 관리자에게 문의하세요.');

  return saveSession(lic);
}

export async function register(name: string, phone: string, password: string): Promise<Session> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');

  const { data: existing } = await supabase
    .from('dbmerge_licenses')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  if (existing) throw new Error('이미 등록된 전화번호입니다.');

  const hashed = await hashPassword(phone, password);

  const { data, error } = await supabase
    .from('dbmerge_licenses')
    .insert({
      name,
      phone,
      password:     hashed,
      is_admin:     false,
      status:       'active',
      quota:        300,
      used:         0,
      charge_count: 0,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return saveSession(data as LicenseInfo);
}

export async function refreshSession(): Promise<Session | null> {
  if (!supabase) return null;
  const session = getSession();
  if (!session) return null;

  const { data } = await supabase
    .from('dbmerge_licenses')
    .select('*')
    .eq('id', session.id)
    .maybeSingle();

  if (!data) return null;
  return saveSession(data as LicenseInfo);
}

export async function consumeLicense(count: number): Promise<{ ok: boolean; message: string }> {
  if (!isConfigured) return { ok: true, message: '' };

  const session = getSession();
  if (!session) return { ok: false, message: '로그인이 필요합니다.' };

  const { data: lic } = await supabase!
    .from('dbmerge_licenses')
    .select('*')
    .eq('id', session.id)
    .maybeSingle();

  if (!lic) return { ok: false, message: '계정 정보를 찾을 수 없습니다.' };
  if (lic.status === 'blocked') return { ok: false, message: '사용이 차단된 계정입니다.' };

  const remaining = lic.quota - lic.used;
  if (remaining < count) {
    return {
      ok: false,
      message: `잔여 건수가 부족합니다.\n잔여: ${remaining.toLocaleString()}건  /  필요: ${count.toLocaleString()}건`,
    };
  }

  const { error } = await supabase!
    .from('dbmerge_licenses')
    .update({ used: lic.used + count })
    .eq('id', lic.id);

  if (error) return { ok: false, message: `차감 오류: ${error.message}` };

  saveSession({ ...lic, used: lic.used + count });
  return { ok: true, message: '' };
}
