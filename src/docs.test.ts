import { describe, expect, it } from "vitest";

import { DEFAULT_SERVER, PINNED_CLI_VERSION } from "./action.js";
import { readFileSync } from "node:fs";

// What a workflow author reads and copies: action.yml and the README. The token only ever comes from the repository's
// secrets, and nothing documents running a fork's code with the repository's secrets.

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const manifest = read("action.yml");
const readme = read("README.md");

/** An input's block in action.yml: its lines up to the next input. */
function inputBlock(name: string) {
  const start = manifest.indexOf(`\n  ${name}:\n`);
  if (start < 0) return null;
  const rest = manifest.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n|\nruns:/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("action.yml", () => {
  it("takes the inputs the README lists, runs on Node 24, and pins the CLI version the Action was tested with", () => {
    const inputs = [...manifest.matchAll(/^ {2}([a-z-]+):$/gm)].map((match) => match[1]);
    expect(inputs).toEqual([
      "token",
      "project",
      "environment",
      "url",
      "fail-on",
      "run-on-forks",
      "server",
      "cli-version",
    ]);
    for (const input of inputs) expect(readme).toContain(`| \`${input}\` |`);
    expect(inputBlock("cli-version")).toContain(`default: "${PINNED_CLI_VERSION}"`);
    expect(inputBlock("run-on-forks")).toContain('default: "false"');
    expect(inputBlock("server")).toContain(`default: ${DEFAULT_SERVER}`);
    expect(inputBlock("token")).toContain("required: true");
    expect(inputBlock("token")).not.toContain("default:");
    expect(manifest).toMatch(/^runs:\n {2}using: node24\n {2}main: dist\/main\.js\n?$/m);
  });
});

describe("the README", () => {
  it("passes the token only from the repository's secrets, and never shows one", () => {
    const tokens = [...readme.matchAll(/^\s*token:\s*(.+)$/gm)].map((match) => match[1]?.trim());
    expect(tokens.length).toBeGreaterThan(0);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub's own expression, as a workflow writes it.
    for (const value of tokens) expect(value).toBe("${{ secrets.ANTHIVO_TOKEN }}");
    for (const text of [readme, manifest]) {
      expect(text).not.toMatch(/anth_[0-9a-f]{8,}/);
      // A job's own variable, if a workflow sets one, comes from the secrets too.
      expect(text).not.toMatch(/^\s*ANTHIVO_TOKEN:\s*(?!\$\{\{\s*secrets\.)/m);
    }
  });

  it("documents pull_request and push only: never pull_request_target, which runs with the repository's secrets", () => {
    for (const text of [readme, manifest]) expect(text).not.toContain("pull_request_target");
    expect(readme).toContain("  pull_request:\n");
    expect(readme).toContain("Pull requests from forks are skipped");
  });

  it("names the pinned CLI only as the default, and says the version is exact, never latest", () => {
    expect(readme).toContain("exact version");
    expect(readme).not.toMatch(/cli-version:\s*latest/);
  });
});
