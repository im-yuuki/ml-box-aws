import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { findDuplicateKeys } from "./jsonKeys.ts";

const messagesDir = new URL("../messages/", import.meta.url);
const sourceDir = new URL("../", import.meta.url);

// The message files are the one place where a duplicated key silently kills a translation:
// JSON.parse keeps the last value, so the app shows an older wording without any error.
for (const file of ["en.json", "vi.json"]) {
  test(`the message file ${file} has no duplicated key`, () => {
    const text = readFileSync(new URL(file, messagesDir), "utf8");
    assert.deepEqual(findDuplicateKeys(text), []);
  });
}

test("a duplicated key is found with its path", () => {
  assert.deepEqual(findDuplicateKeys('{"a": {"b": 1, "b": 2}}'), [{ path: "a.b", key: "b" }]);
  assert.deepEqual(findDuplicateKeys('{"a": 1, "a": 2}'), [{ path: "a", key: "a" }]);
  assert.deepEqual(findDuplicateKeys('{"a": [{"b": 1}, {"b": 2}]}'), []);
});

function sourceFiles(dir: URL, out: URL[] = []): URL[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Every key a component reads has to exist. next-intl prints the key itself when it does not, so
// the user sees "navbar.createOrganizationSuccess" instead of a sentence.
test("every key a component reads exists in both message files", () => {
  const en = JSON.parse(readFileSync(new URL("en.json", messagesDir), "utf8")) as Record<string, Record<string, unknown>>;
  const vi = JSON.parse(readFileSync(new URL("vi.json", messagesDir), "utf8")) as Record<string, Record<string, unknown>>;

  const files = sourceFiles(sourceDir).filter((file) => /components|app|hooks/.test(file.pathname));
  const missing: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // Each translate function of the file knows its namespace: const t = useTranslations("teams").
    const bindings = new Map<string, string>();
    for (const match of source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*useTranslations\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)/g)) {
      bindings.set(match[1], match[2]);
    }
    if (bindings.size === 0) continue;

    for (const [variable, namespace] of bindings) {
      const group = en[namespace];
      if (!group) {
        missing.push(`${namespace} (namespace missing in en.json)`);
        continue;
      }
      // The keys the file reads through this variable: t("key") and t(`prefix${...}`).
      const calls = [...source.matchAll(new RegExp(`\\b${variable}\\(\\s*["'\`]([a-zA-Z0-9_]+)["'\`]`, "g"))].map((match) => match[1]);
      const prefixes = [...source.matchAll(new RegExp(`\\b${variable}\\(\\s*\`([a-zA-Z0-9_]+)\\$\\{`, "g"))].map((match) => match[1]);
      for (const key of calls) {
        if (!(key in group)) missing.push(`${namespace}.${key} (missing in en.json)`);
        if (!(key in (vi[namespace] ?? {}))) missing.push(`${namespace}.${key} (missing in vi.json)`);
      }
      for (const prefix of prefixes) {
        // A key built from a variable, e.g. t(`roles.${role}`): at least one key has to start with
        // the prefix.
        const hasKey = Object.keys(group).some((key) => key === prefix || key.startsWith(prefix));
        if (!hasKey) missing.push(`${namespace}.${prefix}* (prefix missing in en.json)`);
      }
    }
  }

  assert.deepEqual(missing, []);
});
