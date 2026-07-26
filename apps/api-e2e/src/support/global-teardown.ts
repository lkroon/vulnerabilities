module.exports = async function () {
  // Deliberately does NOT kill port 3000.
  //
  // This suite does not start the API - Nx does, via `dependsOn: ["api:build",
  // "api:serve"]` in project.json - so tearing the port down here destroys a
  // server it does not own. When `nx run-many -t e2e` runs both e2e projects,
  // web-e2e's Playwright `webServer` reuses that same API (reuseExistingServer),
  // and this teardown was killing it mid-run: the Angular dev server then
  // logged `[vite] http proxy error: /api/orgs/acme/projects` and every
  // web-e2e assertion failed. See docs/agent-corrections.md.
  //
  // Note: the API keeps running after this suite finishes - Nx does not stop
  // the continuous `api:serve` task at run end (verified locally: :3000 still
  // answers 200 afterwards). In CI that is harmless and actively useful, since
  // web-e2e then reuses the already-warm API. Locally, `npm run reset` or
  // Ctrl-C the run if you want the port back.
  console.log(globalThis.__TEARDOWN_MESSAGE__);
};
