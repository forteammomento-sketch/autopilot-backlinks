'use server';

import { revalidatePath } from 'next/cache';
import { projectContext } from '@/lib/auth/project';

export async function chooseProperty(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  const ctx = await projectContext(project);
  if (ctx === null) return;

  await ctx.mutations.chooseProperty(String(formData.get('siteUrl')));
  revalidatePath(`/p/${project}/settings`);
}

/**
 * Disconnecting deletes the stored credential outright rather than marking it
 * inactive. A refresh token nobody intends to use is still a working key to
 * someone's Search Console, and keeping one around "in case they reconnect"
 * trades a small convenience for a permanent liability.
 */
export async function disconnectGoogle(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  const ctx = await projectContext(project);
  if (ctx === null) return;

  await ctx.mutations.disconnectGoogle();
  revalidatePath(`/p/${project}/settings`);
}
