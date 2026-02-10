import { NextRequest, NextResponse } from "next/server";
import { getCharacters, addCharacter, updateCharacter, uploadCharacterImage, deleteCharacterImage, deleteCharacter } from "@/lib/characters";
import { requireAuth, AuthError } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    const characters = await getCharacters(userId, companyId);
    return NextResponse.json({ characters });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Failed to load characters" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { companyId, name, description } = body as { companyId?: string; name?: string; description?: string };

    if (!companyId || !name?.trim()) {
      return NextResponse.json({ error: "companyId and name are required" }, { status: 400 });
    }

    const character = await addCharacter(userId, companyId, name.trim(), description?.trim() || "");
    return NextResponse.json(character);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Failed to add character" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { companyId, characterId, name, description, image } = body as {
      companyId?: string;
      characterId?: string;
      name?: string;
      description?: string;
      image?: string; // base64 data URL or "" to remove
    };

    if (!companyId || !characterId) {
      return NextResponse.json({ error: "companyId and characterId are required" }, { status: 400 });
    }

    // Handle image upload/removal
    if (image !== undefined) {
      if (image === "") {
        await deleteCharacterImage(userId, companyId, characterId);
      } else {
        // Validate size (max ~5MB base64)
        if (image.length > 7_000_000) {
          return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 400 });
        }
        await uploadCharacterImage(userId, companyId, characterId, image);
      }
    }

    // Handle text field updates
    const textUpdates: { name?: string; description?: string } = {};
    if (name !== undefined) textUpdates.name = name;
    if (description !== undefined) textUpdates.description = description;

    if (Object.keys(textUpdates).length > 0) {
      const updated = await updateCharacter(userId, companyId, characterId, textUpdates);
      if (!updated) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }
      return NextResponse.json(updated);
    }

    // If only image was changed, re-fetch the character
    const characters = await getCharacters(userId, companyId);
    const char = characters.find((c) => c.id === characterId);
    if (!char) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    return NextResponse.json(char);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Failed to update character" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const characterId = searchParams.get("characterId");

    if (!companyId || !characterId) {
      return NextResponse.json({ error: "companyId and characterId are required" }, { status: 400 });
    }

    const removed = await deleteCharacter(userId, companyId, characterId);
    if (!removed) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Failed to delete character" }, { status: 500 });
  }
}
