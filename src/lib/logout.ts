"use client";

import { signOut } from "next-auth/react";

/**
 * Deterministic sign-out: end the session, hard-replace to the landing page
 * so back-navigation can't re-enter the app and all state resets.
 */
export function signOutToLanding() {
  void signOut({ redirect: false }).finally(() => {
    try {
      window.history.replaceState(null, "", "/");
      window.scrollTo({ top: 0 });
    } catch {
      /* noop */
    }
    window.location.replace("/");
  });
}
