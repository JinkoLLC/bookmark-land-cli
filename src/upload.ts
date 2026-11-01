import { USER_AGENT } from "./api.ts";
import { CliError } from "./errors.ts";

// Sends a file to a one-time upload URL from the API. It goes to the storage service, not the
// API, so it never carries the Token.
export async function uploadFile(
  uploadUrl: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<string> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "content-type": contentType, "user-agent": USER_AGENT },
      body: bytes,
    });
    text = await res.text();
  } catch (err) {
    const cause = (err as { cause?: Error }).cause?.message;
    throw new CliError(
      `Could not upload the file: ${cause ?? (err as Error).message}`,
      undefined,
      "UPLOAD_FAILED",
    );
  }
  let storageId: unknown;
  try {
    storageId = JSON.parse(text).storageId;
  } catch {}
  if (!res.ok || typeof storageId !== "string") {
    throw new CliError(
      `The upload failed (${res.status} ${res.statusText}). Run the command again.`,
      undefined,
      "UPLOAD_FAILED",
    );
  }
  return storageId;
}
