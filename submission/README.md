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

These local checks do not prove Azure publication. The successful cloud run
and registry screenshots below are still required. Existing npm audit findings
in build-stage dependencies remain outside the runtime-image scan's scope.

## Evidence to collect after a successful Azure publish

Capture real screenshots from the completed run and Azure. Do not use a local
build or a failed CD run as proof of publication. Save images in this directory.

- [ ] `01-actions-overview.png`: run title, branch/commit, and both jobs green.
- [ ] `01a-ci-steps.png`: CI job with checkout, Docker build, smoke test, and
      container security scan visibly successful. Expand the scan for results.
- [ ] `01b-cd-steps.png`: CD job with image verification, Azure OIDC login, ACR
      login, and image push visibly successful. Expand push for its digest.
- [ ] `02-acr-repository.png`: Azure registry name and `todo-list` repository.
- [ ] `03-image-details.png`: full commit tag, registry context, and image digest.

The extra CI/CD views make the assignment's first screenshot requirement legible
when a single screenshot cannot show all required steps. Avoid account menus or
unrelated personal details in captures. No credential values are needed.

## Fill in from the successful run

- Workflow run URL: **pending**
- Published commit SHA: **pending**
- Registry login server: **pending**
- Image: **pending** (`<login-server>/todo-list:<full-commit-sha>`)
- Registry manifest digest: **pending**
- Match between Actions digest and Azure details: **pending**

## Short reflection draft

Review this draft in your own words and submit it with your actual evidence.
It describes the pipeline design; it is not a claim that Azure publication has
already completed.

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
