import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IDS } from "../mods/quota-manager/providers.js";

const dir = fileURLToPath(new URL("../mods/quota-manager/icons/", import.meta.url));
const tiles = {
  codex: ["#3B5BDB", "#F4F4F5"], agy: ["#1A73E8", "#F4F4F5"], grok: ["#F3F4F6", "#111827"],
  cursor: ["#0F766E", "#F4F4F5"], claude: ["#0369A1", "#F4F4F5"], copilot: ["#4338CA", "#F4F4F5"],
  kimi: ["#E0E7FF", "#312E81"], "opencode-go": ["#059669", "#F4F4F5"], zai: ["#4F46E5", "#F4F4F5"],
  minimax: ["#DB2777", "#F4F4F5"], alibaba: ["#C2410C", "#F4F4F5"], commandcode: ["#0891B2", "#F4F4F5"],
  mimo: ["#0284C7", "#F4F4F5"], deepseek: ["#1D4ED8", "#F4F4F5"], openrouter: ["#6366F1", "#F4F4F5"],
  elevenlabs: ["#FCE7F3", "#9D174D"], devin: ["#5B21B6", "#F4F4F5"], muse: ["#7E22CE", "#F4F4F5"],
  higgsfield: ["#B45309", "#F4F4F5"],
};
const banned = /<script|<style|foreignObject|<image|<use|<text|\sstyle\s*=|\sclass\s*=|http:|https:|javascript:|data:|\son[a-z]+\s*=/i;

test("icon files are local monogram tiles", async () => {
  const names = (await readdir(dir)).filter(name => name.endsWith(".svg")).sort();
  assert.deepEqual(names, [...IDS.map(id => `${id}.svg`), "refresh.svg", "settings.svg"].sort());
  let total = 0;
  for (const name of names) {
    const path = join(dir, name);
    const text = await readFile(path, "utf8");
    const info = await stat(path);
    total += info.size;
    assert.equal(banned.test(text), false, name);
    assert.ok(info.size < 2048, `${name} is ${info.size} bytes`);
    const id = name.slice(0, -4);
    if (id === "refresh" || id === "settings") {
      assert.match(text, /currentColor/);
      assert.equal(text.includes("<rect"), false, name);
    } else {
      assert.equal(text.includes("currentColor"), false, name);
      assert.match(text, /viewBox="0 0 16 16"/);
      assert.match(text, /rx="4"/);
      const [tile, ink] = tiles[id];
      assert.ok(text.includes(`fill="${tile}"`), name);
      assert.ok(text.includes(`fill="${ink}"`), name);
    }
  }
  assert.ok(total < 40960, `icon folder is ${total} bytes`);
});
