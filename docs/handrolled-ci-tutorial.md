# Hand-Rolling GitHub Actions

*Build a CI pipeline with zero Marketplace actions, and learn what `actions/checkout` and friends were doing for you all along.*

Every `uses:` line in a workflow hides a script. `actions/checkout` is a few hundred lines of TypeScript that end in a `git fetch`. `actions/setup-node` downloads a tarball and edits `PATH`. The Docker actions wrap `docker login` and `docker build`. This tutorial has you write the minimal version of each one by hand, in a second workflow called `ci-manual.yml`. The existing `ci.yml` stays untouched so you can diff the two at the end.

## Ground rules

- Every step is a `run:` step. The only `uses:` allowed points inside this repo (exercise 11).
- Add one exercise at a time. Push, open the Actions tab, read the log, then move on.
- Break each step on purpose once. A pipeline you have only seen green has taught you half of what it can.
- Anything you can type in your terminal works in a `run:` step. The runner is a fresh Ubuntu VM with git, Node, Docker, curl and jq preinstalled, an empty working directory, and no idea what your repo is until you tell it.

## Exercise 0: The skeleton

Create `.github/workflows/ci-manual.yml`. The placeholder `echo` steps keep the file valid until you replace them.

```yaml
name: CI (hand-rolled)

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:          # adds a "Run workflow" button in the Actions tab

permissions:
  contents: read

concurrency:
  group: manual-${{ github.ref }}
  cancel-in-progress: true    # a new push cancels the run it supersedes

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - run: echo "exercises 1 to 4 go here"

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: test
    permissions:
      contents: read
      packages: write         # lets exercise 9 push to GHCR
    steps:
      - run: echo "exercises 2 and 5 to 9 go here"

  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    environment: production
    steps:
      - run: echo "exercise 10 goes here"
```

**What to notice.** `needs:` is the only thing that orders jobs. Without it all three would start at once on three separate machines. `permissions:` at the top is the default for every job, and the build job raises its own because pushing a package needs more than reading code.

**Check.** Push it. You should see three green jobs that each ran one `echo`.

## Exercise 1: Look at the empty machine

First step of the `test` job:

```yaml
      - name: What does the runner start with?
        run: |
          echo "Workspace: $GITHUB_WORKSPACE"
          ls -la "$GITHUB_WORKSPACE"
          echo "Repo: $GITHUB_REPOSITORY"
          echo "Commit: $GITHUB_SHA"
          echo "Event: $GITHUB_EVENT_NAME on $GITHUB_REF"
          git --version && node --version && docker --version && jq --version
```

**What to notice.** The workspace is empty. Nothing has cloned your repo. The `GITHUB_*` variables are how the runner tells your script which repo and commit triggered the run. That is the entire input that `actions/checkout` works from.

**Check.** The `ls` prints only `.` and `..`. The preinstalled Node version is whatever the image ships, not the one in your `.nvmrc`.

## Exercise 2: Check out the code by hand

Replaces `actions/checkout`.

```yaml
      - name: Check out the commit that triggered this run
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          git init --quiet .
          git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
          git fetch --quiet --depth=1 origin "$GITHUB_SHA"
          git checkout --quiet FETCH_HEAD
          git remote set-url origin "https://github.com/${GITHUB_REPOSITORY}.git"   # scrub the token
          git log --oneline -1
          ls
```

**What to notice.** This is not `git clone`. A clone fetches the default branch, but on a pull request `GITHUB_SHA` is a throwaway merge commit that lives on no branch at all, so you fetch the exact commit by hash instead. `--depth=1` skips history you don't need. The token goes in the URL because `secrets.GITHUB_TOKEN` is not in the environment until you put it there, and the last `set-url` removes it from `.git/config` so it can't leak into later logs. The real action does all of this plus submodules, LFS, sparse checkout, and twenty edge cases you don't have.

Copy this same step to the top of the `build` job. Jobs don't share a disk, so the code has to be fetched twice. That duplication is the first thing a published action buys you.

**Check.** `git log` shows the commit you just pushed and `ls` shows your files.

## Exercise 3: Install Node by hand

Replaces `actions/setup-node`.

```yaml
      - name: Install the Node version pinned in .nvmrc
        run: |
          MAJOR="$(tr -d 'v[:space:]' < .nvmrc)"
          VERSION="$(curl -fsSL https://nodejs.org/dist/index.json \
            | jq -r --arg m "$MAJOR" '[.[] | select(.version | startswith("v" + $m + "."))][0].version')"
          echo "Resolved Node $MAJOR to $VERSION"
          curl -fsSL "https://nodejs.org/dist/${VERSION}/node-${VERSION}-linux-x64.tar.xz" | tar -xJ -C "$RUNNER_TEMP"
          echo "$RUNNER_TEMP/node-${VERSION}-linux-x64/bin" >> "$GITHUB_PATH"

      - name: Prove the right Node is on PATH
        run: node --version && npm --version
```

**What to notice.** The index at nodejs.org lists every release newest first, so the first entry starting with `v22.` is the latest 22.x. The tarball is extracted into `RUNNER_TEMP`, a scratch directory the runner cleans up. The important line is the last one. Each `run:` step is a brand-new shell, so an `export PATH=...` would vanish when the step ends. Writing to the file at `$GITHUB_PATH` is the runner's mechanism for making a PATH change survive into later steps. `$GITHUB_ENV` does the same for environment variables. That one mechanism is most of what `setup-node` is.

**Check.** The second step prints 22.x even though exercise 1 printed something else. Change `.nvmrc` to `24`, push, and watch it resolve a different release.

## Exercise 4: Install, audit, test

Nothing to replace here. These were always plain commands.

```yaml
      - name: Install dependencies exactly as locked
        run: npm ci

      - name: Fail on known high-severity vulnerabilities
        run: npm audit --audit-level=high

      - name: Run the node:test suite
        run: npm run test:node

      - name: Run the Vitest suite
        run: npm run test:vitest
```

**What to notice.** `npm ci` refuses to run if `package.json` and the lockfile disagree, which is the behaviour you want in CI. `--audit-level=high` sets the floor: moderate and low advisories print but don't fail the job. The two test suites are separate steps so a failure shows which runner broke, and because steps share one machine the install only happens once.

The audit step will fail on your first run. Express pulls in a version of `body-parser` with a high-severity advisory, and a non-breaking fix exists. That is the audit doing its job. Run `npm audit fix` locally, commit the updated lockfile, and push again.

**Check.** Four green steps. Then temporarily break a test, push, and confirm the audit step still ran but the test step went red and the `build` job was skipped.

## Exercise 5: Pass data between steps

Replaces `docker/metadata-action`. Goes in the `build` job after the checkout step.

```yaml
      - name: Decide the image name and tag
        id: meta
        run: |
          IMAGE="ghcr.io/${GITHUB_REPOSITORY,,}"   # GHCR rejects uppercase
          TAG="${GITHUB_SHA::7}"
          echo "image=$IMAGE" >> "$GITHUB_OUTPUT"
          echo "tag=$TAG" >> "$GITHUB_OUTPUT"
          echo "Will build $IMAGE:$TAG"
```

**What to notice.** `${VAR,,}` is bash for lowercase and `${VAR::7}` is the first seven characters. Writing `key=value` lines to `$GITHUB_OUTPUT` publishes them as step outputs, readable in later steps as `${{ steps.meta.outputs.image }}`. The `id:` is what makes the step addressable. This is exactly how published actions return values to you.

**Check.** The log prints a lowercase image name ending in a seven-character hash.

## Exercise 6: Build the image

Replaces the build half of `docker/build-push-action`.

```yaml
      - name: Build the image
        env:
          IMAGE: ${{ steps.meta.outputs.image }}
          TAG: ${{ steps.meta.outputs.tag }}
        run: docker build -t "$IMAGE:$TAG" .
```

**What to notice.** The outputs are passed through `env:` rather than pasted straight into the command. Anything inside `${{ }}` is expanded before bash runs, so a value containing a quote or semicolon would be executed as shell. Routing it through an environment variable makes it plain data. Get into this habit now, it is the single most common security mistake in workflows.

**Check.** The build log shows your Dockerfile's layers. If it copies `node_modules`, you forgot the `.dockerignore`.

## Exercise 7: Gate on image size

The quality check for a Docker image.

```yaml
      - name: Fail if the image is bigger than the limit
        env:
          IMAGE: ${{ steps.meta.outputs.image }}
          TAG: ${{ steps.meta.outputs.tag }}
          LIMIT_MB: 300
        run: |
          BYTES="$(docker image inspect "$IMAGE:$TAG" --format '{{.Size}}')"
          MB=$(( BYTES / 1024 / 1024 ))
          echo "### Image size: ${MB} MB (limit ${LIMIT_MB} MB)" >> "$GITHUB_STEP_SUMMARY"
          test "$MB" -le "$LIMIT_MB"
```

**What to notice.** `test` exits non-zero when the comparison is false, and a non-zero exit fails the step. Writing markdown to `$GITHUB_STEP_SUMMARY` puts it on the run's summary page, above the logs, which is where you want numbers people should see without digging.

**Check.** Read the real size from the summary, set the limit 20 MB above it, push. Then set it below and watch the job fail with the number in plain sight.

## Exercise 8: Smoke test the container

Proves the image boots, not just that it built.

```yaml
      - name: Smoke test the container
        env:
          IMAGE: ${{ steps.meta.outputs.image }}
          TAG: ${{ steps.meta.outputs.tag }}
        run: |
          docker run --detach --rm --publish 3000:3000 --name smoke "$IMAGE:$TAG"
          trap 'docker stop smoke > /dev/null' EXIT
          for attempt in $(seq 1 10); do
            if curl --fail --silent --show-error http://localhost:3000/api; then
              exit 0
            fi
            sleep 1
          done
          echo "Server never answered. Container logs:"
          docker logs smoke
          exit 1
```

**What to notice.** The container starts in the background, the loop gives it up to ten seconds to answer, and `trap ... EXIT` guarantees it is stopped whether the step passes or fails. An explicit `exit 1` at the bottom matters: without it the loop would finish quietly and the step would pass with the server dead.

**Check.** The log shows the JSON body from `/api`. Change the port in the `curl` to 3001 and confirm it fails after ten attempts with the container logs printed.

## Exercise 9: Log in and push, on main only

Replaces `docker/login-action` and the push half of `docker/build-push-action`.

```yaml
      - name: Push to GHCR
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          IMAGE: ${{ steps.meta.outputs.image }}
          TAG: ${{ steps.meta.outputs.tag }}
        run: |
          echo "$GITHUB_TOKEN" | docker login ghcr.io --username "$GITHUB_ACTOR" --password-stdin
          docker tag "$IMAGE:$TAG" "$IMAGE:latest"
          docker push "$IMAGE:$TAG"
          docker push "$IMAGE:latest"
          docker logout ghcr.io
```

**What to notice.** The `if:` on a step means pull requests still build and test the image but never publish it. `--password-stdin` keeps the token out of the process list. The login works because the job asked for `packages: write` back in exercise 0. Remove that line and this step fails with a 403, which is a useful thing to see once.

**Check.** On a pull request the step shows as skipped. After merging to main, the image appears under Packages on your GitHub profile, tagged with the short hash and `latest`.

## Exercise 10: The deploy placeholder, fed by a job output

Replace the build job's `steps:` header area with an `outputs:` block, then fill in the deploy job.

```yaml
  build:
    # ...existing keys...
    outputs:
      image: ${{ steps.meta.outputs.image }}:${{ steps.meta.outputs.tag }}
    steps:
      # ...exercises 2 and 5 to 9...

  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    environment: production
    steps:
      - name: Pretend to deploy
        env:
          IMAGE: ${{ needs.build.outputs.image }}
        run: echo "### Would deploy $IMAGE to production" >> "$GITHUB_STEP_SUMMARY"
```

**What to notice.** A step output only lives inside its job. To cross the boundary the job re-exports it under `outputs:` and the next job reads it through `needs.<job>.outputs`. The `environment:` line does nothing yet, but once you add a required reviewer to the `production` environment in the repo settings, this job will pause and wait for approval with no change to the YAML.

**Check.** The run summary for a push to main shows the full image reference the deploy job received.

## Exercise 11 (bonus): Package one step as a local action

Now that exercise 3 works inline, turn it into something reusable. Create `.github/actions/setup-node/action.yml`:

```yaml
name: Set up Node from a version file
description: Downloads the matching Node release and puts it on PATH

inputs:
  version-file:
    description: File holding the major version
    default: .nvmrc

runs:
  using: composite
  steps:
    - shell: bash
      env:
        VERSION_FILE: ${{ inputs.version-file }}
      run: |
        MAJOR="$(tr -d 'v[:space:]' < "$VERSION_FILE")"
        VERSION="$(curl -fsSL https://nodejs.org/dist/index.json \
          | jq -r --arg m "$MAJOR" '[.[] | select(.version | startswith("v" + $m + "."))][0].version')"
        curl -fsSL "https://nodejs.org/dist/${VERSION}/node-${VERSION}-linux-x64.tar.xz" | tar -xJ -C "$RUNNER_TEMP"
        echo "$RUNNER_TEMP/node-${VERSION}-linux-x64/bin" >> "$GITHUB_PATH"
```

Then in the workflow, replace the exercise 3 step with:

```yaml
      - uses: ./.github/actions/setup-node
```

**What to notice.** A composite action is a workflow fragment with a name, inputs, and a contract. Every step inside it must declare `shell:` explicitly. The leading `./` tells the runner to look in the checked-out repo rather than the Marketplace, which is why this `uses:` is allowed by the ground rules. You cannot do the same for checkout: a local action is read from the workspace, and until checkout has run the workspace is empty. That is why checkout stays inline forever and is the one action everybody uses from the Marketplace.

**Check.** The run is identical to before, but the log now shows the step grouped under the action's name.

## What you cannot hand-roll, and why

Three things in the published versions have no `run:` equivalent:

- **`actions/cache`.** The cache service is reachable only through a runtime token that the runner hands to actions, not to shell steps. Your manual workflow runs `npm ci` cold every time. For this app that is a few seconds, so it costs nothing to skip.
- **`actions/upload-artifact`.** Same reason. The upload goes through an internal results API. In this pipeline the pushed image is the artifact, which is the better design anyway.
- **Docker layer caching with `type=gha`.** Also needs the runtime token. Builds start from scratch each run.

Knowing exactly where the line is between "shell can do this" and "only the toolkit can do this" is a large part of what this exercise is for.

## When you're done

Open `ci.yml` and `ci-manual.yml` side by side. Every `uses:` in the first file now has a block of shell in the second that you wrote and understand. The next time a checkout action has a breaking change or a setup action is deprecated, you will know what it was doing and what to put in its place.
