import { spawn } from "node:child_process";

// Opens an http(s) URL in the default browser. No shell is involved, so URLs with `&` or quotes are safe.
export function openBrowser(url: string): void {
  const { protocol } = new URL(url);
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error(`Refusing to open a non-web URL: ${url}`);
  }
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {}); // No browser available: the URL is printed for the user anyway.
  child.unref();
}
