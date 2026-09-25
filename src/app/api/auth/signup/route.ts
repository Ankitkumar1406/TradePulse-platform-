import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { emailIssue, nameIssue, parsePhone, phoneIssue, passwordIssue } from "@/lib/validation";
import { TRIAL_DAYS } from "@/lib/pricing";

/**
 * Signup: name, phone number and email id are ALL mandatory, plus a password.
 * Phone must be a valid 10-digit Indian mobile; it is normalized before store.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string; email?: string; phone?: string; password?: string;
  };

  const errors: { name?: string; email?: string; phone?: string; password?: string } = {};
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const phoneRaw = (body.phone ?? "").trim();
  const password = body.password ?? "";

  const nErr = nameIssue(name);
  if (nErr) errors.name = nErr;
  const eErr = emailIssue(email);
  if (eErr) errors.email = eErr;
  const pErr = phoneIssue(phoneRaw);
  if (pErr) errors.phone = pErr;
  const pwErr = passwordIssue(password);
  if (pwErr) errors.password = pwErr;

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: Object.values(errors)[0], errors }, { status: 422 });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists", errors: { email: "Already registered — sign in instead" } },
      { status: 409 }
    );
  }

  const phone = parsePhone(phoneRaw) as string;
  const user = await db.user.create({
    data: {
      email,
      name,
      phone,
      passwordHash: hashPassword(password),
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000),
    },
  });

  return NextResponse.json({ ok: true, id: user.id }, { status: 201 });
}
