"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today" },
  { href: "/leads", label: "Leads" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/settings", label: "Settings" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="flex">
        {TABS.map((tab) => {
          const isActive = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${
                  isActive ? "text-neutral-900" : "text-neutral-400"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
