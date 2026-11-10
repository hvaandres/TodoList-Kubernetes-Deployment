# Azure container pipeline implementation plan

**Goal:** Build, validate, scan, and publish one TodoList image to ACR using OIDC.

**Design:** One workflow with CI and CD jobs. CI builds once, smoke-tests the
container, scans OS and library vulnerabilities, and saves the passing image as
a workflow artifact. CD depends on CI, verifies the saved image identity, then
logs in using OIDC and pushes a commit-tagged image. Publication is restricted
to pushes/manual runs on `codex/azure-container-pipeline` in `jordannaegle/TodoList`.
Pull requests run CI without Azure access. No deployment is included.

**Approaches:** Rebuilding in CD could produce different image contents; saving
and transferring the built image preserves what was scanned. Separate workflow
triggers add unnecessary artifact/trust coordination for this assignment.

**Files:** `.github/workflows/azure-container-pipeline.yml` owns automation;
`.dockerignore` excludes local data; `docs/AZURE-CICD.md` owns Azure/OIDC setup;
`submission/README.md` owns screenshot requirements and reflection draft.

**Validation-driven adjustment:** The initial runtime image failed Trivy on
Debian packages and unused package-manager dependencies. Keep the builder but
use Alpine for the final runtime, remove unused package managers, and recheck
the production endpoints and vulnerability gate before publishing.

## Steps

- [x] Implement the workflow with read-only CI permissions and CD-only OIDC.
- [x] Validate workflow syntax, build locally, smoke-test, and scan the image.
- [x] Document exact branch federation, registry-scoped permissions, GitHub
      variables, first-run steps, troubleshooting, screenshots, and reflection.
- [ ] Review changes, push the assignment branch, and inspect GitHub CI.
- [ ] After Azure setup, verify publication and collect actual screenshots.

## Verification focus

Build/scan failures must block publication. PRs and other branches cannot publish.
The loaded image ID must equal CI's recorded ID. Missing variables must produce
an actionable error. Scan reports must remain available when the security gate
fails. No cloud password or long-lived client secret may be required.
