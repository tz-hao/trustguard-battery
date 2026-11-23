import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ToastProvider';
import { IdentityProvider } from '@/components/IdentityProvider';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: '智权链·锂安溯 | TrustGuard Battery',
  description: '基于 AI 动态信任与 Hyperledger Fabric 的动力电池质量谱系追溯及主动安全防护平台',
  icons: {
    icon: '/brand/logo-mark.png',
    apple: '/brand/logo-mark.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <ToastProvider>
          <IdentityProvider>
            <AppShell>{children}</AppShell>
          </IdentityProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
