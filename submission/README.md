# IT3200 CI/CD submission evidence

Assignment: M10: Create your first CI and CD Pipeline. Due November 10, 2026,
11:59 p.m. as displayed in Canvas. Repository: https://github.com/jordannaegle/TodoList.
Branch: `codex/azure-container-pipeline`.

## Local validation completed November 9, 2026

- Docker production build passed.
- Container `/healthz` returned `status: ok`; frontend returned HTML.
- Container runs as `uid=1000(node)`.
- Trivy v0.76.2 found **0 HIGH/CRITICAL vulnerabilities** in the revised
  Alpine runtime image. The original Debian runtime failed the gate.
- Actionlint v1.7.12 and `git diff --check` passed.

Existing npm audit findings
in build-stage dependencies remain outside the runtime-image scan's scope.

## Successful Azure publication: November 9, 2026, 8:30 p.m. MST

Both CI and CD passed on attempt 2. Azure OIDC and ACR login succeeded; CD pushed
the saved CI image, queried its registry digest, pulled by digest, and confirmed
the image identifier matched CI. Azure portal independently showed the same tag
and digest. No VM or Kubernetes deployment was performed.

- [x] `01-actions-overview.jpg`: run title, branch/commit, and both jobs green.
- [x] `01a-ci-steps.jpg`: checkout, Docker build, smoke test, and container scan.
- [x] `01b-cd-steps.jpg`: image verification, Azure OIDC login, ACR login, and push.
- [x] `02-acr-repository.jpg`: Azure registry name and `todo-list` repository.
- [x] `03-image-details.jpg`: full commit tag, registry context, and image digest.
- [x] `scan-report/trivy-results.txt`: downloaded report from the successful CI job;
      zero findings at the configured HIGH/CRITICAL threshold.

Screenshots are stored locally in this directory and excluded from Git commits.
Review them before uploading your assignment. The text evidence and reflection
are versioned in the repository.

The extra CI/CD views make the assignment's first screenshot requirement legible
when a single screenshot cannot show all required steps. Avoid account menus or
unrelated personal details in captures. No credential values are needed.

## Verified run details

- Workflow run: https://github.com/jordannaegle/TodoList/actions/runs/42747361166/attempts/2
- Published commit SHA: `7f87672c0fc6af0f26fd12aa3cf23b058c659849`
- Registry login server: `jordanit3200.azurecr.io`
- Image: `jordanit3200.azurecr.io/todo-list:7f87672c0fc6af0f26fd12aa3cf23b058c659849`
- Registry index digest: `sha256:0ce254423fd6f8aef42ae39e26f4abbf93c5bc04ec78a5d3db1d05c396958fb8`
- Match between Actions digest and Azure details: **confirmed**
- Authentication: user-assigned managed identity with branch-specific GitHub OIDC.

GitHub also displayed action-runtime deprecation and runner-image migration
annotations. These were warnings/notices; both jobs completed successfully.

## Short reflection draft

Review this draft in your own words and submit it with the captured evidence.

1. **What is the difference between CI and CD?** CI checks whether a change can
   be integrated successfully. In this project it builds the Docker image,
   smoke-tests the running container, and scans it for vulnerabilities. CD
   delivers that validated image to Azure Container Registry for later deployment.

2. **Why build and scan before pushing?** The build confirms that the application
   can be packaged, and the security scan checks the runtime image for known
   vulnerabilities. Publishing only after these checks pass helps prevent broken
   or vulnerable images from becoming release candidates. Transferring the saved
   image means CD publishes the same image that CI checked.

3. **What happens if the CI build fails?** The CI job fails and the CD job is
   skipped because it depends on CI. Azure authentication and image publication
   do not occur. A failed security scan or smoke test also blocks publication.

4. **Why store Docker images in a container registry?** A registry provides a
   central place for versioned images that other systems can pull. The commit
   tag connects an image to its source code, and its digest identifies the
   registry content precisely for verification and repeatable deployment.

5. **What additional step is needed for Kubernetes?** A later deployment process
   would configure Kubernetes permission to pull from ACR, update a Deployment or
   Helm release to reference the validated image tag or digest, and verify the
   rollout. This assignment ends with publishing to ACR.
