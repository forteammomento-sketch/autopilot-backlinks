'use server';

import { revalidatePath } from 'next/cache';
import { mutations } from '@/lib/data/index';
import type { PromptGenerationOutcome } from '@/lib/data/types';

/**
 * Generating crawls the site and calls a model, so it is a button someone
 * presses at setup rather than anything on a schedule. The result is shown for
 * review: the prompt set is the largest recurring cost in the product, and a
 * person should see what it will cost before it starts being measured weekly.
 */
export async function generatePromptsAction(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  lastGeneration.set(project, await mutations.generatePrompts(project));
  revalidatePath(`/p/${project}/prompts`);
}

export async function readLastGeneration(
  project: string,
): Promise<PromptGenerationOutcome | null> {
  return lastGeneration.get(project) ?? null;
}

export async function clearLastGeneration(formData: FormData): Promise<void> {
  const project = String(formData.get('project'));
  lastGeneration.delete(project);
  revalidatePath(`/p/${project}/prompts`);
}

const lastGeneration = new Map<string, PromptGenerationOutcome>();
