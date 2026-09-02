'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({
  href,
  label,
  count,
}: {
  href: string;
  label: string;
  count?: number;
}) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link href={href} {...(active ? { 'aria-current': 'page' as const } : {})}>
      <span>{label}</span>
      {count === undefined ? null : <span className="nav-count">{count}</span>}
    </Link>
  );
}
