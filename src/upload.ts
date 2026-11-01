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

// Fetches a file from a one-time download URL from the API. Like uploads, it never carries the
// Token, and the URL is never printed: anyone holding it can download the file.
export async function downloadFile(url: string): Promise<Uint8Array> {
  let res: Response;
  let bytes: ArrayBuffer;
  try {
    res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    bytes = await res.arrayBuffer();
  } catch (err) {
    const cause = (err as { cause?: Error }).cause?.message;
    throw new CliError(
      `Could not download the file: ${cause ?? (err as Error).message}`,
      undefined,
      "DOWNLOAD_FAILED",
    );
  }
  if (!res.ok) {
    throw new CliError(
      `The download failed (${res.status} ${res.statusText}). Run the command again.`,
      undefined,
      "DOWNLOAD_FAILED",
    );
  }
  return new Uint8Array(bytes);
}
