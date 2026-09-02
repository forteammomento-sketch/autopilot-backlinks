/**
 * A hard ceiling on engine calls for one job run.
 *
 * A full run is prompts x engines x repeats — 60 x 5 x 3 is 900 paid calls. A
 * loop that misbehaves, a prompt set someone pasted 400 rows into, or a
 * scheduler that fires twice all turn into a bill before they turn into an
 * error. The budget makes overspending impossible rather than unlikely, and it
 * stops cleanly so whatever was measured before the ceiling is still recorded.
 */
export class CallBudget {
  readonly limit: number;
  #spent = 0;

  constructor(limit: number) {
    if (!Number.isFinite(limit) || limit < 0) {
      throw new RangeError('budget limit must be a non-negative number');
    }
    this.limit = limit;
  }

  get spent(): number {
    return this.#spent;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.#spent);
  }

  get exhausted(): boolean {
    return this.#spent >= this.limit;
  }

  /** Reserve `n` calls. Returns false when the ceiling would be crossed. */
  take(n = 1): boolean {
    if (this.#spent + n > this.limit) return false;
    this.#spent += n;
    return true;
  }
}
