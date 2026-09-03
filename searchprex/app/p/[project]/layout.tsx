import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { projectContext } from '@/lib/auth/project';
import { NavLink } from '@/lib/ui/nav-link';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  // Resolves the slug and verifies access in one query, through the user's own
  // rights. A project they may not have is indistinguishable from one that does
  // not exist, which is the right answer to both.
  const ctx = await projectContext(project);
  if (ctx === null) notFound();

  const summary = await ctx.data.project();
  if (summary === null) notFound();

  const [actions, refusals, placements] = await Promise.all([
    ctx.data.actions(),
    ctx.data.refusals(),
    ctx.data.placements(),
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
