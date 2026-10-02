import { ConvexError } from "convex/values";

// What an API route may tell its caller about a failure. A ConvexError is a
// message the backend wrote for the caller, so its text passes through. Any
// other error from Convex arrives as "[Request ID: …] Server Error" plus a
// server stack trace; that stays in the server log and the caller gets the
// fallback.
export const clientErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "string" && data.trim()) return data;
    if (
      data &&
      typeof data === "object" &&
      typeof (data as { message?: unknown }).message === "string"
    ) {
      return (data as { message: string }).message;
    }
    return fallback;
  }
  if (error instanceof Error && error.message && !error.message.startsWith("[Request ID")) {
    return error.message;
  }
  console.error(error);
  return fallback;
};
