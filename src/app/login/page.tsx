'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Store, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { seedSampleGroceryData } from '@/lib/seed';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    const supabase = createClient();

    if (mode === 'login') {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInErr) {
        setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง: ' + signInErr.message);
        setLoading(false);
        return;
      }
      router.push('/pos');
      router.refresh();
    } else {
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
      });
      if (signUpErr) {
        setError('สร้างบัญชีไม่สำเร็จ: ' + signUpErr.message);
        setLoading(false);
        return;
      }
      if (data.session) {
        await seedSampleGroceryData(supabase);
        router.push('/pos');
        router.refresh();
      } else {
        setMessage('สร้างบัญชีสำเร็จ! กรุณายืนยันอีเมลแล้วเข้าสู่ระบบ');
        setMode('login');
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 sm:p-8 shadow-xl border border-slate-200">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md mb-3">
            <Store className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">ระบบร้านขายของชำ POS</h1>
          <p className="text-sm text-slate-500 mt-1">
            {mode === 'login'
              ? 'เข้าสู่ระบบสำหรับเจ้าของร้าน'
              : 'สร้างบัญชีเจ้าของร้านใหม่ (ครั้งแรก)'}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              อีเมล
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@myshop.com"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชีเจ้าของร้าน'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-600">
          {mode === 'login' ? (
            <>
              เพิ่งใช้งานครั้งแรก?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setError('');
                }}
                className="font-semibold text-emerald-600 hover:underline"
              >
                สร้างบัญชีเจ้าของร้าน
              </button>
            </>
          ) : (
            <>
              มีบัญชีอยู่แล้ว?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className="font-semibold text-emerald-600 hover:underline"
              >
                กลับไปเข้าสู่ระบบ
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
