import { NextResponse } from "next/server";
import { getUserKey } from "@/lib/devops/boardFactory";
import { WorkItemError } from "@/lib/devops/repository";

/** The caller's user key, or a 401 response to return. */
export async function requireUser(headers: Headers): Promise<string | NextResponse> {
  try {
    const key = await getUserKey(headers);
    if (key) return key;
  } catch (err) {
    if (!(err instanceof WorkItemError)) throw err;
  }
  return NextResponse.json({ error: "You need to sign in to Azure DevOps." }, { status: 401 });
}
