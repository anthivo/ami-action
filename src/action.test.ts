import { describe, expect, it } from "vitest";

import {
  cliArguments,
  cliEnvironment,
  DEFAULT_SERVER,
  InputError,
  installArguments,
  installEnvironment,
  installedBin,
  jobExitCode,
  PINNED_CLI_VERSION,
  readInputs,
  resultAnnotation,
} from "./action.js";

const TOKEN = `anth_${"0123456789abcdef".repeat(4)}`;

/** The job's environment as GitHub's runner gives it to the Action: its inputs as INPUT_ variables, and its own. */
const JOB = {
  INPUT_TOKEN: TOKEN,
  INPUT_PROJECT: "PRJ-3",
  INPUT_ENVIRONMENT: "Staging",
  INPUT_URL: "https://pr-7.staging.example.com",
  "INPUT_FAIL-ON": "high",
  "INPUT_RUN-ON-FORKS": "false",
  INPUT_SERVER: DEFAULT_SERVER,
  "INPUT_CLI-VERSION": PINNED_CLI_VERSION,
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_EVENT_PATH: "/home/runner/work/_temp/_github_workflow/event.json",
  GITHUB_STEP_SUMMARY: "/home/runner/work/_temp/_runner_file_commands/step_summary_1",
  PATH: "/usr/bin",
};

describe("the Action's inputs", () => {
  it("reads each input as the runner passes it, with the defaults action.yml gives", () => {
    expect(readInputs(JOB)).toEqual({
      token: TOKEN,
      project: "PRJ-3",
      environment: "Staging",
      url: "https://pr-7.staging.example.com",
      failOn: "high",
      runOnForks: false,
      server: DEFAULT_SERVER,
      cliVersion: PINNED_CLI_VERSION,
    });
    expect(readInputs({ INPUT_TOKEN: TOKEN })).toMatchObject({
      project: null,
      environment: null,
      url: null,
      failOn: null,
      runOnForks: false,
      server: DEFAULT_SERVER,
      cliVersion: PINNED_CLI_VERSION,
    });
  });

  it("runs the CLI at an exact version only: the pinned one unless the workflow names another, never a range or latest", () => {
    expect(readInputs({ "INPUT_CLI-VERSION": "0.2.1" }).cliVersion).toBe("0.2.1");
    expect(readInputs({ "INPUT_CLI-VERSION": "1.0.0-rc.1" }).cliVersion).toBe("1.0.0-rc.1");
    for (const version of [
      "latest",
      "next",
      "^0.1.0",
      "~0.1.0",
      "0.1",
      "0.1.x",
      ">=0.1.0",
      "0.1.0 || 1.0.0",
      "file:../cli",
      "./anthivo-0.1.0.tgz",
      "https://example.com/anthivo.tgz",
      "github:anthivo/cli",
      "01.0.0",
    ]) {
      expect(() => readInputs({ "INPUT_CLI-VERSION": version }), version).toThrow(InputError);
    }
  });

  it("runs pull requests from forks only when the workflow says true, and refuses words that aren't true or false", () => {
    for (const word of ["true", "True", "TRUE"])
      expect(readInputs({ "INPUT_RUN-ON-FORKS": word }).runOnForks).toBe(true);
    for (const word of ["false", "False", "FALSE", ""])
      expect(readInputs({ "INPUT_RUN-ON-FORKS": word }).runOnForks).toBe(false);
    for (const word of ["yes", "1", "on"])
      expect(() => readInputs({ "INPUT_RUN-ON-FORKS": word }), word).toThrow(InputError);
  });
});

describe("how the Action runs the CLI", () => {
  it("passes the options the inputs give, and never the token as an argument", () => {
    const args = cliArguments(readInputs(JOB), JOB.GITHUB_STEP_SUMMARY);
    expect(args).toEqual([
      "run",
      "--fetch-base",
      "--project",
      "PRJ-3",
      "--env",
      "Staging",
      "--url",
      "https://pr-7.staging.example.com",
      "--fail-on",
      "high",
      "--markdown",
      JOB.GITHUB_STEP_SUMMARY,
    ]);
    expect(args.join(" ")).not.toContain(TOKEN);
    expect(cliArguments(readInputs({ INPUT_TOKEN: TOKEN }), undefined)).toEqual(["run", "--fetch-base"]);
  });

  it("asks the CLI to run a fork's pull request only when the repository opts in", () => {
    expect(cliArguments(readInputs(JOB), undefined)).not.toContain("--forks");
    expect(cliArguments(readInputs({ ...JOB, "INPUT_RUN-ON-FORKS": "true" }), undefined)).toContain("--forks");
  });

  it("hands the token to the CLI in its environment as ANTHIVO_TOKEN, with the server, and none of the Action's inputs", () => {
    const env = cliEnvironment(
      { ...JOB, ANTHIVO_TOKEN: "anth_from-elsewhere", ANTHIVO_URL: "https://other.example" },
      readInputs(JOB),
    );
    expect(env.ANTHIVO_TOKEN).toBe(TOKEN);
    expect(env.ANTHIVO_URL).toBe(DEFAULT_SERVER);
    expect(Object.keys(env).filter((name) => name.startsWith("INPUT_"))).toEqual([]);
    // GitHub's own variables stay: they say where the run comes from.
    expect(env.GITHUB_EVENT_PATH).toBe(JOB.GITHUB_EVENT_PATH);
    // A fork's job gets no secret: the CLI then skips it, or says the token is missing.
    expect(
      cliEnvironment({ ...JOB, INPUT_TOKEN: "" }, readInputs({ ...JOB, INPUT_TOKEN: "" })).ANTHIVO_TOKEN,
    ).toBeUndefined();
    // npm never sees the token.
    expect(Object.values(installEnvironment({ ...JOB, ANTHIVO_TOKEN: TOKEN }))).not.toContain(TOKEN);
  });

  it("installs the CLI at its exact version into a folder of its own, with no install scripts", () => {
    expect(installArguments("0.1.0", "/tmp/anthivo-cli-0.1.0")).toEqual([
      "install",
      "--prefix",
      "/tmp/anthivo-cli-0.1.0",
      "--no-save",
      "--no-package-lock",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      "--loglevel=error",
      "anthivo@0.1.0",
    ]);
  });

  it("runs only what npm installed as anthivo at that version, through its own anthivo command", () => {
    expect(installedBin({ name: "anthivo", version: "0.1.0", bin: { anthivo: "dist/index.js" } }, "0.1.0")).toBe(
      "dist/index.js",
    );
    expect(() =>
      installedBin({ name: "anthivo", version: "0.1.1", bin: { anthivo: "dist/index.js" } }, "0.1.0"),
    ).toThrow(InputError);
    expect(() => installedBin({ name: "anthivo-evil", version: "0.1.0", bin: "x.js" }, "0.1.0")).toThrow(InputError);
    expect(() =>
      installedBin({ name: "anthivo", version: "0.1.0", bin: { anthivo: "../../evil.js" } }, "0.1.0"),
    ).toThrow(InputError);
    expect(() => installedBin(null, "0.1.0")).toThrow(InputError);
  });
});

describe("the job's result", () => {
  it("passes on the CLI's exit 0, and fails on 1 (a new defect at or above fail-on) and 2 (anything else)", () => {
    expect(jobExitCode(0)).toBe(0);
    expect(jobExitCode(1)).toBe(1);
    expect(jobExitCode(2)).toBe(2);
    // A crash or a kill isn't a pass.
    for (const code of [null, 3, 127, 134, -1]) expect(jobExitCode(code)).toBe(2);
  });

  it("says how it ended in the Action's own words, never the server's", () => {
    expect(resultAnnotation(0)).toBeNull();
    expect(resultAnnotation(1)).toBe(
      "::error title=Anthivo::A new defect at or above fail-on. The job summary lists it.",
    );
    expect(resultAnnotation(2)).toBe("::error title=Anthivo::The check ended without a verdict. The log says why.");
  });
});
