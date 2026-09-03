'use client';

import { useFormStatus } from 'react-dom';

/**
 * A submit button that says it is working.
 *
 * Without this there is a window between the click and the server action
 * committing where nothing on the page changes, and the natural response to
 * that is to click again. The status transitions are guarded server-side, so a
 * double submit is safe rather than destructive — but "safe" is not the same as
 * "the person knows what happened", and on a deploy in particular they should
 * never be left wondering whether they just opened two pull requests.
 */
export function SubmitButton({
  children,
  className = 'btn',
  pendingLabel,
  disabled = false,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" disabled={pending || disabled} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
