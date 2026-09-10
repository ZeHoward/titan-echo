import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '泰坦遠征', description: '點擊出擊、召集英雄、挑戰巨獸。你的放置冒險，現在開始。' };
export default function RootLayout({children}: {children: React.ReactNode}) { return <html lang="zh-Hant"><body>{children}</body></html>; }
