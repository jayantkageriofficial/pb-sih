"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import AdminLayout from "@/components/admin/AdminLayout";
import StatsCard from "@/components/admin/StatsCard";
import { useAdminAuth } from "@/lib/context/AdminAuthContext";
import {
  Users,
  Settings,
  AlertCircle,
  TrendingUp,
  Award,
  Eye,
  EyeOff,
} from "lucide-react";

interface DashboardStats {
  totalTeams: number;
  registeredTeams: number;
  selectedTeams: number;
  finalistTeams: number;
  totalProblemStatements: number;
  activeProblemStatements: number;
  totalTasks: number;
  activeTasks: number;
  totalEvaluators: number;
  activeEvaluators: number;
  totalAssignments: number;
  pendingEvaluations: number;
}

export default function SuperAdminDashboard() {
  const { admin, isSuperAdmin } = useAdminAuth();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [resultsPublished, setResultsPublished] = useState(false);
  const [resultsVisibilityLoading, setResultsVisibilityLoading] = useState(true);
  const [resultsVisibilityUpdating, setResultsVisibilityUpdating] =
    useState(false);
  const [resultsVisibilityError, setResultsVisibilityError] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!isSuperAdmin) {
      router.push("/admin");
      return;
    }

    const fetchStats = async () => {
      try {
        const token = localStorage.getItem("adminToken");
        if (!token) {
          setStatsLoading(false);
          return;
        }

        // Fetch teams stats
        const teamsResponse = await fetch("/sih/api/admin/teams?limit=1000", {
          headers: { Authorization: `Bearer ${token}` },
        });

        // Fetch problem statements stats
        const psResponse = await fetch("/sih/api/admin/problem-statements", {
          headers: { Authorization: `Bearer ${token}` },
        });

        // Fetch tasks stats
        const tasksResponse = await fetch("/sih/api/admin/tasks", {
          headers: { Authorization: `Bearer ${token}` },
        });

        // Fetch evaluator assignment stats
        const evaluatorResponse = await fetch(
          "/sih/api/admin/evaluators/assignments",
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (
          !teamsResponse.ok ||
          !psResponse.ok ||
          !tasksResponse.ok ||
          !evaluatorResponse.ok
        ) {
          console.error("One or more API calls failed", {
            teams: teamsResponse.status,
            problemStatements: psResponse.status,
            tasks: tasksResponse.status,
            evaluators: evaluatorResponse.status,
          });
        }

        const [teamsData, psData, tasksData, evaluatorData] =
          await Promise.all([
            teamsResponse.ok
              ? teamsResponse.json()
              : Promise.resolve({ total: 0 }),
            psResponse.ok
              ? psResponse.json()
              : Promise.resolve({ problemStatements: [] }),
            tasksResponse.ok ? tasksResponse.json() : Promise.resolve({ tasks: [] }),
            evaluatorResponse.ok
              ? evaluatorResponse.json()
              : Promise.resolve({ evaluators: [] }),
          ]);

          const psStats = psData.problemStatements || [];
          const taskStats = tasksData.tasks || [];
          const evaluators = evaluatorData.evaluators || [];

        // Fetch team status counts separately
        const [registeredResponse, selectedResponse, finalistResponse] =
          await Promise.all([
            fetch("/sih/api/admin/teams?status=registered&limit=1000", {
              headers: { Authorization: `Bearer ${token}` },
            }),
            fetch("/sih/api/admin/teams?status=selected&limit=1000", {
              headers: { Authorization: `Bearer ${token}` },
            }),
            fetch("/sih/api/admin/teams?status=finalist&limit=1000", {
              headers: { Authorization: `Bearer ${token}` },
            }),
          ]);

        const [registeredData, selectedData, finalistData] = await Promise.all([
          registeredResponse.ok
            ? registeredResponse.json()
            : Promise.resolve({ total: 0 }),
          selectedResponse.ok
            ? selectedResponse.json()
            : Promise.resolve({ total: 0 }),
          finalistResponse.ok
            ? finalistResponse.json()
            : Promise.resolve({ total: 0 }),
        ]);

        interface EvaluatorWithAssignments {
          assignedProblemStatements?: { _id: string }[];
          isActive: boolean;
        }

        const totalAssignments = evaluators.reduce(
          (sum: number, evaluator: EvaluatorWithAssignments) =>
            sum + (evaluator.assignedProblemStatements?.length || 0),
          0
        );

        setStats({
          totalTeams: teamsData.total || 0,
          registeredTeams: registeredData.total || 0,
          selectedTeams: selectedData.total || 0,
          finalistTeams: finalistData.total || 0,
          totalProblemStatements: psStats.length,
          activeProblemStatements: psStats.filter(
            (ps: { isActive: boolean }) => ps.isActive
          ).length,
          totalTasks: taskStats.length,
          activeTasks: taskStats.filter(
            (t: { isActive: boolean }) => t.isActive
          ).length,
          totalEvaluators: evaluators.length,
          activeEvaluators: evaluators.filter(
            (e: { isActive: boolean }) => e.isActive
          ).length,
          totalAssignments,
          pendingEvaluations: 0, // This would need a separate API to count pending evaluations
        });
      } catch (error) {
        console.error("Error fetching dashboard stats:", error);
      } finally {
        setStatsLoading(false);
      }
    };

    fetchStats();
  }, [isSuperAdmin, router]);

  useEffect(() => {
    if (!isSuperAdmin) return;

    const controller = new AbortController();

    const fetchResultsVisibility = async () => {
      const token = localStorage.getItem("adminToken");
      if (!token) {
        setResultsVisibilityLoading(false);
        return;
      }

      try {
        const response = await fetch("/sih/api/admin/results-visibility", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load results visibility");
        }

        setResultsPublished(data.resultsPublished === true);
        setResultsVisibilityError(null);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        console.error("Error fetching results visibility:", error);
        setResultsVisibilityError("Could not load the publication setting.");
      } finally {
        if (!controller.signal.aborted) setResultsVisibilityLoading(false);
      }
    };

    fetchResultsVisibility();
    return () => controller.abort();
  }, [isSuperAdmin]);

  const toggleResultsVisibility = async () => {
    const token = localStorage.getItem("adminToken");
    if (!token || resultsVisibilityLoading || resultsVisibilityUpdating) return;

    const nextValue = !resultsPublished;
    setResultsVisibilityUpdating(true);
    setResultsVisibilityError(null);

    try {
      const response = await fetch("/sih/api/admin/results-visibility", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ resultsPublished: nextValue }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update results visibility");
      }

      setResultsPublished(data.resultsPublished === true);
    } catch (error) {
      console.error("Error updating results visibility:", error);
      setResultsVisibilityError(
        error instanceof Error
          ? error.message
          : "Could not update the publication setting."
      );
    } finally {
      setResultsVisibilityUpdating(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <AdminLayout>
        <div className="text-center py-12">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-display text-heading mb-2">
            Access Denied
          </h2>
          <p className="text-gray-400">
            Only super admins can access this dashboard.
          </p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display text-heading mb-2">
              Super Admin Dashboard
            </h1>
            <p className="text-subheading font-body">
              Smart India Hackathon 2026 - System Administration
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-400 font-body">Welcome back,</p>
            <p className="text-heading font-medium">{admin?.email}</p>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30 mt-1">
              Super Admin
            </span>
          </div>
        </div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => router.push("/admin/teams")}
            className="p-6 bg-gradient-to-r from-blue-600/10 to-blue-400/10 border border-blue-500/30 rounded-xl text-left hover:border-blue-400/50 transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-blue-500/20 rounded-lg">
                <Users className="w-6 h-6 text-blue-400" />
              </div>
              <span className="text-2xl font-bold text-blue-400">
                {stats?.totalTeams || "..."}
              </span>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">
              Manage Teams
            </h3>
            <p className="text-gray-400 text-sm">
              View and manage team registrations
            </p>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => router.push("/admin/problem-statements")}
            className="p-6 bg-gradient-to-r from-green-600/10 to-green-400/10 border border-green-500/30 rounded-xl text-left hover:border-green-400/50 transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-green-500/20 rounded-lg">
                <Settings className="w-6 h-6 text-green-400" />
              </div>
              <span className="text-2xl font-bold text-green-400">
                {stats?.totalProblemStatements || "..."}
              </span>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">
              Problem Statements
            </h3>
            <p className="text-gray-400 text-sm">
              Manage problem statements and bulk upload
            </p>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => router.push("/admin/evaluator-assignments")}
            className="p-6 bg-gradient-to-r from-purple-600/10 to-purple-400/10 border border-purple-500/30 rounded-xl text-left hover:border-purple-400/50 transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-purple-500/20 rounded-lg">
                <Award className="w-6 h-6 text-purple-400" />
              </div>
              <span className="text-2xl font-bold text-purple-400">
                {stats?.activeEvaluators || "..."}
              </span>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">
              Evaluator Management
            </h3>
            <p className="text-gray-400 text-sm">
              Assign evaluators to problem statements
            </p>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => router.push("/admin/submissions")}
            className="p-6 bg-gradient-to-r from-orange-600/10 to-orange-400/10 border border-orange-500/30 rounded-xl text-left hover:border-orange-400/50 transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-orange-500/20 rounded-lg">
                <TrendingUp className="w-6 h-6 text-orange-400" />
              </div>
              <span className="text-2xl font-bold text-orange-400">View</span>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">Submissions</h3>
            <p className="text-gray-400 text-sm">
              Monitor all team submissions
            </p>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() =>
              router.push("/admin/super-admin-dashboard/evaluator-rankings")
            }
            className="p-6 bg-gradient-to-r from-cyan-600/10 to-cyan-400/10 border border-cyan-500/30 rounded-xl text-left hover:border-cyan-400/50 transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-cyan-500/20 rounded-lg">
                <Award className="w-6 h-6 text-cyan-400" />
              </div>
              <span className="text-2xl font-bold text-cyan-400">Track</span>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">
              Evaluator Rankings
            </h3>
            <p className="text-gray-400 text-sm">
              View individual evaluator progress and rankings
            </p>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() =>
              router.push("/admin/super-admin-dashboard/problem-rankings")
            }
            className="p-6 bg-gradient-to-r from-pink-600/10 to-pink-400/10 border border-pink-500/30 rounded-xl text-left hover:border-pink-400/50 transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-pink-500/20 rounded-lg">
                <TrendingUp className="w-6 h-6 text-pink-400" />
              </div>
              <span className="text-2xl font-bold text-pink-400">Compare</span>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">
              Problem Rankings
            </h3>
            <p className="text-gray-400 text-sm">
              Analyze rankings across evaluators for each problem
            </p>
          </motion.button>
        </motion.div>

        {/* Statistics Overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          <StatsCard
            title="Total Teams"
            value={stats?.totalTeams || 0}
            icon="teams"
            color="blue"
            loading={statsLoading}
          />
          <StatsCard
            title="Active Evaluators"
            value={stats?.activeEvaluators || 0}
            icon="check"
            color="purple"
            loading={statsLoading}
          />
          <StatsCard
            title="Active Problem Statements"
            value={stats?.activeProblemStatements || 0}
            icon="document"
            color="green"
            loading={statsLoading}
          />
          <StatsCard
            title="Total Assignments"
            value={stats?.totalAssignments || 0}
            icon="task"
            color="purple"
            loading={statsLoading}
          />
        </motion.div>

        {/* System Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Team Statistics */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-2xl p-8"
          >
            <h2 className="text-xl font-display text-heading mb-6 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Team Management Overview
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Total Registered</span>
                <span className="text-blue-400 font-medium">
                  {stats?.registeredTeams || 0}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Selected Teams</span>
                <span className="text-green-400 font-medium">
                  {stats?.selectedTeams || 0}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Finalist Teams</span>
                <span className="text-purple-400 font-medium">
                  {stats?.finalistTeams || 0}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Total Teams</span>
                <span className="text-heading font-medium">
                  {stats?.totalTeams || 0}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Evaluator System */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-2xl p-8"
          >
            <h2 className="text-xl font-display text-heading mb-6 flex items-center gap-2">
              <Award className="w-5 h-5" />
              Evaluation System
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Total Evaluators</span>
                <span className="text-purple-400 font-medium">
                  {stats?.totalEvaluators || 0}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Active Evaluators</span>
                <span className="text-green-400 font-medium">
                  {stats?.activeEvaluators || 0}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Total Assignments</span>
                <span className="text-blue-400 font-medium">
                  {stats?.totalAssignments || 0}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Problem Statements</span>
                <span className="text-heading font-medium">
                  {stats?.activeProblemStatements || 0}
                </span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Results Publication */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className={`bg-gray-900/50 backdrop-blur-sm border rounded-2xl p-6 sm:p-8 ${
            resultsPublished ? "border-green-500/30" : "border-gray-800"
          }`}
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div
                className={`rounded-xl p-3 ${
                  resultsPublished ? "bg-green-500/20" : "bg-gray-800"
                }`}
              >
                {resultsPublished ? (
                  <Eye className="h-6 w-6 text-green-400" />
                ) : (
                  <EyeOff className="h-6 w-6 text-gray-400" />
                )}
              </div>
              <div>
                <h2 className="text-xl font-display text-heading mb-1">
                  Publish Results
                </h2>
                <p id="results-visibility-description" className="text-sm text-gray-400">
                  {resultsPublished
                    ? "Results are visible on the public results page and to team leaders."
                    : "Public and team-leader result data is currently hidden."}
                </p>
                {resultsVisibilityError && (
                  <p className="mt-2 text-sm text-red-400" role="alert">
                    {resultsVisibilityError}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 self-end sm:self-auto">
              <span
                className={`text-sm font-medium ${
                  resultsPublished ? "text-green-400" : "text-gray-400"
                }`}
              >
                {resultsVisibilityLoading
                  ? "Loading"
                  : resultsPublished
                    ? "Public"
                    : "Private"}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={resultsPublished}
                aria-describedby="results-visibility-description"
                aria-label="Publish results"
                disabled={resultsVisibilityLoading || resultsVisibilityUpdating}
                onClick={toggleResultsVisibility}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-heading focus:ring-offset-2 focus:ring-offset-gray-900 disabled:cursor-not-allowed disabled:opacity-50 ${
                  resultsPublished ? "bg-green-600" : "bg-gray-600"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    resultsPublished ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </motion.div>

        {/* Additional Controls */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-2xl p-8"
        >
          <h2 className="text-xl font-display text-heading mb-6">
            System Administration
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <button
              onClick={() => router.push("/admin/tasks")}
              className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors text-left"
            >
              <Settings className="w-6 h-6 text-gray-400 mb-2" />
              <h3 className="text-white font-medium mb-1">Task Management</h3>
              <p className="text-gray-400 text-sm">
                Create and manage team tasks
              </p>
              <div className="mt-2 text-purple-400 font-medium">
                {stats?.activeTasks || 0} Active Tasks
              </div>
            </button>

            <button
              onClick={() => router.push("/admin/register")}
              className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors text-left"
            >
              <Users className="w-6 h-6 text-gray-400 mb-2" />
              <h3 className="text-white font-medium mb-1">Add New Admin</h3>
              <p className="text-gray-400 text-sm">
                Register new administrators
              </p>
              <div className="mt-2 text-blue-400 font-medium">
                Super Admin & Evaluator
              </div>
            </button>

            <button
              onClick={() => router.push("/admin/analytics")}
              className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors text-left"
            >
              <TrendingUp className="w-6 h-6 text-gray-400 mb-2" />
              <h3 className="text-white font-medium mb-1">Analytics</h3>
              <p className="text-gray-400 text-sm">
                View system analytics and reports
              </p>
              <div className="mt-2 text-green-400 font-medium">Coming Soon</div>
            </button>
          </div>
        </motion.div>
      </div>
    </AdminLayout>
  );
}
