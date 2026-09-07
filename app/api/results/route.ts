import { NextRequest, NextResponse } from "next/server";
import dbConnect from "../../../lib/mongodb";
import { areResultsPublished } from "../../../lib/resultsVisibility";
import { Team } from "../../../models/Team";

// Import models to ensure they are registered with Mongoose
import "../../../models/User";
import "../../../models/ProblemStatement";

export async function GET(request: NextRequest) {
  try {
    await dbConnect();

    const published = await areResultsPublished();
    if (!published) {
      return NextResponse.json(
        {
          success: true,
          published: false,
          teams: [],
          selectedTeams: [],
          waitlistedTeams: [],
          teamsByPS: {},
          statistics: {
            totalSelectedTeams: 0,
            totalWaitlistedTeams: 0,
            totalTeams: 0,
            uniqueProblemStatements: 0,
          },
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");

    // If status is provided, use it; otherwise fetch both selected and waitlisted
    const statusFilter = statusParam || ["selected", "waitlisted"];

    // Build aggregation pipeline to get teams with populated data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipeline: any[] = [
      // Match teams with the specified status (either single or multiple)
      {
        $match: {
          status: Array.isArray(statusFilter)
            ? { $in: statusFilter }
            : statusFilter,
        },
      },

      // Lookup leader data
      {
        $lookup: {
          from: "users",
          localField: "leader",
          foreignField: "_id",
          as: "leader",
        },
      },
      { $unwind: "$leader" },

      // Lookup problem statement data
      {
        $lookup: {
          from: "problemstatements",
          localField: "problemStatement",
          foreignField: "_id",
          as: "problemStatement",
        },
      },
      { $unwind: "$problemStatement" },

      // Sort by registration date (most recent first)
      { $sort: { registrationDate: -1 } },

      // Project only necessary fields
      {
        $project: {
          _id: 1,
          teamName: 1,
          status: 1,
          registrationDate: 1,
          createdAt: 1,
          updatedAt: 1,
          memberCount: { $size: "$members" },
          "leader.name": 1,
          "leader.email": 1,
          "problemStatement.psNumber": 1,
          "problemStatement.title": 1,
          "problemStatement.description": 1,
          "problemStatement.domain": 1,
        },
      },
    ];

    // Execute aggregation
    const teams = await Team.aggregate(pipeline);

    // Separate teams by status
    const selectedTeams = teams.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (team: any) => team.status === "selected"
    );
    const waitlistedTeams = teams.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (team: any) => team.status === "waitlisted"
    );

    // Group teams by problem statement for better organization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const teamsByPS = teams.reduce((acc: any, team: any) => {
      const psNumber = team.problemStatement.psNumber;
      if (!acc[psNumber]) {
        acc[psNumber] = {
          problemStatement: team.problemStatement,
          teams: [],
        };
      }
      acc[psNumber].teams.push(team);
      return acc;
    }, {});

    return NextResponse.json({
      success: true,
      published: true,
      teams,
      selectedTeams,
      waitlistedTeams,
      teamsByPS,
      statistics: {
        totalSelectedTeams: selectedTeams.length,
        totalWaitlistedTeams: waitlistedTeams.length,
        totalTeams: teams.length,
        uniqueProblemStatements: Object.keys(teamsByPS).length,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    console.error("Get results error:", error);

    return NextResponse.json(
      { success: false, error: "Failed to fetch results" },
      { status: 500 }
    );
  }
}
