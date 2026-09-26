import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_SCREENS = 30;
const MAX_NAME = 60;
const MAX_DEFINITION = 16384; // serialized JSON budget — 50 condition rows incl. pro expressions

/** List the signed-in user's saved screens (newest first). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const screens = await db.savedScreen.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: MAX_SCREENS,
  });
  return NextResponse.json({ screens });
}

/** Save a screen. Body: { name, kind: "filters" | "conditions" | "multi", definition }.
 *  kind="filters" snapshots a Quick-filters view (search text, sector, sort, direction). */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: unknown; kind?: unknown; definition?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME) : "";
  const kind =
    typeof body.kind === "string" && ["filters", "conditions", "multi"].includes(body.kind)
      ? body.kind
      : "";
  if (!name) return NextResponse.json({ error: "Give the screen a name" }, { status: 400 });
  if (!kind) return NextResponse.json({ error: "Unknown screen kind" }, { status: 400 });

  let definition: string;
  try {
    definition = JSON.stringify(body.definition);
  } catch {
    return NextResponse.json({ error: "Definition must be JSON-serializable" }, { status: 400 });
  }
  if (definition.length > MAX_DEFINITION) {
    return NextResponse.json({ error: "Screen definition too large" }, { status: 400 });
  }

  const count = await db.savedScreen.count({ where: { userId: session.user.id } });
  if (count >= MAX_SCREENS) {
    return NextResponse.json(
      { error: `Saved-screen limit reached (${MAX_SCREENS}) — delete one first` },
      { status: 400 }
    );
  }

  const screen = await db.savedScreen.create({
    data: { userId: session.user.id, name, kind, definition },
  });
  return NextResponse.json({ screen });
}

/** Update a saved screen (rename and/or replace its definition).
 *  Body: { id, name?, definition? } — both optional, at least one required. */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { id?: unknown; name?: unknown; definition?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const existing = await db.savedScreen.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Screen not found" }, { status: 404 });
  }

  const data: { name?: string; definition?: string } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME) : "";
    if (!name) return NextResponse.json({ error: "Give the screen a name" }, { status: 400 });
    data.name = name;
  }
  if (body.definition !== undefined) {
    let definition: string;
    try {
      definition = JSON.stringify(body.definition);
    } catch {
      return NextResponse.json({ error: "Definition must be JSON-serializable" }, { status: 400 });
    }
    if (definition.length > MAX_DEFINITION) {
      return NextResponse.json({ error: "Screen definition too large" }, { status: 400 });
    }
    data.definition = definition;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const screen = await db.savedScreen.update({ where: { id }, data });
  return NextResponse.json({ screen });
}

/** Delete a screen. Query: ?id=<screenId> (must belong to the caller). */
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const existing = await db.savedScreen.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Screen not found" }, { status: 404 });
  }
  await db.savedScreen.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
