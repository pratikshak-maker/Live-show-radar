# GitHub Actions workflows (not active yet)

These two workflows live here because the token used for the first push didn't have GitHub's `workflow`
scope, which GitHub requires before a push can add files under `.github/workflows/`.

- `ci.yml` — lint, typecheck, tests, build and the secrets check, with **no** environment variables.
- `scan.yml` — optional backup scheduler that calls `/api/cron/scan` every 30 minutes
  (needs `APP_URL` and `CRON_SECRET` repository secrets).

To turn them on, do either of these:

1. On github.com: **Add file → Create new file**, name it `.github/workflows/ci.yml`, paste the contents, commit
   (repeat for `scan.yml`). The web UI doesn't need the token scope.
2. Or give your token the `workflow` scope, then run `git mv docs/github-workflows/*.yml .github/workflows/` and push.
