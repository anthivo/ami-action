import { describe, expect, it } from "vitest";

import { PINNED_CLI_VERSION } from "./action.js";
import { realDependencies } from "./main.js";
import { type ActionDependencies, runAction } from "./run.js";
import { join } from "node:path";

const TOKEN = `anth_${"0123456789abcdef".repeat(4)}`;
const PREFIX = join("/runner/_temp", `anthivo-cli-${PINNED_CLI_VERSION}`);
const SUMMARY = "/runner/_temp/_runner_file_commands/step_summary_1";

interface Recorded {
  log: string[];
  npm: { args: string[]; cwd: string; env: Record<string, string | undefined> }[];
  cli: { file: string; args: string[]; env: Record<string, string | undefined>; cwd: string }[];
  /** Every log line, in order, with the CLI's own run marked where it happened. */
  order: string[];
}

/** The Action's steps with stand-ins for npm and the CLI, recording every line the job's log would get. */
async function action(
  env: Record<string, string | undefined>,
  {
    npm = 0,
    manifest = { name: "anthivo", version: PINNED_CLI_VERSION, bin: { anthivo: "dist/index.js" } },
    cli = 0,
    output = [],
  }: { npm?: number | null; manifest?: unknown; cli?: number | null; output?: string[] } = {},
) {
  const recorded: Recorded = { log: [], npm: [], cli: [], order: [] };
  const deps: ActionDependencies = {
    env,
    log: (text) => {
      recorded.log.push(text);
      recorded.order.push(text);
    },
    write: (chunk) => {
      recorded.order.push(`<the CLI wrote> ${Buffer.from(chunk).toString("utf8")}`);
    },
    randomWord: () => "anthivo-0f1e2d3c",
    folder: (version) => join("/runner/_temp", `anthivo-cli-${version}`),
    npm: async (args, cwd, npmEnv) => {
      recorded.npm.push({ args, cwd, env: npmEnv });
      return npm;
    },
    readManifest: () => manifest,
    cli: async (file, args, cliEnv, cwd, written) => {
      recorded.cli.push({ file, args, env: cliEnv, cwd });
      recorded.order.push("<the CLI runs>");
      for (const chunk of output) written(Buffer.from(chunk, "utf8"));
      return cli;
    },
  };
  const code = await runAction(deps);
  return { code, ...recorded };
}

const JOB = {
  INPUT_TOKEN: TOKEN,
  "INPUT_CLI-VERSION": PINNED_CLI_VERSION,
  "INPUT_RUN-ON-FORKS": "false",
  INPUT_SERVER: "https://www.anthivo.com",
  GITHUB_ACTIONS: "true",
  GITHUB_WORKSPACE: "/home/runner/work/shop/shop",
  GITHUB_STEP_SUMMARY: SUMMARY,
};

describe("the Action's steps", () => {
  it("masks the token before anything else, installs the pinned CLI, and runs it from the checkout with the token in its environment", async () => {
    const run = await action(JOB);
    expect(run.code).toBe(0);
    expect(run.log[0]).toBe(`::add-mask::${TOKEN}\n`);
    expect(run.npm).toEqual([
      {
        args: [
          "install",
          "--prefix",
          PREFIX,
          "--no-save",
          "--no-package-lock",
          "--no-audit",
          "--no-fund",
          "--ignore-scripts",
          "--loglevel=error",
          `anthivo@${PINNED_CLI_VERSION}`,
        ],
        cwd: PREFIX,
        env: expect.not.objectContaining({ INPUT_TOKEN: TOKEN }),
      },
    ]);
    expect(run.cli).toEqual([
      {
        file: join(PREFIX, "node_modules", "anthivo", "dist/index.js"),
        args: ["run", "--fetch-base", "--markdown", SUMMARY],
        env: expect.objectContaining({ ANTHIVO_TOKEN: TOKEN, ANTHIVO_URL: "https://www.anthivo.com" }),
        cwd: JOB.GITHUB_WORKSPACE,
      },
    ]);
  });

  it("keeps the token out of every argument and every line it writes but the mask itself", async () => {
    const run = await action(JOB);
    expect(JSON.stringify(run.npm)).not.toContain(TOKEN);
    expect(run.cli.flatMap((call) => [call.file, ...call.args]).join(" ")).not.toContain(TOKEN);
    expect(run.log.filter((line) => line.includes(TOKEN))).toEqual([`::add-mask::${TOKEN}\n`]);
    expect(Object.keys(run.cli[0]?.env ?? {}).filter((name) => name.startsWith("INPUT_"))).toEqual([]);
  });

  it("stops workflow commands while the CLI's output reaches the log, and resumes them after with a word nobody could guess", async () => {
    const run = await action(JOB);
    const stop = run.order.indexOf("::stop-commands::anthivo-0f1e2d3c\n");
    const cli = run.order.indexOf("<the CLI runs>");
    const resume = run.order.indexOf("::anthivo-0f1e2d3c::\n");
    expect(stop).toBeGreaterThan(0);
    expect(cli).toBeGreaterThan(stop);
    expect(resume).toBeGreaterThan(cli);
  });

  it("starts the resume on a line of its own when the CLI's output didn't end its last line", async () => {
    const open = await action(JOB, { cli: 1, output: ["Run #12 failed\n", "DEF-3 (medium, new) no line break"] });
    const resume = open.order.indexOf("::anthivo-0f1e2d3c::\n");
    expect(open.order.slice(resume - 2, resume + 2)).toEqual([
      "<the CLI wrote> DEF-3 (medium, new) no line break",
      "\n",
      "::anthivo-0f1e2d3c::\n",
      "::error title=Anthivo::A new defect at or above fail-on. The job summary lists it.\n",
    ]);
    // Output that ended its line gets no blank line before the resume.
    const closed = await action(JOB, { output: ["Run #12 passed\n"] });
    const after = closed.order.indexOf("::anthivo-0f1e2d3c::\n");
    expect(closed.order[after - 1]).toBe("<the CLI wrote> Run #12 passed\n");
  });

  it("fails the job on the CLI's exit 1 and 2, each with the Action's own annotation, and passes on 0", async () => {
    expect((await action(JOB, { cli: 0 })).log.some((line) => line.startsWith("::error"))).toBe(false);
    const failed = await action(JOB, { cli: 1 });
    expect(failed.code).toBe(1);
    expect(failed.log.at(-1)).toBe(
      "::error title=Anthivo::A new defect at or above fail-on. The job summary lists it.\n",
    );
    const unfinished = await action(JOB, { cli: 2 });
    expect(unfinished.code).toBe(2);
    expect(unfinished.log.at(-1)).toBe("::error title=Anthivo::The check ended without a verdict. The log says why.\n");
    expect((await action(JOB, { cli: null })).code).toBe(2);
  });

  it("runs pull requests from forks only when the workflow opts in", async () => {
    expect((await action(JOB)).cli[0]?.args).not.toContain("--forks");
    expect((await action({ ...JOB, "INPUT_RUN-ON-FORKS": "true" })).cli[0]?.args).toContain("--forks");
  });

  it("fails without running anything for a version that isn't exact, an install that failed, or anything but that CLI", async () => {
    const latest = await action({ ...JOB, "INPUT_CLI-VERSION": "latest" });
    expect(latest.code).toBe(2);
    expect(latest.npm).toEqual([]);
    expect(latest.log.join("")).toContain("cli-version must be an exact version");

    const offline = await action(JOB, { npm: 1 });
    expect(offline.code).toBe(2);
    expect(offline.cli).toEqual([]);

    const other = await action(JOB, {
      manifest: { name: "anthivo", version: "9.9.9", bin: { anthivo: "dist/index.js" } },
    });
    expect(other.code).toBe(2);
    expect(other.cli).toEqual([]);
    expect(other.log.join("")).toContain(`npm installed something other than anthivo@${PINNED_CLI_VERSION}.`);
  });
});

// The Action's real wiring (main.ts), as the runner starts it: the word that resumes workflow commands after the CLI's
// output must be fresh and unguessable on every run, or the tested app's text, printed through the CLI, could resume
// them itself. The steps' own tests hand runAction a word of their own, so they can't see this.

const UUID_WORD = /^anthivo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("the Action's real wiring", () => {
  it("makes a fresh word nobody can guess each time, to resume workflow commands", () => {
    const { randomWord } = realDependencies();
    const words = Array.from({ length: 20 }, () => randomWord());
    expect(new Set(words).size).toBe(words.length);
    for (const word of words) expect(word).toMatch(UUID_WORD);
  });

  it("stops and resumes workflow commands around the CLI with that word, a new one on every run", async () => {
    const real = realDependencies();
    const runOnce = async () => {
      const log: string[] = [];
      await runAction({
        ...real,
        env: {
          INPUT_TOKEN: `anth_${"0123456789abcdef".repeat(4)}`,
          "INPUT_CLI-VERSION": PINNED_CLI_VERSION,
          "INPUT_RUN-ON-FORKS": "false",
          INPUT_SERVER: "https://www.anthivo.com",
          GITHUB_ACTIONS: "true",
          GITHUB_WORKSPACE: "/home/runner/work/shop/shop",
        },
        log: (text) => log.push(text),
        write: () => undefined,
        folder: () => "/runner/_temp/anthivo-cli",
        npm: async () => 0,
        readManifest: () => ({ name: "anthivo", version: PINNED_CLI_VERSION, bin: { anthivo: "dist/index.js" } }),
        cli: async () => 0,
      });
      const stop = log.find((line) => line.startsWith("::stop-commands::")) ?? "";
      const word = stop.slice("::stop-commands::".length, -1);
      expect(word).toMatch(UUID_WORD);
      expect(log.indexOf(`::${word}::\n`)).toBeGreaterThan(log.indexOf(stop));
      return word;
    };
    expect(await runOnce()).not.toBe(await runOnce());
  });
});
