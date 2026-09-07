import { SystemSettings } from "@/models/SystemSettings";

const GLOBAL_SETTINGS_KEY = "global";

export async function areResultsPublished(): Promise<boolean> {
  const settings = await SystemSettings.findOne({ key: GLOBAL_SETTINGS_KEY })
    .select("resultsPublished")
    .lean();

  // Results stay private until a superadmin explicitly publishes them.
  return settings?.resultsPublished === true;
}

export function getLeaderVisibleTeamStatus(
  status: string,
  resultsPublished: boolean
): string {
  return resultsPublished ? status : "registered";
}
