# Contributing

## Getting set up

```bash
npm install
npm test          # builds, then runs the suite
```

Nothing in the suite needs a NAS. DSM's answers are recorded from a DS920+ on
DSM 7.4 in `test/fixtures/ds920.json`, trimmed to the fields the plugin reads,
and a fake DSM in `test/helpers.ts` answers from them — logging in, handing out
sessions and ending them when a test asks. The HomeKit side runs against
HAP-NodeJS itself, and the dashboard against a real HTTP server on a free
port.

## Working against a real NAS

Run the plugin as a child bridge on a machine that can reach the NAS and read
the log; switch the dashboard on to see what it reads. To record new answers
for the fixture, keep only the fields `src/readings.ts` reads and replace the
serial numbers.

## Releasing

Publishing runs from GitHub Actions using [npm trusted
publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is
stored in the repository and there is none to rotate.

**One-time setup on npmjs.com**, under the package's *Settings → Trusted
publisher*:

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `rummeyer` |
| Repository | `homebridge-synology-monitor` |
| Workflow filename | `publish.yml` |

That page only exists once the package does, so the very first version has to
go up another way — `npm publish` from a logged-in checkout. Every release
after it runs from Actions.

**To release:**

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Commit, then tag: `git tag v1.0.0 && git push --follow-tags`.
3. Create a GitHub release for that tag.

The workflow checks the tag against `package.json` before publishing — a
mistagged release would otherwise put the wrong version under the right name,
and that cannot be undone.
