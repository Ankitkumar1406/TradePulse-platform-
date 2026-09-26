import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { emailIssue } from "@/lib/validation";
import { TRIAL_DAYS } from "@/lib/pricing";

export interface EffectiveTier {
  tier: "pro" | "basic";
  source: "paid" | "trial" | "basic";
}

/** Paid Pro > active 15-day trial > Basic. */
export function effectiveTier(user: {
  plan: string;
  planExpiresAt: Date | null;
  trialEndsAt: Date | null;
}): EffectiveTier {
  const now = Date.now();
  if (user.plan === "pro" && user.planExpiresAt && user.planExpiresAt.getTime() > now) {
    return { tier: "pro", source: "paid" };
  }
  if (user.trialEndsAt && user.trialEndsAt.getTime() > now) {
    return { tier: "pro", source: "trial" };
  }
  return { tier: "basic", source: "basic" };
}

/** One-tap demo account (fresh databases get it on first use). */
export const DEMO_EMAIL = "aarav@tradepulse.demo";

export async function ensureDemoUser() {
  const existing = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) return existing;
  return db.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Aarav",
      phone: "9876543210",
      passwordHash: null,
      onboarded: true,
      experience: "intermediate",
      interests: "Swing trading,Breakouts,Market breadth",
      trialEndsAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    },
  });
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET ?? "tradepulse-dev-secret",
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  pages: { signIn: "/" },
  providers: [
    CredentialsProvider({
      name: "Email & password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        demo: { label: "Demo", type: "text" },
      },
      async authorize(credentials) {
        // One-tap demo login
        if (credentials?.demo === "1") {
          const demo = await ensureDemoUser();
          return {
            id: demo.id, name: demo.name, email: demo.email, image: demo.image,
          };
        }
        const email = (credentials?.email ?? "").trim().toLowerCase();
        const password = credentials?.password ?? "";
        if (emailIssue(email) || !password) return null;
        const user = await db.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) return null;
        if (!verifyPassword(password, user.passwordHash)) return null;
        return { id: user.id, name: user.name, email: user.email, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user?.id) token.sub = user.id;
      if (trigger === "update" && token.sub) {
        const fresh = await db.user.findUnique({ where: { id: token.sub as string } });
        if (fresh) token.name = fresh.name;
      }
      return token;
    },
    async session({ session, token }) {
      let user = token?.sub ? await db.user.findUnique({ where: { id: token.sub } }) : null;
      if (!user && session.user?.email) {
        user = await db.user.findUnique({ where: { email: session.user.email.toLowerCase() } });
      }
      if (user && session.user) {
        const tier = effectiveTier(user);
        session.user.id = user.id;
        session.user.name = user.name;
        session.user.plan = user.plan;
        session.user.isPro = tier.tier === "pro";
        session.user.proSource = tier.source;
        session.user.onboarded = user.onboarded;
        session.user.autoRenew = user.autoRenew;
        session.user.trialEndsAt = user.trialEndsAt ? user.trialEndsAt.toISOString() : null;
        session.user.planExpiresAt = user.planExpiresAt ? user.planExpiresAt.toISOString() : null;
        session.user.phone = user.phone;
      }
      return session;
    },
  },
};
