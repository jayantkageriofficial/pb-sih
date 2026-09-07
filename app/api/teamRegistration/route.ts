import { NextRequest, NextResponse, after } from "next/server";
import { verifyAuth } from "../../../lib/middleware/auth";
import { verifyAdminAuth } from "../../../lib/middleware/adminAuth";
import { Team, ITeamMember } from "../../../models/Team";
import { ProblemStatement } from "../../../models/ProblemStatement";
import { User } from "../../../models/User";
import dbConnect from "../../../lib/mongodb";
import {
  areResultsPublished,
  getLeaderVisibleTeamStatus,
} from "../../../lib/resultsVisibility";
import {
  validateTeamRegistration,
  validateTeamMember,
  validateCrossTeamDuplicates,
  escapeRegex,
  isValidObjectId,
  sanitizeSingleLineText,
  sanitizeTeamMemberInput,
} from "../../../lib/utils/validation";
import { sendTeamRegistrationEmail } from "../../../lib/utils/email";
import mongoose from "mongoose";
import {
  formatRegistrationStartAt,
  getRegistrationStartAt,
  isRegistrationOpen,
} from "../../../lib/registration";

export async function POST(request: NextRequest) {
  try {
    if (!isRegistrationOpen()) {
      return NextResponse.json(
        {
          success: false,
          error: `Registration opens at ${formatRegistrationStartAt()}`,
          registrationStartAt: getRegistrationStartAt(),
        },
        { status: 403 }
      );
    }

    await dbConnect();

    // Check if user is currently logged in as admin
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Basic ")) {
      try {
        const adminRequest = await verifyAdminAuth(request);
        if (adminRequest.admin) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Please logout as admin first to register as a team member",
              isAdmin: true,
              adminEmail: adminRequest.admin.email,
            },
            { status: 403 }
          );
        }
      } catch (error) {
        // Admin auth failed, but continue with normal team registration
        console.log("Admin auth check failed:", (error as Error).message);
      }
    }

    // Authenticate user with Firebase (for team registration)
    const authenticatedRequest = await verifyAuth(request);
    const user = authenticatedRequest.user;

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    await dbConnect();

    // Check if user already has a team
    const existingTeam = await Team.findOne({ leader: user._id });
    if (existingTeam) {
      return NextResponse.json(
        { success: false, error: "You have already registered a team" },
        { status: 400 }
      );
    }

    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid registration payload" },
        { status: 400 }
      );
    }

    const rawBody = body as Record<string, unknown>;
    const teamName = sanitizeSingleLineText(rawBody.teamName, 10000);
    const problemStatement =
      typeof rawBody.problemStatement === "string"
        ? rawBody.problemStatement.trim()
        : "";
    const sanitizedLeader = rawBody.teamLeader
      ? sanitizeTeamMemberInput(rawBody.teamLeader)
      : undefined;
    const teamLeader = sanitizedLeader
      ? {
          ...sanitizedLeader,
          college:
            sanitizedLeader.college ||
            "Dayananda Sagar College of Engineering",
        }
      : undefined;
    const rawMembers = Array.isArray(rawBody.members) ? rawBody.members : [];

    // Validate team leader data if provided
    if (teamLeader) {
      const leaderErrors = validateTeamMember(
        {
          name: teamLeader.name,
          email: teamLeader.email,
          phone: teamLeader.phone,
          college:
            teamLeader.college || "Dayananda Sagar College of Engineering",
          year: teamLeader.year,
          branch: teamLeader.branch,
          gender: teamLeader.gender?.toLowerCase() as
            | "male"
            | "female"
            | "other",
        },
        0 // Use 0 to indicate leader
      );

      if (leaderErrors.length > 0) {
        const formattedErrors = leaderErrors.map((error: string) =>
          error.replace("Member 0:", "Team Leader:")
        );
        return NextResponse.json(
          {
            success: false,
            errors: formattedErrors,
            error: "Team leader validation failed",
          },
          { status: 400 }
        );
      }
    }

    // Prepare team members array (should contain exactly 5 members, excluding leader)
    const teamMembers: ITeamMember[] = [];

    // Add other members (should be exactly 5 members)
    // Keep an extra item so validation rejects payloads with more than five
    // members instead of silently dropping attacker-controlled input.
    rawMembers.slice(0, 6).forEach((member) => {
      const sanitizedMember = sanitizeTeamMemberInput(member);
      teamMembers.push({
        ...sanitizedMember,
        college:
          sanitizedMember.college || "Dayananda Sagar College of Engineering",
      });
    });

    // Check for duplicate emails between leader and members
    if (teamLeader && teamMembers.length > 0) {
      const leaderEmail = teamLeader.email.toLowerCase();
      const memberEmails = teamMembers.map((m) => m.email.toLowerCase());

      if (memberEmails.includes(leaderEmail)) {
        return NextResponse.json(
          {
            success: false,
            errors: [
              "Team leader and members must have unique email addresses",
            ],
            error: "Duplicate email validation failed",
          },
          { status: 400 }
        );
      }
    }

    // Validate input data
    const validation = validateTeamRegistration({
      teamName,
      problemStatement,
      members: teamMembers,
      teamLeader: teamLeader ? { gender: teamLeader.gender } : undefined,
    });

    if (!validation.isValid) {
      return NextResponse.json(
        {
          success: false,
          errors: validation.errors,
          error: "Validation failed",
        },
        { status: 400 }
      );
    }

    if (!isValidObjectId(problemStatement)) {
      return NextResponse.json(
        { success: false, error: "Invalid problem statement" },
        { status: 400 }
      );
    }

    // Check if team name is unique
    const existingTeamName = await Team.findOne({
      teamName: {
        $regex: new RegExp(`^${escapeRegex(teamName.trim())}$`, "i"),
      },
    });
    if (existingTeamName) {
      return NextResponse.json(
        { success: false, error: "Team name already exists" },
        { status: 400 }
      );
    }

    // ✨ NEW: Check for cross-team duplicate emails and phone numbers
    const crossTeamValidation = await validateCrossTeamDuplicates({
      teamLeader: teamLeader
        ? {
            email: teamLeader.email,
            phone: teamLeader.phone,
          }
        : undefined,
      members: teamMembers.map((member) => ({
        email: member.email,
        phone: member.phone,
      })),
    });

    if (!crossTeamValidation.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: "Duplicate contact information found",
          errors: crossTeamValidation.errors,
          duplicateDetails: crossTeamValidation.duplicateDetails,
        },
        { status: 400 }
      );
    }

    // Check problem statement availability
    const ps = await ProblemStatement.findById(problemStatement).select("title");
    if (!ps) {
      return NextResponse.json(
        { success: false, error: "Invalid problem statement" },
        { status: 400 }
      );
    }

    // Create team using transaction
    const session = await mongoose.startSession();

    let result;

    try {
      await session.withTransaction(async () => {
        // Claim a slot atomically. A read followed by an unconditional
        // increment allows concurrent registrations to exceed maxTeams.
        const claimedProblemStatement = await ProblemStatement.findOneAndUpdate(
          {
            _id: problemStatement,
            isActive: true,
            $expr: { $lt: ["$teamCount", "$maxTeams"] },
          },
          { $inc: { teamCount: 1 } },
          { new: true, session }
        );

        if (!claimedProblemStatement) {
          const error = new Error("Problem statement is no longer available");
          error.name = "ProblemStatementUnavailable";
          throw error;
        }

        // Update user with leader details if provided
        if (teamLeader) {
          await User.findByIdAndUpdate(
            user._id,
            {
              phone: teamLeader.phone,
              gender: teamLeader.gender?.toLowerCase() as
                | "male"
                | "female"
                | "other",
              college:
                teamLeader.college || "Dayananda Sagar College of Engineering",
              year: teamLeader.year,
              branch: teamLeader.branch,
            },
            { session }
          );
        }

        // Create the team
        const team = new Team({
          teamName: teamName.trim(),
          leader: user._id,
          members: teamMembers,
          problemStatement,
          status: "registered",
          registrationDate: new Date(),
        });

        await team.save({ session });

        // Update user's team reference
        await User.findByIdAndUpdate(user._id, { team: team._id }, { session });

        result = {
          success: true,
          message: "Team registered successfully",
          team: {
            _id: team._id,
            teamName: team.teamName,
            status: team.status,
            registrationDate: team.registrationDate,
          },
        };
      });

      // Send confirmation email asynchronously in the background using Next.js `after`
      // This prevents the request from blocking while ensuring the Vercel lambda doesn't terminate the promise
      after(() => {
        sendTeamRegistrationEmail(
          teamName,
          user.name,
          user.email,
          ps.title
        ).catch((emailError) => {
          console.error("Email sending failed in background:", emailError);
        });
      });

      return NextResponse.json(result);
    } finally {
      await session.endSession();
    }
  } catch (error: unknown) {
    console.error("Team registration error:", error);

    if (error instanceof Error && error.name === "ProblemStatementUnavailable") {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === 11000
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "You or this team name is already registered",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Failed to register team",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const authenticatedRequest = await verifyAuth(request);
    const user = authenticatedRequest.user;

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    await dbConnect();

    // Get user's team if exists
    const team = await Team.findOne({ leader: user._id })
      .populate("problemStatement", "psNumber title description domain")
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

    return NextResponse.json({
      success: true,
      isRegistered: true,
      message: `Your team "${team.teamName}" is already registered`,
      team: {
        _id: team._id,
        teamName: team.teamName,
        leader: team.leader,
        members: team.members,
        problemStatement: team.problemStatement,
        status: getLeaderVisibleTeamStatus(team.status, resultsPublished),
        resultsPublished,
        registrationDate: team.registrationDate,
        tasks: team.tasks,
      },
    });
  } catch (error: unknown) {
    console.error("Get team error:", error);

    return NextResponse.json(
      { success: false, error: "Failed to get team information" },
      { status: 500 }
    );
  }
}
