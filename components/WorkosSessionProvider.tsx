"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";

export interface WorkosUser {
  workosUserId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

interface WorkosSessionContextValue {
  user: WorkosUser | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const WorkosSessionContext = createContext<WorkosSessionContextValue>({
  user: null,
  isLoading: false,
  signOut: async () => {},
});

export function useWorkosSession() {
  return useContext(WorkosSessionContext);
}

/**
 * Bridges the WorkOS AuthKit useAuth() hook into a simple context.
 * Only rendered inside AuthKitProvider when WorkOS is configured.
 */
export function WorkosSessionBridge({ children }: { children: ReactNode }) {
  const { user: workosUser, loading, signOut } = useAuth();

  const user: WorkosUser | null = workosUser
    ? {
        workosUserId: workosUser.id,
        email: workosUser.email ?? undefined,
        firstName: workosUser.firstName ?? undefined,
        lastName: workosUser.lastName ?? undefined,
      }
    : null;

  return (
    <WorkosSessionContext.Provider value={{ user, isLoading: loading, signOut }}>
      {children}
    </WorkosSessionContext.Provider>
  );
}

/**
 * No-op provider used when WorkOS is not configured.
 */
export function WorkosSessionNoop({ children }: { children: ReactNode }) {
  return (
    <WorkosSessionContext.Provider
      value={{ user: null, isLoading: false, signOut: async () => {} }}
    >
      {children}
    </WorkosSessionContext.Provider>
  );
}
