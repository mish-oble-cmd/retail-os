/**
 * Virtual ESC/POS printer (approved Phase 0 substitute for real hardware).
 * Listens on the standard raw-print port, decodes the byte stream to readable
 * text, and prints the "paper" to the terminal.
 *
 * Usage: node tools/virtual-escpos-printer.mjs [port]
 * Then in the app (or a REPL): print a test receipt at host 127.0.0.1.
 */
import { createServer } from "node:net";

const port = Number(process.argv[2] ?? 9100);

export function decodeEscPos(buffer) {
  const lines = [];
  let current = "";
  let cut = false;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte === 0x1b) {
      i += 1 + (buffer[i + 1] === 0x40 ? 0 : 1); // ESC @ = 1 arg-less; others take 1 param
      continue;
    }
    if (byte === 0x1d) {
      if (buffer[i + 1] === 0x56) cut = true;
      i += 2;
      continue;
    }
    if (byte === 0x0a) {
      lines.push(current);
      current = "";
      continue;
    }
    if (byte >= 0x20 && byte <= 0x7e) current += String.fromCharCode(byte);
  }
  if (current) lines.push(current);
  return { lines, cut };
}

const server = createServer((socket) => {
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.on("end", () => {
    const data = Buffer.concat(chunks);
    const { lines, cut } = decodeEscPos(data);
    console.log("┌──────── 80mm paper ────────┐");
    for (const line of lines) console.log(`│ ${line.padEnd(26).slice(0, 26)} │`);
    console.log("└────────────────────────────┘");
    console.log(`received ${data.length} bytes${cut ? " · paper cut ✂" : ""}`);
  });
});

server.listen(port, () => console.log(`virtual ESC/POS printer listening on :${port}`));
