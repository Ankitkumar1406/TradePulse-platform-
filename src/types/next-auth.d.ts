import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user?: {
      id: string;
      plan: string;
      isPro: boolean;
      proSource: "paid" | "trial" | "basic";
      onboarded: boolean;
      autoRenew: boolean;
      trialEndsAt: string | null;
      planExpiresAt: string | null;
      phone: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub?: string;
  }
}
