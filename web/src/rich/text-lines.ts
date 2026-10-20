/** Source offsets identify immutable displayed text lines, including repeated/blank lines. */
export function textLines(
  text: string,
): { key: string; number: number; text: string }[] {
  let offset = 0,
    number = 0;
  return text.split("\n").map((line) => {
    const row = { key: `text-offset:${offset}`, number: ++number, text: line };
    offset += line.length + 1;
    return row;
  });
}
