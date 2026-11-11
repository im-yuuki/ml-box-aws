/**
 * A JSON reader that reports duplicate keys. `JSON.parse` keeps the last value of a duplicated
 * key, so a translation that was added twice silently disappears from the app.
 */
export type DuplicateKey = { path: string; key: string };

export function findDuplicateKeys(text: string): DuplicateKey[] {
  const duplicates: DuplicateKey[] = [];
  const path: string[] = [];
  let index = 0;

  const skipWhitespace = () => {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  };

  const readString = (): string => {
    index += 1; // the opening quote
    let out = "";
    while (index < text.length) {
      const character = text[index];
      if (character === "\\") {
        out += JSON.parse(`"${text.slice(index, index + 2)}"`) as string;
        index += 2;
        continue;
      }
      if (character === '"') {
        index += 1;
        return out;
      }
      out += character;
      index += 1;
    }
    throw new Error("Unterminated string in JSON");
  };

  const readValue = (): unknown => {
    skipWhitespace();
    const character = text[index];
    if (character === "{") return readObject();
    if (character === "[") return readArray();
    if (character === '"') return readString();
    const start = index;
    while (index < text.length && !/[,\]}\s]/.test(text[index])) index += 1;
    return text.slice(start, index);
  };

  const readObject = (): Record<string, unknown> => {
    index += 1; // the opening brace
    const seen = new Set<string>();
    const object: Record<string, unknown> = {};
    skipWhitespace();
    if (text[index] === "}") {
      index += 1;
      return object;
    }
    while (index < text.length) {
      skipWhitespace();
      const key = readString();
      if (seen.has(key)) duplicates.push({ path: [...path, key].join("."), key });
      seen.add(key);
      skipWhitespace();
      index += 1; // the colon
      path.push(key);
      object[key] = readValue();
      path.pop();
      skipWhitespace();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "}") {
        index += 1;
        return object;
      }
      throw new Error(`Unexpected character "${text[index]}" in JSON`);
    }
    return object;
  };

  const readArray = (): unknown[] => {
    index += 1; // the opening bracket
    const list: unknown[] = [];
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      return list;
    }
    while (index < text.length) {
      list.push(readValue());
      skipWhitespace();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "]") {
        index += 1;
        return list;
      }
      throw new Error(`Unexpected character "${text[index]}" in JSON`);
    }
    return list;
  };

  readValue();
  return duplicates;
}
