import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/middleware/auth";
import { Task } from "@/models/Task";
import { Team } from "@/models/Team";
import { uploadToCloudinary } from "@/lib/utils/cloudinary";
import {
  isValidObjectId,
  sanitizeSingleLineText,
  sanitizeText,
  validateFile,
  validateURL,
} from "@/lib/utils/validation";
import dbConnect from "@/lib/mongodb";
import { Types } from "mongoose";

// POST /api/team/tasks/[taskId]/submit - Submit a task
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await context.params;

    if (!isValidObjectId(taskId)) {
      return NextResponse.json(
        { success: false, error: "Invalid task ID" },
        { status: 400 },
      );
    }

    // Authenticate team leader
    const authenticatedRequest = await verifyAuth(request);
    const user = authenticatedRequest.user;

    if (!user || user.role !== "leader") {
      return NextResponse.json(
        { success: false, error: "Team leader authentication required" },
        { status: 401 },
      );
    }

    await dbConnect();

    // Find the team for this leader
    const team = await Team.findOne({ leader: user._id });
    if (!team) {
      return NextResponse.json(
        { success: false, error: "Team not found" },
        { status: 404 },
      );
    }

    // Find the task
    const task = await Task.findById(taskId);
    if (!task) {
      return NextResponse.json(
        { success: false, error: "Task not found" },
        { status: 404 },
      );
    }

    // Check if task is assigned to this team
    const isAssigned =
      task.availableToAll ||
      task.assignedTo.some(
        (teamId) => teamId.toString() === team._id.toString(),
      );

    if (!isAssigned) {
      return NextResponse.json(
        { success: false, error: "Task not assigned to your team" },
        { status: 403 },
      );
    }

    // Check if task is still active
    // if (!task.isActive) {
    //   return NextResponse.json(
    //     { success: false, error: "Task is no longer active" },
    //     { status: 400 }
    //   );
    // }

    // Check if due date has passed
    // if (task.dueDate && new Date() > task.dueDate) {
    //   return NextResponse.json(
    //     { success: false, error: "Task submission deadline has passed" },
    //     { status: 400 },
    //   );
    // }

    const submissionTaskId = new Types.ObjectId(taskId);
    const existingSubmission = team.tasks.find(
      (sub) => sub.taskId.toString() === taskId,
    );

    // Evaluated submissions are immutable. Check before processing uploads so
    // a rejected update cannot create new external files either.
    if (
      existingSubmission &&
      (existingSubmission.status === "approved" ||
        existingSubmission.status === "rejected")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "This submission is locked after evaluation",
        },
        { status: 409 },
      );
    }

    // Parse form data
    const formData = await request.formData();
    const submissionData: Record<string, string | number> = {};
    const uploadedFiles: string[] = [];

    // Process each field
    for (const field of task.fields) {
      const fieldValue = formData.get(field.label);

      if (field.required && (!fieldValue || fieldValue === "")) {
        return NextResponse.json(
          { success: false, error: `Field '${field.label}' is required` },
          { status: 400 },
        );
      }

      if (
        field.type === "file" &&
        fieldValue &&
        !(fieldValue instanceof File)
      ) {
        return NextResponse.json(
          { success: false, error: `Field '${field.label}' must be a file` },
          { status: 400 },
        );
      }

      if (field.type !== "file" && fieldValue instanceof File) {
        return NextResponse.json(
          { success: false, error: `Field '${field.label}' must be text data` },
          { status: 400 },
        );
      }

      if (field.type === "file" && fieldValue instanceof File) {
        if (fieldValue.size === 0) {
          return NextResponse.json(
            { success: false, error: `File '${field.label}' cannot be empty` },
            { status: 400 },
          );
        }

        // Validate file using field-specific restrictions
        const validation = validateFile(
          {
            size: fieldValue.size,
            type: fieldValue.type,
            name: fieldValue.name,
          },
          {
            maxSizeInMB: field.maxSize || 10,
            allowedFormats:
              field.acceptedFormats && field.acceptedFormats.length > 0
                ? field.acceptedFormats
                : ["pdf", "ppt", "pptx", "doc", "docx"], // Default formats
          },
        );

        if (!validation.isValid) {
          return NextResponse.json(
            {
              success: false,
              error: `File '${field.label}': ${validation.error}`,
            },
            { status: 400 },
          );
        }

        // Upload file to Cloudinary
        try {
          // Convert File to Buffer
          const fileBuffer = Buffer.from(await fieldValue.arrayBuffer());

          console.log(
            `Uploading file: ${fieldValue.name}, size: ${fileBuffer.length}, type: ${fieldValue.type}`,
          );

          // Determine resource type and format based on file type
          let resourceType: "auto" | "raw" = "auto";
          let format: string | undefined;

          // Extract file extension for format
          const fileExtension = fieldValue.name.toLowerCase().split(".").pop();

          if (
            fieldValue.type === "application/pdf" ||
            fieldValue.name.toLowerCase().endsWith(".pdf")
          ) {
            resourceType = "raw"; // Explicitly set PDFs as raw
            format = "pdf"; // Explicitly set format for PDFs
          } else if (
            fileExtension &&
            ["ppt", "pptx", "doc", "docx"].includes(fileExtension)
          ) {
            resourceType = "raw"; // Set document files as raw
            format = fileExtension; // Use the actual file extension
          }

          console.log(
            `Detected format: ${format}, resource_type: ${resourceType}`,
          );

          // Upload with original filename preserved - simplified
          const uploadResult = await uploadToCloudinary(fileBuffer, {
            folder: "task-submissions",
            resource_type: resourceType,
            type: "upload", // Explicitly set to upload type for public access
            access_mode: "public", // Ensure public access
            use_filename: true, // Use original filename
            unique_filename: true, // Ensure uniqueness
            overwrite: true, // Ensure files can be overwritten
            format: format, // Explicitly set format when needed
          });

          console.log("Upload successful:", {
            url: uploadResult.secure_url,
            public_id: uploadResult.public_id,
            resource_type: uploadResult.resource_type,
          });

          console.log(`Upload successful:`, {
            public_id: uploadResult.public_id,
            secure_url: uploadResult.secure_url,
            resource_type: uploadResult.resource_type,
            format: uploadResult.format,
            bytes: uploadResult.bytes,
          });

          submissionData[field.label] = uploadResult.secure_url;
          uploadedFiles.push(uploadResult.secure_url);
        } catch (uploadError: unknown) {
          console.error("File upload error:", uploadError);
          const errorMessage =
            uploadError instanceof Error
              ? uploadError.message
              : "Unknown upload error";
          return NextResponse.json(
            {
              success: false,
              error: `Failed to upload file ${fieldValue.name}: ${errorMessage}`,
            },
            { status: 500 },
          );
        }
      } else if (fieldValue) {
        // Handle other field types
        const fieldValueString = fieldValue.toString();
        let normalizedValue: string | number = fieldValueString;

        if (field.type === "text" || field.type === "textarea") {
          normalizedValue = sanitizeText(fieldValueString, 10000);
          if (field.maxLength && normalizedValue.length > field.maxLength) {
            return NextResponse.json(
              {
                success: false,
                error: `Field '${field.label}' exceeds maximum length of ${field.maxLength} characters`,
              },
              { status: 400 },
            );
          }
        } else if (field.type === "url") {
          normalizedValue = sanitizeSingleLineText(fieldValueString, 2048);
          if (!validateURL(normalizedValue)) {
            return NextResponse.json(
              {
                success: false,
                error: `Field '${field.label}' must be a valid URL`,
              },
              { status: 400 },
            );
          }
        } else if (field.type === "number") {
          const numberValue = Number(fieldValueString);
          if (!Number.isFinite(numberValue)) {
            return NextResponse.json(
              {
                success: false,
                error: `Field '${field.label}' must be a valid number`,
              },
              { status: 400 },
            );
          }
          normalizedValue = numberValue;
        } else if (field.type === "date") {
          const dateValue = new Date(fieldValueString);
          if (Number.isNaN(dateValue.getTime())) {
            return NextResponse.json(
              {
                success: false,
                error: `Field '${field.label}' must be a valid date`,
              },
              { status: 400 },
            );
          }
          normalizedValue = dateValue.toISOString();
        }

        submissionData[field.label] = normalizedValue;
      }
    }

    const submission = {
      taskId: submissionTaskId,
      submittedAt: new Date(),
      files: uploadedFiles,
      data: submissionData,
      status: "submitted" as const,
    };

    // Update or insert atomically. The status predicate prevents a concurrent
    // evaluator decision from being overwritten by a stale team request.
    const updatedTeam = existingSubmission
      ? await Team.findOneAndUpdate(
          {
            _id: team._id,
            tasks: {
              $elemMatch: {
                taskId: submissionTaskId,
                status: { $nin: ["approved", "rejected"] },
              },
            },
          },
          { $set: { "tasks.$": submission } },
          { new: true, runValidators: true },
        )
      : await Team.findOneAndUpdate(
          {
            _id: team._id,
            tasks: { $not: { $elemMatch: { taskId: submissionTaskId } } },
          },
          { $push: { tasks: submission } },
          { new: true, runValidators: true },
        );

    if (!updatedTeam) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This submission was changed or locked while you were submitting",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Task submitted successfully",
      submission: {
        taskId,
        submittedAt: submission.submittedAt,
        status: submission.status,
      },
    });
  } catch (error: unknown) {
    console.error("Task submission error:", error);

    return NextResponse.json(
      { success: false, error: "Failed to submit task" },
      { status: 500 },
    );
  }
}

// GET /api/team/tasks/[taskId]/submit - Get submission details for a specific task
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await context.params;

    if (!isValidObjectId(taskId)) {
      return NextResponse.json(
        { success: false, error: "Invalid task ID" },
        { status: 400 },
      );
    }

    // Authenticate team leader
    const authenticatedRequest = await verifyAuth(request);
    const user = authenticatedRequest.user;

    if (!user || user.role !== "leader") {
      return NextResponse.json(
        { success: false, error: "Team leader authentication required" },
        { status: 401 },
      );
    }

    await dbConnect();

    // Find the team for this leader
    const team = await Team.findOne({ leader: user._id });
    if (!team) {
      return NextResponse.json(
        { success: false, error: "Team not found" },
        { status: 404 },
      );
    }

    // Find the task
    const task = await Task.findById(taskId);
    if (!task) {
      return NextResponse.json(
        { success: false, error: "Task not found" },
        { status: 404 },
      );
    }

    // Find the submission
    const submission = team.tasks.find(
      (sub) => sub.taskId.toString() === taskId,
    );

    return NextResponse.json({
      success: true,
      task: {
        _id: task._id,
        title: task.title,
        description: task.description,
        fields: task.fields,
        availableToAll: task.availableToAll,
        dueDate: task.dueDate,
      },
      submission: submission || null,
    });
  } catch (error: unknown) {
    console.error("Get task submission error:", error);

    return NextResponse.json(
      { success: false, error: "Failed to get task submission" },
      { status: 500 },
    );
  }
}
