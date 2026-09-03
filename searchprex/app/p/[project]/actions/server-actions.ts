'use server';

import { revalidatePath } from 'next/cache';
import { projectContext } from '@/lib/auth/project';
import type { DeployOutcome, RollbackOutcome } from '@/lib/data/types';

/**
 * Every action resolves the project through `projectContext` before touching
 * anything.
 *
 * The project slug arrives in the form body, which the browser controls. A
 * server action that trusted it would let anyone who can reach this endpoint
 * approve and deploy content into a project that is not theirs. Resolving it
 * turns that string into a project the *signed-in user* can see, or into
 * nothing.
 */
async function bind(formData: FormData) {
  const project = String(formData.get('project'));
  const ctx = await projectContext(project);
  return ctx === null ? null : { ctx, project };
}

/**
 * Approving and deploying are two steps on purpose.
 *
 * Approving records that a human read the artifact and wants it. Deploying
 * opens a pull request against a production site. Collapsing them into one
 * click would mean a stray tap ships generated copy — and the entire argument
 * for a draft PR is that a person sees the diff first.
 */
export async function approveAction(formData: FormData): Promise<void> {
  const bound = await bind(formData);
  if (bound === null) return;
  await bound.ctx.mutations.approve(String(formData.get('id')));
  revalidatePath(`/p/${bound.project}/actions`);
}

export async function unapproveAction(formData: FormData): Promise<void> {
  const bound = await bind(formData);
  if (bound === null) return;
  await bound.ctx.mutations.unapprove(String(formData.get('id')));
  revalidatePath(`/p/${bound.project}/actions`);
}

export async function rejectAction(formData: FormData): Promise<void> {
  const bound = await bind(formData);
  if (bound === null) return;
  await bound.ctx.mutations.reject(String(formData.get('id')));
  revalidatePath(`/p/${bound.project}/actions`);
}

export async function deployApproved(formData: FormData): Promise<void> {
  const bound = await bind(formData);
  if (bound === null) return;
  lastOutcome.set(bound.project, await bound.ctx.mutations.deployApproved());
  revalidatePath(`/p/${bound.project}/actions`);
}

/**
 * Rolling back opens a revert pull request. It is behind a two-click confirm in
 * the UI for the same reason deploying is a separate button from approving:
 * both write to a production repository, and neither should be one stray tap
 * away.
 */
export async function rollbackAction(formData: FormData): Promise<void> {
  const bound = await bind(formData);
  if (bound === null) return;
  const outcome = await bound.ctx.mutations.rollback(String(formData.get('id')));
  lastRollback.set(bound.project, outcome);
  revalidatePath(`/p/${bound.project}/actions`);
}

export async function readLastRollback(project: string): Promise<RollbackOutcome | null> {
  return lastRollback.get(project) ?? null;
}

export async function clearLastRollback(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  lastRollback.delete(project);
  revalidatePath(`/p/${project}/actions`);
}

const lastRollback = new Map<string, RollbackOutcome>();

/**
 * The most recent deploy result, so the page can report what happened.
 *
 * In-process and per-project. A durable record of the deploy already lives in
 * the `deployments` table with its rollback snapshot — this is only the banner.
 */
const lastOutcome = new Map<string, DeployOutcome>();

export async function readLastOutcome(project: string): Promise<DeployOutcome | null> {
  return lastOutcome.get(project) ?? null;
}

export async function clearLastOutcome(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  lastOutcome.delete(project);
  revalidatePath(`/p/${project}/actions`);
}
