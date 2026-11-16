import type { Metadata } from 'next';
import './globals.css';
import { IdentityProvider } from '@/components/IdentityProvider';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: '智权链·锂安溯 | TrustGuard Battery',
  description: '基于 AI 动态信任与 Hyperledger Fabric 的动力电池质量谱系追溯及主动安全防护平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <IdentityProvider>
          <AppShell>{children}</AppShell>
        </IdentityProvider>
      </body>
    </html>
  );
}
