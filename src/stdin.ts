export async function readStdin(): Promise<string> {
  let text = "";
  process.stdin.setEncoding("utf8"); // decode across chunks, so a split multi-byte character survives
  for await (const chunk of process.stdin) text += chunk;
  return text;
}
