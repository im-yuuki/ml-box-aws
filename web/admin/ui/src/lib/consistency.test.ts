import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { detectLocale } from "../i18n/config.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, ...parts), "utf8");

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

test("the colours and motion come from the shared token file, not a copy that drifted", () => {
  const source = read("..", "..", "..", "..", "theme", "tokens", "heroui-tokens.css");
  const copy = read("..", "styles", "heroui-tokens.css");
  assert.equal(copy, source, "run: cp web/theme/tokens/heroui-tokens.css web/admin/ui/src/styles/heroui-tokens.css");
});

test("no stylesheet of the console hard-codes a colour", () => {
  const css = read("..", "app", "globals.css");
  const literal = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/g);
  assert.equal(literal, null, `use a token instead of ${literal?.join(", ")}`);
});

test("English and Vietnamese messages have exactly the same keys", () => {
  const en = keys(JSON.parse(read("..", "messages", "en.json"))).sort();
  const vi = keys(JSON.parse(read("..", "messages", "vi.json"))).sort();
  assert.deepEqual(vi, en);
});

test("the locale follows the stored choice, then the browser language", () => {
  assert.equal(detectLocale("vi", ["en-US"]), "vi");
  assert.equal(detectLocale(null, ["vi-VN", "en"]), "vi");
  assert.equal(detectLocale(null, ["fr-FR"]), "en");
  assert.equal(detectLocale("de", ["en"]), "en");
});
