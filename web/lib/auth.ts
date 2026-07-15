import { auth } from "@clerk/nextjs/server";

/** Thrown by requireUserId when no user is signed in. API routes map this to 401. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Authentication required.");
    this.name = "UnauthorizedError";
  }
}

/** The Clerk user id of the signed-in user, or null for guests. */
export async function getUserIdOrNull(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/** The Clerk user id, or throws UnauthorizedError. Use in routes that require sign-in. */
export async function requireUserId(): Promise<string> {
  const userId = await getUserIdOrNull();
  if (!userId) throw new UnauthorizedError();
  return userId;
}
