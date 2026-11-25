'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ShoppingCart,
  Package,
  Users,
  Clock,
  BarChart3,
  LogOut,
  Store,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const navItems = [
  { href: '/pos', label: 'ขายหน้าร้าน', shortLabel: 'ขายของ', icon: ShoppingCart },
  { href: '/inventory', label: 'สินค้า & สต็อก', shortLabel: 'สต็อก', icon: Package },
  { href: '/customers', label: 'ลูกค้าเงินเชื่อ', shortLabel: 'เงินเชื่อ', icon: Users },
  { href: '/shifts', label: 'กะ & ลิ้นชัก', shortLabel: 'ปิดกะ', icon: Clock },
  { href: '/dashboard', label: 'สรุปยอด & ตั้งค่า', shortLabel: 'รายงาน', icon: BarChart3 },
];

export function AppShell({
  children,
  storeName = 'ร้านขายของชำ POS',
}: {
  children: React.ReactNode;
  storeName?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-dvh flex flex-col md:flex-row bg-slate-50">
      {/* Desktop / Tablet Left Sidebar */}
      <aside className="hidden md:flex md:w-56 lg:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-200 z-20">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
            <Store className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{storeName}</p>
            <p className="text-xs text-slate-500">ระบบขายหน้าร้าน</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-emerald-50 text-emerald-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-100">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700 transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>ออกจากระบบ</span>
          </button>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="md:hidden sticky top-0 z-20 flex items-center justify-between bg-white border-b border-slate-200 px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Store className="h-4 w-4" />
          </div>
          <span className="truncate text-sm font-bold text-slate-900">{storeName}</span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          aria-label="ออกจากระบบ"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-rose-600"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 md:pl-56 lg:pl-64 pb-20 md:pb-0 min-w-0">
        {children}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 flex items-center justify-around px-1 py-1.5">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                active ? 'text-emerald-600 font-semibold' : 'text-slate-500'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.shortLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
