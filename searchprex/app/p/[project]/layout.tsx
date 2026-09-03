import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { data } from '@/lib/data/index';
import { NavLink } from '@/lib/ui/nav-link';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  const summary = await data.project(project);
  if (summary === null) notFound();

  const [actions, refusals, placements] = await Promise.all([
    data.actions(project),
    data.refusals(project),
    data.placements(project),
  ]);

  const base = `/p/${project}`;

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-name">Searchprex</div>
          <div className="brand-sub">{summary.domain}</div>
        </div>
        <div className="nav">
          <NavLink href={`${base}/actions`} label="Actions" count={actions.length + refusals.length} />
          <NavLink href={base} label="Visibility" />
          <NavLink href={`${base}/placements`} label="Placements" count={placements.length} />
          <NavLink href={`${base}/proof`} label="Proof" />
          <NavLink href={`${base}/prompts`} label="Prompts" count={summary.promptCount} />
          <NavLink href={`${base}/settings`} label="Settings" />
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
