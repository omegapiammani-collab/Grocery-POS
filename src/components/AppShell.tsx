'use client';

import { useEffect, useState } from 'react';
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

const STORE_NAME_CACHE_KEY = 'pos:last-store-name';
const DEFAULT_STORE_NAME = 'ร้านขายของชำ POS';

function StoreNameText({ name, className }: { name: string | null; className: string }) {
  if (name) return <span className={className}>{name}</span>;
  return (
    <span
      aria-hidden="true"
      className="block h-4 w-28 max-w-full animate-pulse rounded bg-slate-200 motion-reduce:animate-none"
    />
  );
}

export function AppShell({
  children,
  storeName,
}: {
  children: React.ReactNode;
  /** ส่ง null/undefined ระหว่างที่ settings ยังโหลดไม่เสร็จ เพื่อไม่ให้ชื่อ fallback แสดงแว็บแล้วเปลี่ยน */
  storeName?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isRegisterFocus = pathname.startsWith('/pos');
  const [cachedStoreName, setCachedStoreName] = useState<string | null>(null);

  useEffect(() => {
    if (storeName) {
      try {
        window.localStorage.setItem(STORE_NAME_CACHE_KEY, storeName);
      } catch {
        // ignore storage errors (private mode / quota)
      }
      return;
    }
    try {
      const cached = window.localStorage.getItem(STORE_NAME_CACHE_KEY);
      if (cached) setCachedStoreName(cached);
    } catch {
      // ignore storage errors
    }
  }, [storeName]);

  const [loadTimedOut, setLoadTimedOut] = useState(false);
  useEffect(() => {
    if (storeName) return;
    const timer = window.setTimeout(() => setLoadTimedOut(true), 4000);
    return () => window.clearTimeout(timer);
  }, [storeName]);

  const displayStoreName =
    storeName || cachedStoreName || (loadTimedOut ? DEFAULT_STORE_NAME : null);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-dvh flex flex-col md:flex-row bg-slate-50">
      {/* Desktop / Tablet Left Sidebar (slim icon rail on /pos for Operate-mode focus) */}
      <aside
        className={`hidden md:flex md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-200 z-20 transition-[width] duration-150 ${
          isRegisterFocus ? 'md:w-16' : 'md:w-56 lg:w-64'
        }`}
      >
        <div
          className={`flex items-center border-b border-slate-100 ${
            isRegisterFocus ? 'justify-center px-2 py-4' : 'gap-3 px-5 py-4'
          }`}
        >
          <div
            title={displayStoreName ?? undefined}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm"
          >
            <Store className="h-5 w-5" />
          </div>
          {!isRegisterFocus && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">
                <StoreNameText name={displayStoreName} className="" />
              </p>
              <p className="text-xs text-slate-500">ระบบขายหน้าร้าน</p>
            </div>
          )}
        </div>

        <nav className={`flex-1 space-y-1 overflow-y-auto ${isRegisterFocus ? 'p-1.5' : 'p-3'}`}>
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={isRegisterFocus ? item.label : undefined}
                aria-label={isRegisterFocus ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center rounded-xl transition-colors ${
                  isRegisterFocus
                    ? 'flex-col justify-center gap-0.5 px-1 py-2 text-[10px]'
                    : 'gap-3 px-3.5 py-3 text-sm'
                } ${
                  active
                    ? 'bg-emerald-50/90 text-emerald-800 ring-1 ring-emerald-200/80 font-bold shadow-2xs'
                    : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-emerald-600' : 'text-slate-500'}`} />
                <span className={isRegisterFocus ? 'truncate max-w-full leading-tight' : ''}>
                  {isRegisterFocus ? item.shortLabel : item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className={`border-t border-slate-100 ${isRegisterFocus ? 'p-1.5' : 'p-3'}`}>
          <button
            type="button"
            onClick={handleLogout}
            title={isRegisterFocus ? 'ออกจากระบบ' : undefined}
            aria-label="ออกจากระบบ"
            className={`flex w-full items-center rounded-xl font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700 transition-colors ${
              isRegisterFocus
                ? 'flex-col justify-center gap-0.5 px-1 py-2 text-[10px]'
                : 'gap-3 px-3.5 py-2.5 text-sm'
            }`}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className={isRegisterFocus ? 'truncate max-w-full leading-tight' : ''}>
              {isRegisterFocus ? 'ออก' : 'ออกจากระบบ'}
            </span>
          </button>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="md:hidden sticky top-0 z-20 flex items-center justify-between bg-white border-b border-slate-200 px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Store className="h-4 w-4" />
          </div>
          <StoreNameText name={displayStoreName} className="truncate text-sm font-bold text-slate-900" />
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
      <main
        className={`flex-1 pb-20 md:pb-0 min-w-0 ${
          isRegisterFocus ? 'md:pl-16' : 'md:pl-56 lg:pl-64'
        }`}
      >
        {children}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 flex items-center justify-around px-1 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))]">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 rounded-lg px-2.5 py-1 text-[11px] transition-colors ${
                active
                  ? 'bg-emerald-50 text-emerald-700 font-bold'
                  : 'font-medium text-slate-600 hover:text-slate-900'
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
