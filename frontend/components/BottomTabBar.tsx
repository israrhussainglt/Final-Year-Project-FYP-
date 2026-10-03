"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect } from "react";

export type TabItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

// A fixed bottom tab bar, iOS/Android-style, shown only on small screens
// (the header nav takes over from `sm:` up). This is one of the biggest
// single things that makes a responsive web app read as "an app" instead
// of "a website that resizes" — persistent, thumb-reachable primary
// navigation instead of a hamburger menu buried behind a tap.
//
// Deliberately capped at 5 items: that's the point past which tab bars on a
// ~360px-wide phone screen become cramped and hard to tap accurately.
export function BottomTabBar({ items }: { items: TabItem[] }) {
  const pathname = usePathname();

  // This component is rendered inside each page's <header>, at the top of
  // the DOM, while the fixed bar it draws sits pinned to the bottom of the
  // viewport regardless of DOM position. That mismatch means a normal
  // sibling "spacer" element next to this <nav> would reserve blank space
  // at the top of the page, not the bottom, where it's actually needed. So
  // instead, a class on <body> flips on a global padding-bottom rule (see
  // globals.css) that applies to <main> — the one element every one of this
  // app's ~17 pages already renders — without needing each page
  // individually edited to know about the tab bar's height.
  useEffect(() => {
    document.body.classList.add("has-bottom-tab-bar");
    return () => document.body.classList.remove("has-bottom-tab-bar");
  }, []);

  return (
    <nav
      aria-label="Primary"
      className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-line safe-bottom safe-x"
    >
      <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              // 44px+ minimum tap target height (h-16 = 64px) per iOS/Android
              // HIG guidance, not the ~32px a text-only mobile nav link often
              // ends up with.
              className={`focus-ring flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
                active ? "text-teal-dark" : "text-sage"
              }`}
            >
              <span className={active ? "text-teal-dark" : "text-sage"}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
