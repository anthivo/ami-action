import {
  cliArguments,
  cliEnvironment,
  InputError,
  installArguments,
  installEnvironment,
  installedBin,
  jobExitCode,
  readInputs,
  resultAnnotation,
} from "./action.js";
import { join } from "node:path";

// The Action's steps, with everything outside it handed in, so a test runs them with stand-ins and reads every line
// the job's log would get: the token masked first, the CLI installed at its exact version, its output read with
// workflow commands stopped, and the job's result from its exit code.

type Env = Record<string, string | undefined>;

export interface ActionDependencies {
  env: Env;
  /** Writes to the job's log, where the runner reads workflow commands. */
  log: (text: string) => void;
  /** A fresh word nobody can guess: what resumes workflow commands after the CLI's output. */
  randomWord: () => string;
  /** The folder the CLI is installed into, made when it isn't there. */
  folder: (version: string) => string;
  /** Runs npm with these arguments in this folder; its exit code. */
  npm: (args: string[], cwd: string, env: Env) => Promise<number | null>;
  /** The installed CLI's package.json, or null when it isn't there. */
  readManifest: (prefix: string) => unknown;
  /** Writes the CLI's output to the job's log as it comes, bytes untouched. */
  write: (chunk: Uint8Array) => void;
  /** Runs the CLI's file with Node, handing each piece of its output (both streams) to `output`; its exit code. */
  cli: (
    file: string,
    args: string[],
    env: Env,
    cwd: string,
    output: (chunk: Uint8Array) => void,
  ) => Promise<number | null>;
}

const NEWLINE = 0x0a;

export async function runAction(deps: ActionDependencies): Promise<0 | 1 | 2> {
  let inputs: ReturnType<typeof readInputs>;
  try {
    inputs = readInputs(deps.env);
  } catch (error) {
    if (error instanceof InputError) {
      deps.log(`::error title=Anthivo::${error.message}\n`);
      return 2;
    }
    throw error;
  }
  // The token is masked in the log before anything else is written, whatever path it would take.
  if (inputs.token) deps.log(`::add-mask::${inputs.token}\n`);

  const prefix = deps.folder(inputs.cliVersion);
  deps.log(`::group::Install anthivo@${inputs.cliVersion}\n`);
  const installed = await deps.npm(installArguments(inputs.cliVersion, prefix), prefix, installEnvironment(deps.env));
  deps.log("::endgroup::\n");
  if (installed !== 0) {
    deps.log(`::error title=Anthivo::Couldn't install anthivo@${inputs.cliVersion} with npm.\n`);
    return 2;
  }
  let bin: string;
  try {
    bin = installedBin(deps.readManifest(prefix), inputs.cliVersion);
  } catch (error) {
    if (error instanceof InputError) {
      deps.log(`::error title=Anthivo::${error.message}\n`);
      return 2;
    }
    throw error;
  }

  // The CLI's output reaches the log with workflow commands stopped, so nothing it prints acts on the job, whatever the
  // tested app's text holds. The CLI breaks any such line itself as well.
  const resume = deps.randomWord();
  const workspace = deps.env.GITHUB_WORKSPACE;
  deps.log(`::stop-commands::${resume}\n`);
  // Whether the CLI's last output left its line open: the resume has to start a line of its own, or the runner, which
  // reads commands at a line's start, would never see it, and the annotation after it would be lost.
  let lineOpen = false;
  const code = await deps.cli(
    join(prefix, "node_modules", "anthivo", bin),
    cliArguments(inputs, deps.env.GITHUB_STEP_SUMMARY),
    cliEnvironment(deps.env, inputs),
    workspace !== undefined && workspace !== "" ? workspace : ".",
    (chunk) => {
      if (chunk.length === 0) return;
      deps.write(chunk);
      lineOpen = chunk[chunk.length - 1] !== NEWLINE;
    },
  );
  if (lineOpen) deps.log("\n");
  deps.log(`::${resume}::\n`);
  const result = jobExitCode(code);
  const annotation = resultAnnotation(result);
  if (annotation) deps.log(`${annotation}\n`);
  return result;
}
