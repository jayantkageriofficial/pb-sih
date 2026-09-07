import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { verifySuperAdminAuth } from "@/lib/middleware/adminAuth";
import { SystemSettings } from "@/models/SystemSettings";

const SETTINGS_KEY = "global";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const forbidden = message === "Super admin access required";

  return NextResponse.json(
    {
      success: false,
      error: forbidden ? "Super admin access required" : "Authentication required",
    },
    { status: forbidden ? 403 : 401, headers: NO_STORE_HEADERS }
  );
}

export async function GET(request: NextRequest) {
  try {
    await verifySuperAdminAuth(request);
  } catch (error) {
    return authErrorResponse(error);
  }

  try {
    await dbConnect();

    const settings = await SystemSettings.findOne({ key: SETTINGS_KEY })
      .select("resultsPublished resultsPublishedAt updatedAt")
      .lean();

    return NextResponse.json(
      {
        success: true,
        resultsPublished: settings?.resultsPublished === true,
        resultsPublishedAt: settings?.resultsPublishedAt ?? null,
        updatedAt: settings?.updatedAt ?? null,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("Get results visibility error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get results visibility" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function PATCH(request: NextRequest) {
  let authenticatedRequest;

  try {
    authenticatedRequest = await verifySuperAdminAuth(request);
  } catch (error) {
    return authErrorResponse(error);
  }

  try {
    const body: unknown = await request.json();
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof (body as Record<string, unknown>).resultsPublished !== "boolean"
    ) {
      return NextResponse.json(
        { success: false, error: "resultsPublished must be a boolean" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const resultsPublished = (body as { resultsPublished: boolean })
      .resultsPublished;

    await dbConnect();

    const settings = await SystemSettings.findOneAndUpdate(
      { key: SETTINGS_KEY },
      {
        $set: {
          resultsPublished,
          resultsPublishedAt: resultsPublished ? new Date() : null,
          resultsPublishedBy: authenticatedRequest.admin?._id ?? null,
        },
        $setOnInsert: { key: SETTINGS_KEY },
      },
      { new: true, upsert: true, runValidators: true }
    )
      .select("resultsPublished resultsPublishedAt updatedAt")
      .lean();

    return NextResponse.json(
      {
        success: true,
        resultsPublished: settings.resultsPublished,
        resultsPublishedAt: settings.resultsPublishedAt,
        updatedAt: settings.updatedAt,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("Update results visibility error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update results visibility" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
