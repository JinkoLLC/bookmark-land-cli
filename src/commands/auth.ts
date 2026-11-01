import { hostname } from "node:os";
import { createInterface } from "node:readline/promises";
import { ApiError, request } from "../api.ts";
import {
  DEFAULT_SCOPES,
  deleteToken,
  getToken,
  notLoggedIn,
  saveToken,
} from "../auth.ts";
import { openBrowser } from "../browser.ts";
import type { Command } from "../cli.ts";
import { pollForToken, startDeviceLogin } from "../device-login.ts";
import { usageError } from "../errors.ts";
import { info, printFields, printJson, success, warn } from "../output.ts";
import { readStdin } from "../stdin.ts";
import type { DeviceCode, Envelope, Me } from "../types.ts";

const verify = async (apiUrl: string, token: string) =>
  (await request<Envelope<Me>>(apiUrl, "/auth/verify", { token })).data;

// Prompts only on a terminal; otherwise prints what the user needs to approve from another device.
async function waitForApproval(device: DeviceCode): Promise<void> {
  warn(`Your User code: ${device.user_code}`);
  if (process.stdin.isTTY && process.stderr.isTTY) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    await rl.question(
      `Press Enter to open ${device.verification_uri} in your browser...`,
    );
    rl.close();
    openBrowser(device.verification_uri_complete);
  } else {
    info(`Open ${device.verification_uri_complete} in a browser to approve.`);
  }
  info("Waiting for approval...");
}

export const authCommands: Command[] = [
  {
    name: "login",
    summary: "Log in to bookmark.land in your browser",
    flags: {
      scopes: {
        type: "string",
        description:
          "Extra comma-separated Scopes on top of the defaults: destructive, import, export",
      },
      "client-name": {
        type: "string",
        description:
          "Name this login is listed under in Settings (default: this computer's hostname)",
      },
      "with-token": {
        type: "boolean",
        description:
          "Read a Token from stdin instead of logging in with the browser",
      },
    },
    async run(ctx, _args, flags) {
      let token: string;
      if (flags["with-token"]) {
        token = (await readStdin()).trim();
        if (!token) {
          throw usageError(
            "No Token on stdin. Usage: echo $TOKEN | bookmark login --with-token",
          );
        }
      } else {
        const extra = (flags.scopes as string | undefined)
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const device = await startDeviceLogin(ctx.apiUrl, {
          scopes: extra
            ? [...new Set([...DEFAULT_SCOPES, ...extra])]
            : undefined,
          clientName:
            (flags["client-name"] as string | undefined) ?? hostname(),
        });
        await waitForApproval(device);
        token = (await pollForToken(ctx.apiUrl, device)).access_token;
      }
      const me = await verify(ctx.apiUrl, token); // also rejects a bad --with-token before it is stored
      const storedIn = await saveToken(ctx.apiUrl, token);
      if (ctx.json) printJson(me);
      else
        success(
          `Logged in as ${me.name ?? me.email ?? me.userId} (Token saved in ${storedIn})`,
        );
      if (process.env.BOOKMARK_TOKEN?.trim()) {
        warn("BOOKMARK_TOKEN is set, so it is used instead of this login.");
      }
    },
  },
  {
    name: "logout",
    summary: "Revoke this computer's Token and forget it",
    async run(ctx) {
      const found = await getToken(ctx.apiUrl);
      if (!found) throw notLoggedIn();
      if (found.source === "BOOKMARK_TOKEN") {
        throw usageError(
          "The Token comes from BOOKMARK_TOKEN. Unset it to log out, and revoke it in Settings if needed.",
        );
      }
      let data: unknown = null;
      try {
        ({ data } = await request<Envelope<unknown>>(
          ctx.apiUrl,
          "/auth/token",
          { method: "DELETE", token: found.token },
        ));
      } catch (err) {
        // Already revoked on the server: just forget it locally.
        if (!(err instanceof ApiError && err.status === 401)) throw err;
      }
      await deleteToken(ctx.apiUrl);
      if (ctx.json) printJson(data);
      else success(`Logged out of ${new URL(ctx.apiUrl).host}`);
    },
  },
  {
    name: "whoami",
    summary: "Show the account you are logged in as",
    async run(ctx) {
      const found = await getToken(ctx.apiUrl);
      if (!found) throw notLoggedIn();
      const me = await verify(ctx.apiUrl, found.token);
      if (ctx.json) return printJson(me);
      printFields([
        ["Name", me.name],
        ["Email", me.email],
        ["Plan", me.plan],
        ["Token", found.source],
        ["API", ctx.apiUrl],
      ]);
    },
  },
];
