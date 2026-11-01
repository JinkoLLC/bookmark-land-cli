import { request } from "../api.ts";
import { getToken, notLoggedIn } from "../auth.ts";
import type { Command } from "../cli.ts";
import { printFields, printJson } from "../output.ts";
import type { Envelope, Me } from "../types.ts";

export const authCommands: Command[] = [
  {
    name: "whoami",
    summary: "Show the account you are logged in as",
    async run(ctx) {
      const found = getToken();
      if (!found) throw notLoggedIn();
      const { data: me } = await request<Envelope<Me>>(
        ctx.apiUrl,
        "/auth/verify",
        { token: found.token },
      );
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
