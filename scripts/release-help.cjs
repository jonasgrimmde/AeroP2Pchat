console.log(`
Aero P2P Chat releases are built by GitHub Actions now.

Use a Git tag to publish a release:
  git tag v26.14.1
  git push origin v26.14.1

The CD workflow builds Windows, Linux, and macOS artifacts, creates latest.yml,
and uploads everything to the GitHub release.
`.trim());
