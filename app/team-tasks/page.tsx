"use client";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/context/AuthContext";
import FileUploadInfo from "@/components/FileUploadInfo";
import CountdownTimer from "@/components/ui/CountdownTimer";
import posthog from "posthog-js";
import toast from "react-hot-toast";
import {
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  FileText,
  Upload,
  Eye,
  ExternalLink,
} from "lucide-react";

interface TaskField {
  type: "text" | "textarea" | "file" | "url" | "number" | "date";
  label: string;
  required: boolean;
  placeholder?: string;
  acceptedFormats?: string[];
  maxSize?: number;
  maxLength?: number;
  description?: string;
}

interface TaskSubmission {
  taskId: string;
  submittedAt: string;
  files?: string[];
  data?: Record<string, string | number>;
  status: "submitted" | "reviewed" | "approved" | "rejected";
  feedback?: string;
}

interface Task {
  _id: string;
  title: string;
  description?: string;
  fields: TaskField[];
  availableToAll?: boolean;
  dueDate?: string;
  createdAt: string;
  submission: TaskSubmission | null;
}

export default function TeamTasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, string | File>>({});
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const fetchTasks = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/sih/api/team/tasks", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks || []);
      } else {
        console.error("Failed to fetch tasks:", response.status);
      }
    } catch (error) {
      console.error("Error fetching tasks:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const getTaskStatus = (task: Task) => {
    if (!task.submission) return "pending";
    return task.submission.status;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "text-green-400 bg-green-500/20";
      case "rejected":
        return "text-red-400 bg-red-500/20";
      case "reviewed":
        return "text-yellow-400 bg-yellow-500/20";
      case "submitted":
        return "text-blue-400 bg-blue-500/20";
      default:
        return "text-gray-400 bg-gray-500/20";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="w-4 h-4" />;
      case "rejected":
        return <AlertCircle className="w-4 h-4" />;
      case "submitted":
      case "reviewed":
        return <Clock className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const isOverdue = (task: Task) => {
    if (!task.dueDate) return false;
    return new Date() > new Date(task.dueDate) && !task.submission;
  };

  // Helper function to detect if a string is a URL
  const isValidUrl = (string: string) => {
    try {
      const url = new URL(string);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  };

  // Helper function to render text with clickable links
  const renderTextWithLinks = (text: string) => {
    // Split text by spaces to find potential URLs
    const words = text.split(" ");
    const result = [];

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (isValidUrl(word)) {
        result.push(
          <a
            key={i}
            href={word}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-1"
          >
            {word}
            <ExternalLink className="w-3 h-3" />
          </a>,
        );
      } else {
        result.push(word);
      }

      // Add space between words (except for the last word)
      if (i < words.length - 1) {
        result.push(" ");
      }
    }

    return result;
  };

  // Helper function to render value with clickable links
  const renderValueWithLinks = (value: string | number) => {
    const stringValue = String(value);

    if (isValidUrl(stringValue)) {
      return (
        <a
          href={stringValue}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-1"
        >
          {stringValue}
          <ExternalLink className="w-3 h-3" />
        </a>
      );
    }

    return stringValue;
  };

  const handleFieldChange = (fieldLabel: string, value: string | File) => {
    setFormData((prev) => ({ ...prev, [fieldLabel]: value }));
    // Clear validation error when user starts typing/selecting
    if (validationErrors[fieldLabel]) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[fieldLabel];
        return newErrors;
      });
    }
  };

  const validateForm = () => {
    if (!selectedTask) return false;

    const errors: Record<string, string> = {};

    selectedTask.fields.forEach((field) => {
      if (field.required && !formData[field.label]) {
        errors[field.label] = `${field.label} is required`;
      }

      // Validate file uploads
      if (field.type === "file" && formData[field.label] instanceof File) {
        const file = formData[field.label] as File;

        // Check file size
        if (field.maxSize && file.size > field.maxSize * 1024 * 1024) {
          const sizeLimit =
            field.maxSize < 1
              ? `${Math.round(field.maxSize * 1024)} KB`
              : `${field.maxSize} MB`;
          errors[field.label] = `File must be smaller than ${sizeLimit}`;
        }

        // Check file format
        if (field.acceptedFormats && field.acceptedFormats.length > 0) {
          const fileExtension = file.name.split(".").pop()?.toLowerCase();
          if (
            !fileExtension ||
            !field.acceptedFormats.includes(fileExtension)
          ) {
            errors[field.label] =
              `File format not allowed. Allowed: .${field.acceptedFormats.join(
                ", .",
              )}`;
          }
        }
      }

      // Validate text length
      if (
        (field.type === "text" || field.type === "textarea") &&
        field.maxLength
      ) {
        const textValue = formData[field.label] as string;
        if (textValue && textValue.length > field.maxLength) {
          errors[field.label] =
            `Text must be ${field.maxLength} characters or less`;
        }
      }
    });

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!selectedTask || !validateForm()) return;

    setSubmitting(true);
    try {
      const token = await user?.getIdToken();
      const submitFormData = new FormData();

      selectedTask.fields.forEach((field) => {
        const value = formData[field.label];
        if (value) {
          submitFormData.append(field.label, value);
        }
      });

      const response = await fetch(
        `/sih/api/team/tasks/${selectedTask._id}/submit`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: submitFormData,
        },
      );

      if (response.ok) {
        posthog.capture("task_submission_completed", {
          field_count: selectedTask.fields.length,
          has_due_date: Boolean(selectedTask.dueDate),
        });
        toast.success("Task submitted successfully!");
        setShowSubmissionForm(false);
        setSelectedTask(null);
        setFormData({});
        setValidationErrors({});
        await fetchTasks(); // Refresh tasks
      } else {
        const error = await response.json();
        toast.error(`Failed to submit task: ${error.error}`);
      }
    } catch (error) {
      console.error("Error submitting task:", error);
      toast.error("An error occurred while submitting the task");
    } finally {
      setSubmitting(false);
    }
  };

  const openSubmissionForm = (task: Task) => {
    setSelectedTask(task);
    setShowSubmissionForm(true);

    // Pre-fill form with existing submission data
    if (task.submission?.data) {
      const submissionData: Record<string, string | File> = {};
      Object.entries(task.submission.data).forEach(([key, value]) => {
        submissionData[key] = typeof value === "string" ? value : String(value);
      });
      setFormData(submissionData);
    } else {
      setFormData({});
    }
    setValidationErrors({});
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-background">
          <Navbar />
          <div className="flex items-center justify-center min-h-[calc(100vh-80px)] pt-24">
            <div className="text-center">
              <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-heading mx-auto mb-4"></div>
              <p className="text-text font-body">Loading your tasks...</p>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-6xl mx-auto px-6 py-8 pt-24">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-display text-heading mb-2">
              My Team Tasks
            </h1>
            <p className="text-subheading font-body">
              Complete your assigned tasks and track their progress
            </p>
          </div>

          {/* Tasks Grid */}
          {tasks.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-xl font-display text-heading mb-2">
                No Tasks Assigned
              </h3>
              <p className="text-gray-400">
                You don&apos;t have any tasks assigned yet.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {tasks.map((task) => {
                const status = getTaskStatus(task);
                const overdue = isOverdue(task);

                return (
                  <motion.div
                    key={task._id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`bg-gray-900/50 backdrop-blur-sm border rounded-2xl p-6 transition-all hover:shadow-lg ${
                      overdue ? "border-red-500/50" : "border-gray-800"
                    }`}
                  >
                    {/* Task Header */}
                    <div className="flex items-start justify-between mb-4">
                      <h3 className="text-lg font-display text-heading mb-2 line-clamp-2">
                        {task.title}
                      </h3>
                      <div
                        className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${getStatusColor(
                          status,
                        )}`}
                      >
                        {getStatusIcon(status)}
                        <span className="capitalize">{status}</span>
                      </div>
                    </div>

                    {/* Task Description */}
                    {task.description && (
                      <p className="text-gray-400 text-sm mb-4 line-clamp-3">
                        {renderTextWithLinks(task.description)}
                      </p>
                    )}

                    {task.availableToAll && (
                      <div className="mb-4 inline-flex items-center rounded-full border border-heading/30 bg-heading/10 px-2.5 py-1 text-xs font-medium text-heading">
                        Available to all teams
                      </div>
                    )}

                    {/* Due Date & Countdown */}
                    {task.dueDate && (
                      <div className="mb-4 space-y-2">
                        <div
                          className={`flex items-center gap-2 text-sm ${
                            overdue ? "text-red-400" : "text-gray-500"
                          }`}
                        >
                          <Calendar className="w-4 h-4" />
                          <span>
                            Due:{" "}
                            {new Date(task.dueDate).toLocaleString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            IST
                          </span>
                        </div>
                        {!overdue ? (
                          <CountdownTimer dueDate={task.dueDate} />
                        ) : (
                          <div className="flex items-center gap-2 text-red-400">
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-sm font-medium">
                              Deadline Passed
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Task Fields Summary */}
                    <div className="mb-4">
                      <p className="text-gray-500 text-xs mb-2">
                        {task.fields.length} field
                        {task.fields.length !== 1 ? "s" : ""} required
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {task.fields.slice(0, 3).map((field, index) => (
                          <span
                            key={index}
                            className="text-xs px-2 py-1 bg-gray-700/50 text-gray-300 rounded"
                          >
                            {field.type}
                          </span>
                        ))}
                        {task.fields.length > 3 && (
                          <span className="text-xs px-2 py-1 bg-gray-700/50 text-gray-300 rounded">
                            +{task.fields.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Submission Status */}
                    {task.submission && (
                      <div className="mb-4 p-3 bg-gray-800/50 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle className="w-4 h-4 text-green-400" />
                          <span className="text-sm text-gray-300">
                            Submitted{" "}
                            {new Date(
                              task.submission.submittedAt,
                            ).toLocaleDateString()}
                          </span>
                        </div>
                        {task.submission.feedback && (
                          <p className="text-sm text-gray-400 mt-2">
                            <span className="text-gray-300">Feedback:</span>{" "}
                            {task.submission.feedback}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      {task.submission ? (
                        <button
                          onClick={() => openSubmissionForm(task)}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30"
                        >
                          <Eye className="w-4 h-4" />
                          View Submission
                        </button>
                      ) : (
                        <button
                          onClick={() => openSubmissionForm(task)}
                          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${"bg-heading/20 text-heading border border-heading/30 hover:bg-heading/30"}`}
                        >
                          <>
                            <Upload className="w-4 h-4" />
                            Submit
                          </>
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Submission Form Modal */}
          <AnimatePresence>
            {showSubmissionForm && selectedTask && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
                onClick={() => {
                  setShowSubmissionForm(false);
                  setSelectedTask(null);
                  setFormData({});
                  setValidationErrors({});
                }}
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Modal Header */}
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-2xl font-display text-heading mb-1">
                        {selectedTask.submission
                          ? "View Submission"
                          : "Submit Task"}
                      </h2>
                      <h3 className="text-lg text-subheading">
                        {selectedTask.title}
                      </h3>
                      {selectedTask.submission && (
                        <p className="text-sm text-green-400 mt-1">
                          ✓ Submitted on{" "}
                          {new Date(
                            selectedTask.submission.submittedAt,
                          ).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setShowSubmissionForm(false);
                        setSelectedTask(null);
                        setFormData({});
                        setValidationErrors({});
                      }}
                      className="text-gray-400 hover:text-white"
                    >
                      <svg
                        className="w-6 h-6"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>

                  {/* Task Description */}
                  {selectedTask.description && (
                    <div className="mb-6 p-4 bg-gray-800/50 rounded-lg">
                      <h4 className="text-sm font-medium text-subheading mb-2">
                        Task Description
                      </h4>
                      <p className="text-gray-300 text-sm">
                        {renderTextWithLinks(selectedTask.description)}
                      </p>
                    </div>
                  )}

                  {selectedTask.dueDate && (
                    <div className="mb-6 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                      <p className="text-blue-300 text-sm flex items-center">
                        <Calendar className="w-4 h-4 inline mr-2" />
                        Due:{" "}
                        {new Date(selectedTask.dueDate).toLocaleDateString()}
                      </p>
                    </div>
                  )}

                  {/* Form Fields */}
                  <div className="space-y-6">
                    {selectedTask.fields.map((field, index) => (
                      <div key={index} className="space-y-2">
                        <label className="block text-subheading text-sm font-medium">
                          {field.label}
                          {field.required && (
                            <span className="text-red-400 ml-1">*</span>
                          )}
                        </label>

                        {field.description && (
                          <p className="text-gray-400 text-xs">
                            {renderTextWithLinks(field.description)}
                          </p>
                        )}

                        {/* Text Input */}
                        {field.type === "text" && (
                          <div>
                            {selectedTask.submission &&
                            formData[field.label] &&
                            isValidUrl(formData[field.label] as string) ? (
                              // Show as clickable link when viewing submission and content is a URL
                              <div className="p-3 bg-gray-800/50 border border-gray-600 rounded-lg">
                                <a
                                  href={formData[field.label] as string}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-2 break-all"
                                >
                                  {formData[field.label] as string}
                                  <ExternalLink className="w-4 h-4 flex-shrink-0" />
                                </a>
                              </div>
                            ) : (
                              // Show as regular input
                              <>
                                <input
                                  type="text"
                                  value={
                                    (formData[field.label] as string) || ""
                                  }
                                  onChange={(e) =>
                                    handleFieldChange(
                                      field.label,
                                      e.target.value,
                                    )
                                  }
                                  placeholder={field.placeholder}
                                  maxLength={field.maxLength}
                                  readOnly={!!selectedTask.submission}
                                  className={`w-full px-4 py-2 bg-gray-800/50 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-heading ${
                                    validationErrors[field.label]
                                      ? "border-red-500"
                                      : "border-gray-600"
                                  } ${
                                    selectedTask.submission
                                      ? "cursor-not-allowed opacity-75"
                                      : ""
                                  }`}
                                />
                                {field.maxLength &&
                                  !selectedTask.submission && (
                                    <p className="text-gray-500 text-xs mt-1">
                                      {
                                        (
                                          (formData[field.label] as string) ||
                                          ""
                                        ).length
                                      }
                                      /{field.maxLength} characters
                                    </p>
                                  )}
                              </>
                            )}
                          </div>
                        )}

                        {/* Textarea Input */}
                        {field.type === "textarea" && (
                          <div>
                            <textarea
                              value={(formData[field.label] as string) || ""}
                              onChange={(e) =>
                                handleFieldChange(field.label, e.target.value)
                              }
                              placeholder={field.placeholder}
                              maxLength={field.maxLength}
                              readOnly={!!selectedTask.submission}
                              rows={4}
                              className={`w-full px-4 py-2 bg-gray-800/50 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-heading resize-vertical ${
                                validationErrors[field.label]
                                  ? "border-red-500"
                                  : "border-gray-600"
                              } ${
                                selectedTask.submission
                                  ? "cursor-not-allowed opacity-75"
                                  : ""
                              }`}
                            />
                            {field.maxLength && !selectedTask.submission && (
                              <p className="text-gray-500 text-xs mt-1">
                                {
                                  ((formData[field.label] as string) || "")
                                    .length
                                }
                                /{field.maxLength} characters
                              </p>
                            )}
                          </div>
                        )}

                        {/* File Input */}
                        {field.type === "file" && (
                          <div>
                            <input
                              type="file"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  handleFieldChange(field.label, file);
                                }
                              }}
                              accept={field.acceptedFormats
                                ?.map((format) => `.${format}`)
                                .join(",")}
                              disabled={!!selectedTask.submission}
                              className={`w-full px-4 py-2 bg-gray-800/50 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-heading file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-heading/20 file:text-heading file:text-sm hover:file:bg-heading/30 ${
                                validationErrors[field.label]
                                  ? "border-red-500"
                                  : "border-gray-600"
                              } ${
                                selectedTask.submission
                                  ? "cursor-not-allowed opacity-75"
                                  : ""
                              }`}
                            />
                            <FileUploadInfo
                              acceptedFormats={field.acceptedFormats}
                              maxSize={field.maxSize}
                              required={field.required}
                              className="mt-2"
                            />
                          </div>
                        )}

                        {/* URL Input */}
                        {field.type === "url" && (
                          <div>
                            {selectedTask.submission &&
                            formData[field.label] ? (
                              // Show as clickable link when viewing submission
                              <div className="p-3 bg-gray-800/50 border border-gray-600 rounded-lg">
                                <a
                                  href={formData[field.label] as string}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-2"
                                >
                                  {formData[field.label] as string}
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                              </div>
                            ) : (
                              // Show as input when submitting
                              <div className="relative">
                                <input
                                  type="url"
                                  value={
                                    (formData[field.label] as string) || ""
                                  }
                                  onChange={(e) =>
                                    handleFieldChange(
                                      field.label,
                                      e.target.value,
                                    )
                                  }
                                  placeholder={
                                    field.placeholder || "https://example.com"
                                  }
                                  readOnly={!!selectedTask.submission}
                                  className={`w-full px-4 py-2 pr-10 bg-gray-800/50 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-heading ${
                                    validationErrors[field.label]
                                      ? "border-red-500"
                                      : "border-gray-600"
                                  } ${
                                    selectedTask.submission
                                      ? "cursor-not-allowed opacity-75"
                                      : ""
                                  }`}
                                />
                                <ExternalLink className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Number Input */}
                        {field.type === "number" && (
                          <input
                            type="number"
                            value={(formData[field.label] as string) || ""}
                            onChange={(e) =>
                              handleFieldChange(field.label, e.target.value)
                            }
                            placeholder={field.placeholder}
                            readOnly={!!selectedTask.submission}
                            className={`w-full px-4 py-2 bg-gray-800/50 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-heading ${
                              validationErrors[field.label]
                                ? "border-red-500"
                                : "border-gray-600"
                            } ${
                              selectedTask.submission
                                ? "cursor-not-allowed opacity-75"
                                : ""
                            }`}
                          />
                        )}

                        {/* Date Input */}
                        {field.type === "date" && (
                          <input
                            type="date"
                            value={(formData[field.label] as string) || ""}
                            onChange={(e) =>
                              handleFieldChange(field.label, e.target.value)
                            }
                            readOnly={!!selectedTask.submission}
                            className={`w-full px-4 py-2 bg-gray-800/50 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-heading ${
                              validationErrors[field.label]
                                ? "border-red-500"
                                : "border-gray-600"
                            } ${
                              selectedTask.submission
                                ? "cursor-not-allowed opacity-75"
                                : ""
                            }`}
                          />
                        )}

                        {/* Validation Error */}
                        {validationErrors[field.label] && (
                          <p className="text-red-400 text-sm flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {validationErrors[field.label]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Submitted Data & Files (only show when viewing submission) */}
                  {selectedTask.submission && (
                    <div className="mt-6 space-y-4">
                      {/* Submitted Form Data */}
                      {selectedTask.submission.data &&
                        Object.keys(selectedTask.submission.data).length >
                          0 && (
                          <div className="p-4 bg-gray-800/30 rounded-lg">
                            <h4 className="text-sm font-medium text-subheading mb-3">
                              Submitted Responses:
                            </h4>
                            <div className="space-y-2">
                              {Object.entries(selectedTask.submission.data).map(
                                ([key, value]) => (
                                  <div key={key} className="text-sm">
                                    <span className="text-gray-400">
                                      {key}:
                                    </span>
                                    <span className="text-white ml-2">
                                      {renderValueWithLinks(value)}
                                    </span>
                                  </div>
                                ),
                              )}
                            </div>
                          </div>
                        )}

                      {/* Submitted Files */}
                      {selectedTask.submission.files &&
                        selectedTask.submission.files.length > 0 && (
                          <div className="p-4 bg-gray-800/30 rounded-lg">
                            <h4 className="text-sm font-medium text-subheading mb-3">
                              Submitted Files:
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {selectedTask.submission.files.map(
                                (fileUrl, index) => {
                                  const filename =
                                    fileUrl.split("/").pop() ||
                                    `file-${index + 1}`;
                                  return (
                                    <div
                                      key={index}
                                      className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700"
                                    >
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
                                        <span className="text-sm text-gray-300 truncate">
                                          {filename}
                                        </span>
                                      </div>
                                      <a
                                        href={fileUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1 text-blue-400 hover:text-blue-300 transition-colors"
                                        title="View File"
                                      >
                                        <ExternalLink className="w-4 h-4" />
                                      </a>
                                    </div>
                                  );
                                },
                              )}
                            </div>
                          </div>
                        )}

                      {/* Submission Feedback */}
                      {selectedTask.submission.feedback && (
                        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                          <h4 className="text-sm font-medium text-yellow-400 mb-2">
                            Admin Feedback:
                          </h4>
                          <p className="text-sm text-gray-300">
                            {selectedTask.submission.feedback}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Form Actions */}
                  <div className="flex gap-3 pt-6 border-t border-gray-700 mt-6">
                    <button
                      onClick={() => {
                        setShowSubmissionForm(false);
                        setSelectedTask(null);
                        setFormData({});
                        setValidationErrors({});
                      }}
                      className="px-6 py-2 bg-gray-800 border border-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Close
                    </button>
                    {!selectedTask.submission && (
                      <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="px-6 py-2 bg-heading/20 border border-heading/30 text-heading rounded-lg hover:bg-heading/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submitting ? "Submitting..." : "Submit Task"}
                      </button>
                    )}
                    {selectedTask.submission && (
                      <div className="flex items-center gap-2 text-green-400">
                        <CheckCircle className="w-5 h-5" />
                        <span className="text-sm font-medium">
                          Task submitted successfully
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </ProtectedRoute>
  );
}
