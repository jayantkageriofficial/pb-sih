import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "../../../../lib/middleware/auth";
import { Team } from "../../../../models/Team";
import dbConnect from "../../../../lib/mongodb";
import {
  areResultsPublished,
  getLeaderVisibleTeamStatus,
} from "../../../../lib/resultsVisibility";

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

    // Check if user is a team leader
    if (user.role !== "leader") {
      return NextResponse.json(
        { success: false, error: "Only team leaders can access team details" },
        { status: 403 }
      );
    }

    // Find team registered by this leader with full details
    const team = await Team.findOne({ leader: user._id })
      .populate("problemStatement", "title code description")
      .populate("leader", "name email phone branch year gender college")
      .lean();

    if (!team) {
      return NextResponse.json({
        success: true,
        isRegistered: false,
        message: "No team registered yet. You can create a new team.",
        team: null,
      });
    }

    const resultsPublished = await areResultsPublished();

    // Return complete team details
    return NextResponse.json({
      success: true,
      isRegistered: true,
      message: `Your team "${team.teamName}" is registered`,
      team: {
        _id: team._id,
        teamName: team.teamName,
        leader: team.leader,
        members: team.members,
        problemStatement: team.problemStatement,
        status: getLeaderVisibleTeamStatus(team.status, resultsPublished),
        resultsPublished,
        registrationDate: team.registrationDate,
        tasks: team.tasks || [],
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      },
    });
  } catch (error: unknown) {
    console.error("Team details fetch error:", error);

    if ((error as Error).message === "Authentication failed") {
      return NextResponse.json(
        { success: false, error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to fetch team details" },
      { status: 500 }
    );
  }
}
