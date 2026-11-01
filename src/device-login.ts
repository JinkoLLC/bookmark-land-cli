import { ApiError, request } from "./api.ts";
import { CliError, EXIT } from "./errors.ts";
import type { DeviceCode, DeviceToken } from "./types.ts";

// Without `scopes`, the server grants its default Scopes.
export function startDeviceLogin(
  apiUrl: string,
  options: { scopes?: string[]; clientName: string },
): Promise<DeviceCode> {
  return request<DeviceCode>(apiUrl, "/auth/device", {
    method: "POST",
    body: { scopes: options.scopes, client_name: options.clientName },
  });
}

// Polls until the user approves or denies the User code in the browser, or it expires.
export async function pollForToken(
  apiUrl: string,
  device: DeviceCode,
): Promise<DeviceToken> {
  let interval = device.interval;
  const deadline = Date.now() + device.expires_in * 1000;
  // Stop as soon as the next poll would come after the User code expires.
  while (Date.now() + interval * 1000 < deadline) {
    await sleep(interval * 1000);
    try {
      return await request<DeviceToken>(apiUrl, "/auth/device/token", {
        method: "POST",
        body: { device_code: device.device_code },
        // A slow answer must not keep login waiting after the User code expires.
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    } catch (err) {
      if (!(err instanceof CliError)) throw err;
      const code = err.code.toUpperCase();
      if (code === "AUTHORIZATION_PENDING" || code === "NETWORK_ERROR")
        continue;
      if (err instanceof ApiError && err.status === 429) continue;
      if (code === "SLOW_DOWN") {
        interval += 5; // RFC 8628 section 3.5
        continue;
      }
      if (code === "ACCESS_DENIED") {
        throw new CliError(
          `Login was not approved: ${err.message}`,
          EXIT.auth,
          "ACCESS_DENIED",
        );
      }
      if (code === "EXPIRED_TOKEN") throw expired();
      throw err;
    }
  }
  throw expired();
}

const expired = () =>
  new CliError(
    "The User code expired. Run: bookmark login",
    EXIT.auth,
    "EXPIRED_TOKEN",
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
