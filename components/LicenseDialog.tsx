'use client';

import { useState } from 'react';
import { login, register, logout, getSession, refreshSession } from '@/lib/license';
import { Session } from '@/types';

interface Props {
  onClose: () => void;
  onRefresh: () => void;
}

type Tab = 'login' | 'register';

export default function LicenseDialog({ onClose, onRefresh }: Props) {
  const [tab,      setTab]      = useState<Tab>('login');
  const [phone,    setPhone]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [session,  setSession]  = useState<Session | null>(getSession);

  const remaining = session ? session.quota - session.used : 0;

  const reset = () => { setPhone(''); setPassword(''); setName(''); setConfirm(''); setError(''); };

  const handleLogin = async () => {
    if (!phone.trim() || !password) { setError('전화번호와 비밀번호를 입력하세요.'); return; }
    setLoading(true); setError('');
    try {
      const s = await login(phone.trim(), password);
      setSession(s);
      onRefresh();
      reset();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '로그인 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!name.trim() || !phone.trim() || !password) { setError('모든 항목을 입력하세요.'); return; }
    if (password.length < 6) { setError('비밀번호는 6자 이상이어야 합니다.'); return; }
    if (password !== confirm) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setLoading(true); setError('');
    try {
      const s = await register(name.trim(), phone.trim(), password);
      setSession(s);
      onRefresh();
      reset();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '가입 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    setSession(null);
    onRefresh();
  };

  const handleRefreshQuota = async () => {
    setLoading(true);
    const s = await refreshSession();
    setSession(s);
    onRefresh();
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[400px] p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-800">계정 관리</h2>

        {session ? (
          /* ── 로그인 상태 ── */
          <>
            <div className="border rounded-lg p-4 bg-gray-50 space-y-2">
              <p className="text-sm font-semibold text-gray-800">{session.name} 님</p>
              <p className="text-xs text-gray-500">전화번호: {session.phone}</p>
              {session.is_admin && (
                <p className="text-xs font-medium text-purple-600">슈퍼어드민</p>
              )}
              <div className="pt-1 border-t mt-1">
                <p className="text-xs text-gray-500">
                  잔여 처리건수:{' '}
                  <span className={`font-semibold ${remaining <= 0 ? 'text-red-600' : remaining <= 1000 ? 'text-orange-500' : 'text-green-600'}`}>
                    {remaining.toLocaleString()}건
                  </span>
                  {' '}/ 총 {session.quota.toLocaleString()}건
                </p>
                <p className="text-xs text-gray-400 mt-0.5">사용 {session.used.toLocaleString()}건</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleRefreshQuota}
                disabled={loading}
                className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {loading ? '새로고침 중...' : '잔여건수 새로고침'}
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 py-2 text-sm bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100"
              >
                로그아웃
              </button>
            </div>
          </>
        ) : (
          /* ── 비로그인 상태 ── */
          <>
            {/* 탭 */}
            <div className="flex border rounded-lg overflow-hidden">
              {(['login', 'register'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setError(''); }}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  {t === 'login' ? '로그인' : '회원가입'}
                </button>
              ))}
            </div>

            {/* 폼 */}
            <div className="flex flex-col gap-2">
              {tab === 'register' && (
                <input
                  placeholder="이름"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
              )}
              <input
                placeholder="전화번호 (아이디)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              />
              <input
                type="password"
                placeholder={tab === 'register' ? '비밀번호 (6자 이상)' : '비밀번호'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && tab === 'login') handleLogin(); }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              />
              {tab === 'register' && (
                <input
                  type="password"
                  placeholder="비밀번호 확인"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
              )}
              {error && <p className="text-red-500 text-xs">{error}</p>}
              <button
                onClick={tab === 'login' ? handleLogin : handleRegister}
                disabled={loading}
                className="py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium mt-1"
              >
                {loading ? '처리 중...' : tab === 'login' ? '로그인' : '가입하기 (무료 300건 제공)'}
              </button>
            </div>

            {tab === 'register' && (
              <p className="text-xs text-gray-400 text-center">
                가입 즉시 300건 무료 제공 · 추가 충전은 관리자 문의
              </p>
            )}
          </>
        )}

        <button onClick={onClose} className="w-full py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
          닫기
        </button>
      </div>
    </div>
  );
}
