export interface Session {
  userId: string;
  /**
   * The user's JWT, when there is one.
   *
   * Reads are made with this rather than with the service-role key, so
   * row-level security applies to them. That is the difference between "the
   * application filters correctly" and "the database will not return another
   * tenant's rows even if the application asks for them".
   */
  accessToken: string | null;
}

/**
 * Where a signed-in user comes from.
 *
 * **This is the seam to replace when porting into an existing product.** The
 * Supabase implementation is here because this app has no auth of its own; a
 * product that already knows who is signed in should implement this against its
 * own session and change nothing else.
 */
export interface SessionSource {
  resolve(request: { headers: Headers }): Promise<Session | null>;
}
