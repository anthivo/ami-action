# Anthivo for GitHub Actions

Runs your project's approved tests in Anthivo on each push and pull request, and fails the job when the run finds a new defect at or above your fail-on level.

Anthivo runs the tests on its own servers against your staging or preview URL, runs each failure again, and judges what failed twice. The job only runs the `anthivo` command line client: it holds no AI model key and sends no code, only the names of the files that changed.

## Set up

1. In Anthivo, open **Settings > Access Tokens** and create a token limited to the project.
2. In your repository on GitHub, open **Settings > Secrets and variables > Actions** and add it as the secret `ANTHIVO_TOKEN`.
3. Add a workflow, such as `.github/workflows/anthivo.yml`:

```yaml
name: Anthivo

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  anthivo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: anthivo/ami-action@v1
        with:
          token: ${{ secrets.ANTHIVO_TOKEN }}
          project: PRJ-3
          environment: Staging
          fail-on: high
```

Pass the token only from the repository's secrets, as above. Never write it in a workflow file: anyone who can read the repository could use it. The Action hands it to the CLI in its environment, never as an argument, and masks it in the log.

A repository can keep its project, environment and fail-on level in `anthivo.json` instead; the inputs win over it.

## Inputs

| Input | |
| --- | --- |
| `token` | Required. An Anthivo access token from the repository's secrets, limited to the project. |
| `project` | The project, as `PRJ-N`. Default: `anthivo.json`'s, or the token's only project. |
| `environment` | The environment's name. Default: `anthivo.json`'s, or the project's only environment. |
| `url` | The address to test: a preview or staging URL the environment allows. Default: the environment's App URL. |
| `fail-on` | The lowest severity of a new defect that fails the job: `critical`, `high`, `medium`, `low` or `none`. Default: `anthivo.json`'s, else `critical`. |
| `run-on-forks` | `true` runs pull requests from forks too. Default: `false`. |
| `server` | Anthivo's address. Default: `https://www.anthivo.com`. |
| `cli-version` | The exact version of the `anthivo` CLI the job runs. Default: the version this Action was tested with. |

## Preview and staging URLs

`url` is checked by Anthivo before anything runs: it must be the environment's own site, or match the environment's preview URLs, which an owner or admin sets in Anthivo. Test accounts are never sent anywhere else. Previews on shared hosts such as vercel.app come in through Anthivo's GitHub app instead.

```yaml
      - uses: anthivo/ami-action@v1
        with:
          token: ${{ secrets.ANTHIVO_TOKEN }}
          url: https://pr-${{ github.event.pull_request.number }}.staging.example.com
```

## Pull requests

- The run records the pull request's own head commit, not the merge commit GitHub checks out to test it, and its number and page.
- Only the names of the pull request's own changed files are sent: the merge commit's changes against its first parent. A shallow checkout, actions/checkout's default, is fine: the CLI fetches that one commit, and nothing is checked out.
- On a push, the changed files are those since the push's previous commit.
- Pull requests from forks are skipped with a notice, and the job passes: GitHub gives a fork's workflow none of your repository's secrets, and it's someone else's code. Set `run-on-forks: true` only if your repository's settings send secrets to workflows from forks.

## The job summary

Each run adds a summary to the job's page: the verdict and the counts, each new and known defect with its severity and what was expected and shown, and each failed test with Anthivo's verdict on it. When they apply, it also lists the changed areas whose tests ran first and, for a pull request, the changed pages Anthivo checked. Links go to Anthivo's own pages, where the evidence is. Text from the tested app is shown as text: it can't add links, images or formatting.

## The job's result

- **Passes** when the run finds no new defect at or above `fail-on`. Known defects, flaky tests and findings left for review never fail it.
- **Fails** when it finds a new defect at or above `fail-on` (the CLI's exit `1`).
- **Fails** when the run couldn't start, ended in an error, couldn't judge its failures (for example without a working AI model key in Anthivo), or didn't finish within the CLI's 60 minutes, though it goes on in Anthivo (exit `2`). The log says why.

## The CLI's version

The Action installs the `anthivo` CLI from npm at the exact version it was tested with, and runs it with Node. `cli-version` takes another exact version, never a range or `latest`. GitHub-hosted runners have npm; on your own runner, add `actions/setup-node` before this step.

## License

MIT, in `LICENSE`. It covers this Action; Anthivo's service and AMI aren't part of it.
