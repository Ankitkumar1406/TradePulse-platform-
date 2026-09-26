import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePhone, phoneIssue } from "@/lib/validation";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true, phone: true, city: true, experience: true, interests: true, onboarded: true, email: true,
    },
  });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(user);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: string; phone?: string; city?: string; experience?: string; interests?: string[];
  };

  const errors: { name?: string; phone?: string } = {};
  const name = (body.name ?? "").trim();
  if (name.length < 2) errors.name = "Name is required";
  const phoneErr = phoneIssue(body.phone ?? "");
  if (phoneErr) errors.phone = phoneErr;
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: Object.values(errors)[0], errors }, { status: 422 });
  }

  const experience = ["beginner", "intermediate", "advanced"].includes(body.experience ?? "")
    ? (body.experience as string)
    : "beginner";
  const interests = Array.isArray(body.interests) ? body.interests.filter((i) => typeof i === "string").slice(0, 8).join(",") : null;

  await db.user.update({
    where: { id: session.user.id },
    data: {
      name,
      phone: parsePhone(body.phone ?? ""),
      city: (body.city ?? "").trim().slice(0, 80) || null,
      experience,
      interests,
      onboarded: true,
    },
  });

  return NextResponse.json({ ok: true });
}
