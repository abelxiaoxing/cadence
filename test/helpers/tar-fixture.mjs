// Small regular/special tar records for deterministic packaging regressions.
export function header(name, type = 48, body = "ok") {
  const b = Buffer.alloc(512);
  b.write(name);
  b.write("0000644\0", 100);
  b.write("0000000\0", 108);
  b.write("0000000\0", 116);
  b.write(`${Buffer.byteLength(body).toString(8).padStart(11, "0")}\0`, 124);
  b.fill(32, 148, 156);
  b[156] = type;
  b.write("ustar\0", 257);
  b.write(
    `${b
      .reduce((sum, x) => sum + x, 0)
      .toString(8)
      .padStart(6, "0")}\0 `,
    148,
  );
  return Buffer.concat([
    b,
    Buffer.from(body),
    Buffer.alloc((512 - (Buffer.byteLength(body) % 512)) % 512),
  ]);
}
