'use server';

import { revalidatePath } from 'next/cache';
import { mutations } from '@/lib/data/index';
import type { DeployOutcome, RollbackOutcome } from '@/lib/data/types';

/**
 * Approving and deploying are two steps on purpose.
 *
 * Approving records that a human read the artifact and wants it. Deploying
 * opens a pull request against a production site. Collapsing them into one
 * click would mean a stray tap ships generated copy — and the entire argument
 * for a draft PR is that a person sees the diff first.
 */
export async function approveAction(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  await mutations.approve(project, id);
  revalidatePath(`/p/${project}/actions`);
}

export async function unapproveAction(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  await mutations.unapprove(project, id);
  revalidatePath(`/p/${project}/actions`);
}

export async function rejectAction(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  await mutations.reject(project, id);
  revalidatePath(`/p/${project}/actions`);
}

export async function deployApproved(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  const outcome = await mutations.deployApproved(project);
  lastOutcome.set(project, outcome);
  revalidatePath(`/p/${project}/actions`);
}

/**
 * Rolling back opens a revert pull request. It is behind a two-click confirm in
 * the UI for the same reason deploying is a separate button from approving:
 * both write to a production repository, and neither should be one stray tap
 * away.
 */
export async function rollbackAction(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  const outcome = await mutations.rollback(project, id);
  lastRollback.set(project, outcome);
  revalidatePath(`/p/${project}/actions`);
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
