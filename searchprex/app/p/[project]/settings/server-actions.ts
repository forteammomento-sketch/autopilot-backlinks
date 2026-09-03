'use server';

import { revalidatePath } from 'next/cache';
import { mutations } from '@/lib/data/index';

export async function chooseProperty(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  await mutations.chooseProperty(project, String(formData.get('siteUrl')));
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
  await mutations.disconnectGoogle(project);
  revalidatePath(`/p/${project}/settings`);
}
