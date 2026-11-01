import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

test("stdin keeps a multi-byte character that arrives in two chunks", async () => {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { readStdin } from ${JSON.stringify(new URL("../src/stdin.ts", import.meta.url).href)};
       process.stdout.write(await readStdin());`,
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  let out = "";
  child.stdout.setEncoding("utf8").on("data", (d) => {
    out += d;
  });
  const bytes = Buffer.from("é", "utf8");
  child.stdin.write(bytes.subarray(0, 1));
  await new Promise((resolve) => setTimeout(resolve, 100));
  child.stdin.end(bytes.subarray(1));
  await new Promise((resolve) => child.on("close", resolve));
  assert.equal(out, "é");
});
