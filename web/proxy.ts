import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Everything under (app) is private EXCEPT the matcher, which is usable as a guest.
const isProtected = createRouteMatcher([
  "/applications(.*)",
  "/network(.*)",
  "/outreach(.*)",
  "/compare(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
