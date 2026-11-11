"use client";

import { useMemo } from "react";
import { useQueries, type RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

type FrameMarks = FunctionReturnType<typeof api.frameMarks.listFrameMarks>;

/**
 * The owner's private marks for every grid: super-liked frames and frames
 * with a comment (convex/frameMarks.ts). Read with useQueries so a failed
 * read (a backend that does not have the function yet, a push from an older
 * branch) leaves the marks off instead of taking the page down.
 */
export function useFrameMarks(ownerUserId: string | undefined): FrameMarks | undefined {
  const queries = useMemo(() => {
    const request: RequestForQueries = {};
    if (ownerUserId) request.marks = { query: api.frameMarks.listFrameMarks, args: { ownerUserId } };
    return request;
  }, [ownerUserId]);
  const result: unknown = useQueries(queries).marks;
  return result instanceof Error ? undefined : (result as FrameMarks | undefined);
}
