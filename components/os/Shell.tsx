"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { SECTIONS } from "@/lib/os/sections";
import { Icon } from "@/components/os/icons";
import { createClient } from "@/lib/os/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Persistent application shell: fixed left section-nav on desktop, off-canvas on
 * mobile. Rendered by the (app) layout, so it survives navigation between
 * sections — the nav never remounts. Auth-aware footer (from shared.profiles).
 */
export function Shell({
  email,
  role,
  fullName,
  children,
}: {
  email: string;
  role: string;
  fullName?: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const brand = (
    <Link href="/reps" className="flex items-center gap-2 px-1" onClick={() => setOpen(false)}>
      <div className="w-7 h-7 rounded-lg bg-white text-navy grid place-items-center font-extrabold text-xs shrink-0">
        RNB
      </div>
      <span className="font-bold text-white text-[15px] tracking-tight">RNB Onboarding</span>
    </Link>
  );

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {SECTIONS.map((s) => {
        const active = pathname === s.href || pathname.startsWith(s.href + "/");
        return (
          <Link
            key={s.key}
            href={s.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition-colors",
              active ? "bg-white text-navy" : "text-white/70 hover:bg-white/10 hover:text-white",
            )}
          >
            <Icon name={s.icon} className={cn("shrink-0", active ? "opacity-100" : "opacity-80")} />
            <span className="truncate">{s.label}</span>
            {s.status !== "live" && (
              <span
                className={cn(
                  "ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                  active ? "bg-navy/10 text-navy/60" : "bg-white/10 text-white/50",
                )}
              >
                {s.status === "external" ? "Ext" : "Soon"}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 pt-3 mt-3">
      <div className="px-1 mb-2 leading-tight min-w-0">
        <div className="text-[12px] font-semibold text-white truncate">{fullName || email}</div>
        <div className="text-[11px] text-white/50 capitalize">{role}</div>
      </div>
      <button
        onClick={signOut}
        className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-semibold text-white/70 hover:bg-white/10 hover:text-white transition-colors"
      >
        <Icon name="logout" className="shrink-0" />
        Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-3 py-2.5 bg-navy text-white">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="p-1.5 rounded-lg hover:bg-white/10"
        >
          <Icon name="menu" width={20} height={20} />
        </button>
        {brand}
      </header>

      {/* Off-canvas backdrop (mobile) */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-navy/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-56 bg-navy flex flex-col p-3 gap-3 transition-transform duration-200",
          "lg:translate-x-0",
          open ? "translate-x-0 shadow-2xl" : "-translate-x-full lg:shadow-none",
        )}
      >
        <div className="flex items-center justify-between">
          {brand}
          <button
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="lg:hidden p-1 rounded-lg text-white/70 hover:bg-white/10"
          >
            <Icon name="close" width={18} height={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto thin-scroll">{nav}</div>
        {footer}
      </aside>

      {/* Content */}
      <div className="lg:pl-56 min-h-screen flex flex-col">
        <main className="mx-auto max-w-[1600px] w-full px-4 py-5 flex-1">{children}</main>
      </div>
    </div>
  );
}
