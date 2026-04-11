import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '연락처 엑셀 통합 정제 도구',
  description: '다수의 엑셀 파일을 통합하고 전화번호를 정규화·중복 제거합니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
