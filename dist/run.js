import { cliArguments, cliEnvironment, InputError, installArguments, installEnvironment, installedBin, jobExitCode, readInputs, resultAnnotation, } from "./action.js";
import { join } from "node:path";
const NEWLINE = 0x0a;
export async function runAction(deps) {
    let inputs;
    try {
        inputs = readInputs(deps.env);
    }
    catch (error) {
        if (error instanceof InputError) {
            deps.log(`::error title=Anthivo::${error.message}\n`);
            return 2;
        }
        throw error;
    }
    // The token is masked in the log before anything else is written, whatever path it would take.
    if (inputs.token)
        deps.log(`::add-mask::${inputs.token}\n`);
    const prefix = deps.folder(inputs.cliVersion);
    deps.log(`::group::Install anthivo@${inputs.cliVersion}\n`);
    const installed = await deps.npm(installArguments(inputs.cliVersion, prefix), prefix, installEnvironment(deps.env));
    deps.log("::endgroup::\n");
    if (installed !== 0) {
        deps.log(`::error title=Anthivo::Couldn't install anthivo@${inputs.cliVersion} with npm.\n`);
        return 2;
    }
    let bin;
    try {
        bin = installedBin(deps.readManifest(prefix), inputs.cliVersion);
    }
    catch (error) {
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
    const code = await deps.cli(join(prefix, "node_modules", "anthivo", bin), cliArguments(inputs, deps.env.GITHUB_STEP_SUMMARY), cliEnvironment(deps.env, inputs), workspace !== undefined && workspace !== "" ? workspace : ".", (chunk) => {
        if (chunk.length === 0)
            return;
        deps.write(chunk);
        lineOpen = chunk[chunk.length - 1] !== NEWLINE;
    });
    if (lineOpen)
        deps.log("\n");
    deps.log(`::${resume}::\n`);
    const result = jobExitCode(code);
    const annotation = resultAnnotation(result);
    if (annotation)
        deps.log(`${annotation}\n`);
    return result;
}
