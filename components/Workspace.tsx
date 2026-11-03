'use client';
// 업로드·처리·결과 화면. 엑셀 정리(/)와 주소록 정리(/book) 두 모드로 사용

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { SheetEntry, ProcessResult, Session } from '@/types';
import UploadPanel from '@/components/UploadPanel';
import ResultPanel from '@/components/ResultPanel';
import LicenseDialog from '@/components/LicenseDialog';
import BookPanel from '@/components/BookPanel';
import { bookTargets } from '@/lib/book';
import { checkOptouts } from '@/lib/optout';
import { process as processData } from '@/lib/deduplicator';
import { getSession, retentionLabel, isConfigured as licConfigured } from '@/lib/license';
import { isConfigured as dbConfigured } from '@/lib/supabase';

export default function Workspace({ mode }: { mode: 'excel' | 'book' }) {
  const [sheets,      setSheets]      = useState<SheetEntry[]>([]);
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [result,      setResult]      = useState<ProcessResult | null>(null);
  const [processing,  setProcessing]  = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [session,     setSession]     = useState<Session | null>(null);
  const [applyNames,  setApplyNames]  = useState(false);
  const [spaceCount,  setSpaceCount]  = useState(3);

  const refreshSession = useCallback(() => {
    setSession(getSession());
  }, []);

  // 로그인 정보는 브라우저 저장소에 있으므로 화면이 뜬 뒤에 읽음 (서버 렌더링 결과와 어긋나지 않게)
  useEffect(() => {
    const s = getSession();
    setSession(s);
    if (licConfigured && !s) setShowAccount(true);
  }, []);

  // 주소록 정리는 DB 저장 권한 계정과 슈퍼어드민만
  const canStore = !!session && (!!session.can_store || session.is_admin);
  const bookBlocked = mode === 'book' && licConfigured && !!session && !canStore;

  // 처리 결과의 번호 중 수신거부 확인 (DB 저장 권한 계정만). 실패해도 엑셀받기는 그대로 가능
  const [optouts, setOptouts] = useState<Set<string> | null>(null);
  useEffect(() => {
    setOptouts(null);
    if (!result || !canStore) return;
    let alive = true;
    checkOptouts(bookTargets(result.uniqueRows).map((r) => r.수정번호))
      .then((set) => { if (alive) setOptouts(set); })
      .catch(() => { /* 수신거부 확인 실패 시 표시만 생략 */ });
    return () => { alive = false; };
  }, [result, canStore]);

  const selectedSheet = sheets.find((s) => s.id === selectedId);
  const fileNames = [...new Set(sheets.map((s) => s.fileName))];

  const handleProcess = () => {
    if (sheets.length === 0) return;
    setProcessing(true);
    setTimeout(() => {
      try {
        setResult(processData(sheets, applyNames, spaceCount));
      } catch (e) {
        alert(`처리 오류: ${e}`);
      } finally {
        setProcessing(false);
      }
    }, 50);
  };

  const remaining = session ? session.quota - session.used : 0;

  const quotaText = () => {
    if (!licConfigured) return null;
    if (!session) return '잔여건수: 로그인 필요';
    if (session.is_admin) return '슈퍼어드민';
    if (remaining <= 0) return '잔여건수: 0건 (충전 필요)';
    return `잔여건수: ${remaining.toLocaleString()}건`;
  };

  const quotaColor = () => {
    if (!session) return 'text-gray-400';
    if (session.is_admin) return 'text-purple-600';
    if (remaining <= 0) return 'text-red-600';
    if (remaining <= 1000) return 'text-orange-500';
    return 'text-green-600';
  };

  return (
    <div className="min-h-screen">
      {/* 헤더 */}
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-base font-bold text-gray-800">
          {mode === 'book' ? '주소록 정리' : '연락처 엑셀 통합 정제 도구'}
        </h1>
        <div className="flex items-center gap-3">
          {canStore && (
            <Link
              href={mode === 'book' ? '/' : '/book'}
              className="text-sm px-3 py-1.5 border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50"
            >
              {mode === 'book' ? '엑셀 정리' : '주소록 정리'}
            </Link>
          )}
          {canStore && (
            <Link href="/contacts" className="text-sm px-3 py-1.5 border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50">
              내 주소록
            </Link>
          )}
          {canStore && (
            <Link href="/optouts" className="text-sm px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
              수신거부
            </Link>
          )}
          {licConfigured && (
            <span className={`text-sm ${quotaColor()}`}>{quotaText()}</span>
          )}
          {dbConfigured && (
            <Link href="/history" className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">
              사용 이력
            </Link>
          )}
          <button
            onClick={() => setShowAccount(true)}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {session ? `${session.name} 님` : '로그인'}
          </button>
        </div>
      </header>

      {/* DB 저장 권한이 있는 일반 계정에 보관 기간 안내 (슈퍼어드민은 영구) */}
      {session?.can_store && !session.is_admin && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-sm text-amber-800">
          {session.retention_hours == null
            ? 'DB는 영구 보관됩니다.'
            : `DB는 보관기간이 ${retentionLabel(session.retention_hours)}입니다. 기간이 지나면 자동으로 삭제됩니다.`}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {bookBlocked ? (
          <div className="bg-white rounded-xl border p-12 text-center text-gray-500 text-sm">
            DB 저장 권한이 없습니다. 주소록 정리를 쓰려면 관리자에게 권한을 요청하세요.
          </div>
        ) : !result ? (
          <>
            <div className="flex gap-4 items-start">
              {/* 업로드 패널 */}
              <div className="flex-1 bg-white rounded-xl border p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">파일 업로드 및 컬럼 매핑</h2>
                <UploadPanel
                  sheets={sheets}
                  onSheetsChange={setSheets}
                  selectedId={selectedId}
                  onSelectSheet={setSelectedId}
                />
              </div>

              {/* 미리보기 패널 */}
              {selectedSheet && (
                <div className="w-80 flex-shrink-0 bg-white rounded-xl border p-5 shadow-sm">
                  <h2 className="text-sm font-semibold text-gray-700 mb-1">미리보기</h2>
                  <p className="text-xs text-gray-400 mb-3">
                    {selectedSheet.fileName} [{selectedSheet.sheetName}] · 전체 {selectedSheet.data.length.toLocaleString()}행
                  </p>
                  <div className="overflow-auto max-h-80">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          {selectedSheet.headers.slice(0, 5).map((h) => (
                            <th key={h} className="px-2 py-1.5 text-left font-medium text-gray-600 border-b whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSheet.data.slice(0, 10).map((row, i) => (
                          <tr key={i} className="border-b hover:bg-gray-50">
                            {selectedSheet.headers.slice(0, 5).map((h) => (
                              <td key={h} className="px-2 py-1 whitespace-nowrap text-gray-700 max-w-[80px] truncate">
                                {row[h]}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col items-center gap-3 pt-2">
              {/* 이름 처리 옵션 */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={applyNames}
                    onChange={(e) => setApplyNames(e.target.checked)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="text-sm text-gray-700 font-medium">이름 처리</span>
                  <span className="text-xs text-gray-400">(2글자 좌우폭조절 · 4글자 이상 분리)</span>
                </label>
                {applyNames && (
                  <label className="flex items-center gap-1.5 text-sm text-gray-600">
                    <span>공백</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={spaceCount}
                      onChange={(e) => setSpaceCount(Math.max(1, Math.min(10, Number(e.target.value))))}
                      className="w-14 border border-gray-300 rounded px-2 py-0.5 text-center text-sm focus:outline-none focus:border-blue-400"
                    />
                    <span>칸</span>
                  </label>
                )}
              </div>

              <button
                onClick={handleProcess}
                disabled={sheets.length === 0 || processing}
                className="px-10 py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shadow"
              >
                {processing ? '처리 중...' : '처리하기'}
              </button>
            </div>
          </>
        ) : (
          <>
            {mode === 'book' && (
              <div className="bg-white rounded-xl border p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">내 DB와 비교</h2>
                <BookPanel result={result} fileNames={fileNames} onLicenseRefresh={refreshSession} />
              </div>
            )}
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">처리 결과</h2>
              <ResultPanel
                result={result}
                fileNames={fileNames}
                onClose={() => setResult(null)}
                onLicenseRefresh={refreshSession}
                exportPrefix={mode === 'book' ? `${session?.phone || '주소록'}_주소록정리` : undefined}
                optouts={optouts}
              />
            </div>
          </>
        )}
      </main>

      {showAccount && (
        <LicenseDialog
          onClose={() => { if (!licConfigured || session) setShowAccount(false); }}
          onRefresh={refreshSession}
        />
      )}
    </div>
  );
}
