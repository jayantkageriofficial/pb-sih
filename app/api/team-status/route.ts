import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "../../../lib/middleware/auth";
import { Team } from "../../../models/Team";
import dbConnect from "../../../lib/mongodb";
import {
  areResultsPublished,
  getLeaderVisibleTeamStatus,
} from "../../../lib/resultsVisibility";

export async function GET(request: NextRequest) {
  try {
    await dbConnect();

    // Authenticate user
    const authenticatedRequest = await verifyAuth(request);
    const user = authenticatedRequest.user;

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    // Check if user is a team leader (only leaders can register teams)
    if (user.role !== "leader") {
      return NextResponse.json(
        {
          success: false,
          error: "Only team leaders can check team registration status",
        },
        { status: 403 }
      );
    }

    // Find team registered by this leader
    const existingTeam = await Team.findOne({ leader: user._id })
      .populate("problemStatement", "title code")
      .lean();

    if (existingTeam) {
      const resultsPublished = await areResultsPublished();

      // Team exists - return team details
      return NextResponse.json({
        success: true,
        isRegistered: true,
        message: `Your team "${existingTeam.teamName}" is already registered`,
        team: {
          _id: existingTeam._id,
          teamName: existingTeam.teamName,
          status: getLeaderVisibleTeamStatus(
            existingTeam.status,
            resultsPublished
          ),
          resultsPublished,
          registrationDate: existingTeam.registrationDate,
          memberCount: existingTeam.members.length,
          problemStatement: existingTeam.problemStatement,
        },
      });
    } else {
      // No team registered yet
      return NextResponse.json({
        success: true,
        isRegistered: false,
        message: "No team registered yet. You can create a new team.",
        team: null,
      });
    }
  } catch (error: unknown) {
    console.error("Team registration check error:", error);

    if ((error as Error).message === "Authentication failed") {
      return NextResponse.json(
        { success: false, error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to check team registration status" },
      { status: 500 }
    );
  }
}
