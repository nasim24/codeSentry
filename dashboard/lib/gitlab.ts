// Posts comments back to GitLab MR from the dashboard

import { getSetting } from "@/lib/settings";

// Resolved per call so a token changed in the Settings UI applies at once.
function base(): string {
  const url = getSetting("GITLAB_URL").replace(/\/+$/, "");
  return `${url}/api/v4/projects/${getSetting("GITLAB_PROJECT_ID")}`;
}

function gitlabToken(): string {
  return getSetting("GITLAB_TOKEN");
}

export async function postCommentToMR(
  mr_iid: number,
  body: string
): Promise<{ success: boolean; note_id?: number; error?: string }> {
  try {
    const response = await fetch(
      `${base()}/merge_requests/${mr_iid}/notes`,
      {
        method:  "POST",
        headers: {
          "PRIVATE-TOKEN": gitlabToken()!,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({ body }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const data = await response.json();
    return { success: true, note_id: data.id };

  } catch (error) {
    return { success: false, error: String(error) };
  }
}