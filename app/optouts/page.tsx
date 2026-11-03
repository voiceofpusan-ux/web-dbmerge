'use client';
// 수신거부 목록: 번호 붙여넣기·엑셀 파일로 등록, 검색, 선택 해제

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Session } from '@/types';
import { getSession } from '@/lib/license';
import { loadFile } from '@/lib/loader';
import { OptoutRow, addOptouts, deleteOptouts, listOptouts, normalizeOptoutPhones } from '@/lib/optout';

const PAGE = 50;

export default function OptoutsPage() {
  const [session,  setSession]  = useState<Session | null | undefined>(undefined);   // undefined = 아직 읽기 전
  const [text,     setText]     = useState('');
  const [memo,     setMemo]     = useState('');
  const [busy,     setBusy]     = useState(false);
  const [notice,   setNotice]   = useState('');
  const [query,    setQuery]    = useState('');
  const [applied,  setApplied]  = useState('');
  const [page,     setPage]     = useState(0);
  const [data,     setData]     = useState<{ total: number; rows: OptoutRow[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setSession(getSession()); }, []);
  const canStore = !!session && (!!session.can_store || session.is_admin);

  const load = useCallback(async () => {
    try {
      setData(await listOptouts(applied, page * PAGE, PAGE));
      setSelected(new Set());
    } catch (e: unknown) {
      alert(`조회 오류: ${e instanceof Error ? e.message : e}`);
    }
  }, [applied, page]);

  useEffect(() => { if (canStore) load(); }, [canStore, load]);

  // 번호들을 정리해서 등록하고 결과를 알려 줌
  const register = async (raws: string[]) => {
    const { valid, invalid } = normalizeOptoutPhones(raws);
    if (valid.length === 0) { alert('등록할 수 있는 번호가 없습니다. (010 휴대폰 번호만 등록됩니다)'); return; }
    setBusy(true);
    try {
      const added = await addOptouts(valid, memo.trim());
      setNotice(
        `✓ ${added.toLocaleString()}건 등록` +
        (valid.length > added ? ` · 이미 있던 번호 ${(valid.length - added).toLocaleString()}건` : '') +
        (invalid.length ? ` · 휴대폰 번호가 아니라 제외 ${invalid.length.toLocaleString()}건` : ''),
      );
      setText('');
      setPage(0);
      await load();
    } catch (e: unknown) {
      alert(`등록 오류: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  // 엑셀/CSV의 전화번호 칸(자동 인식)을 모두 등록
  const handleFile = async (file: File) => {
    try {
      const sheets = await loadFile(file);
      const raws = sheets.flatMap((s) => (s.columnMap.phone ? s.data.map((row) => row[s.columnMap.phone] ?? '') : []));
      if (raws.length === 0) { alert('전화번호 칸을 찾지 못했습니다. 첫 줄에 "휴대폰", "전화번호" 같은 제목이 있어야 합니다.'); return; }
      if (!confirm(`${file.name}에서 번호 ${raws.length.toLocaleString()}개를 찾았습니다. 수신거부로 등록할까요?`)) return;
      await register(raws);
    } catch (e: unknown) {
      alert(`파일 오류: ${e instanceof Error ? e.message : e}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    if (!confirm(`선택한 ${selected.size}건을 수신거부에서 해제하시겠습니까?\n해제하면 문자 발송 대상에 다시 포함될 수 있습니다.`)) return;
    try {
      const n = await deleteOptouts([...selected]);
      setNotice(`✓ ${n}건을 해제했습니다.`);
      await load();
    } catch (e: unknown) {
      alert(`해제 오류: ${e instanceof Error ? e.message : e}`);
    }
  };

  const rows = data?.rows ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.fixed_phone));
  const toggle = (p: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-base font-bold text-gray-800">수신거부 목록</h1>
        <div className="flex items-center gap-3">
          <Link href="/contacts" className="text-sm px-3 py-1.5 border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50">내 주소록</Link>
          <Link href="/book" className="text-sm px-3 py-1.5 border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50">주소록 정리</Link>
          <Link href="/" className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">엑셀 정리</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        {session === undefined ? null : !session ? (
          <Empty>로그인이 필요합니다. <Link href="/" className="underline">처음 화면</Link>에서 로그인하세요.</Empty>
        ) : !canStore ? (
          <Empty>DB 저장 권한이 없습니다. 관리자에게 권한을 요청하세요.</Empty>
        ) : (
          <>
            {/* 등록 */}
            <div className="bg-white rounded-xl border p-5 shadow-sm space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">수신거부 번호 등록</h2>
              <p className="text-xs text-gray-500">
                등록한 번호는 처리 결과와 내 주소록에 "수신거부"로 표시되고, 엑셀받기 때 뺄 수 있습니다. 보관 기간과 상관없이 해제할 때까지 남습니다.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'번호를 한 줄에 하나씩 (쉼표·공백으로 구분해도 됩니다)\n010-1234-5678\n01098765432'}
                rows={5}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-400"
              />
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="메모 (예: 2026-11 전화로 거부 요청)"
                  className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={() => register(text.split(/[\n,\s]+/))}
                  disabled={busy || !text.trim()}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40"
                >
                  {busy ? '등록 중...' : '등록'}
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  엑셀/CSV로 등록
                </button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </div>
            </div>

            {notice && <p className="text-sm text-green-600 font-medium">{notice}</p>}

            {/* 목록 */}
            <div className="bg-white rounded-xl border p-4 shadow-sm flex flex-wrap gap-2 items-center">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { setPage(0); setApplied(query.trim()); } }}
                placeholder="번호 일부 · 메모"
                className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <button onClick={() => { setPage(0); setApplied(query.trim()); }} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">검색</button>
              <span className="text-sm text-gray-500">{data ? `${data.total.toLocaleString()}건` : ''}</span>
              {selected.size > 0 && (
                <button onClick={handleDelete} className="ml-auto px-3 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50">
                  선택 {selected.size}건 해제
                </button>
              )}
            </div>

            <div className="bg-white rounded-xl border shadow-sm overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 border-b w-8">
                      <input type="checkbox" checked={allChecked} aria-label="이 페이지 전체 선택"
                        onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.fixed_phone)))} />
                    </th>
                    {['전화번호', '메모', '등록일'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 border-b">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.fixed_phone} className={`border-b ${selected.has(r.fixed_phone) ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-1.5"><input type="checkbox" checked={selected.has(r.fixed_phone)} onChange={() => toggle(r.fixed_phone)} /></td>
                      <td className="px-3 py-1.5 font-medium whitespace-nowrap">{r.fixed_phone}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.memo}</td>
                      <td className="px-3 py-1.5 text-gray-400 text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString('ko-KR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data && rows.length === 0 && <p className="text-center text-gray-400 text-sm py-10">등록된 수신거부 번호가 없습니다.</p>}
            </div>

            <div className="flex justify-center items-center gap-3 text-sm">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40">이전</button>
              <span className="text-gray-600">{page + 1} / {pages} 페이지</span>
              <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40">다음</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-xl border p-12 text-center text-gray-500 text-sm">{children}</div>;
}
