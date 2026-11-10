# IT3200: build, scan, and publish to Azure Container Registry

The workflow is `.github/workflows/azure-container-pipeline.yml`.
The old commented workflows are preserved in `.github/workflow-archive/`.
Keeping comment-only YAML in the active workflows directory caused GitHub
workflow syntax failures. This assignment stops at ACR.

The original `node:22-slim` runtime failed the HIGH/CRITICAL scan. The Dockerfile
keeps the existing Debian build stage but uses `node:22-alpine` for production,
removes unused npm/Yarn/Corepack files, and runs as the non-root `node` user.
Only static build files and the built-in-module server enter the runtime stage.

## What the pipeline does

1. On pushes to `codex/azure-container-pipeline`, PRs, or manual runs, CI checks
   out the source and builds the existing multi-stage Dockerfile.
2. CI starts that image and checks `/healthz` and the frontend HTML.
3. Trivy scans the final runtime image's OS and library packages. Any HIGH or
   CRITICAL finding fails CI, including findings without fixes. Scanner errors
   also fail CI. The text report is retained for 14 days even after failure.
4. Only successful CI saves the image and its archive checksum. The image
   artifact is retained for one day.
5. CD uses `needs: ci`, downloads the artifact from the same run, checks its
   checksum, and verifies the loaded Docker image ID against CI's output.
6. CD exchanges GitHub's OIDC token for temporary Azure credentials, logs in to
   ACR, tags the loaded image as `<login-server>/todo-list:<full-commit-sha>`,
   pushes it, and queries ACR to verify the tag and record its registry digest.
   It then pulls by that digest and verifies the image ID still matches CI.

CD runs only in `jordannaegle/TodoList` on the exact assignment branch, for
push/manual events. PRs and other branches cannot publish. Only CD has
`id-token: write`. No client secret, ACR admin password, VM, or cluster is used.
The pipeline compares the Docker image identifier reported by `docker inspect`
before and after transfer and publication. A registry digest identifies the
manifest or OCI index; its relationship to Docker's reported identifier depends
on the image store and image format, so the workflow checks actual values.

## 1. Create ACR in the Azure portal

1. Sign in to [Azure portal](https://portal.azure.com) with the account attached
   to your student subscription. Confirm the intended subscription is active.
2. Search **Container registries**, select **Create**.
3. Choose your student subscription; create resource group `rg-it3200-cicd`.
4. Choose a globally unique registry name containing only letters and digits,
   for example `jordanit3200` plus a short unique suffix. Record the actual name.
5. Choose an available nearby region and the **Basic** pricing tier.
6. Use **RBAC Registry Permissions** as the role assignment permissions mode.
   Keep the admin user disabled. Use public network access for the GitHub-hosted
   runner. Review the displayed cost, then create the registry when ready.
7. Open its Overview and copy the **Login server**. Use that exact server when
   checking the final image; newer registry names may include a DNS suffix.

ACR is a billable resource even without a running application. Delete this
assignment's resources after grading when you no longer need the image.

## 2. Configure an OIDC identity

### If the university blocks Entra ID / App registrations (401)

The portal confirmed the `uvu-jordan-naegle` subscription is active and the user
has Owner access. Registry `jordanit3200` exists in `rg-it3200-cicd`, North Central
US. App registrations and the Entra overview both returned 401. This alone does
not establish the exact tenant policy causing the denial.

Use a **user-assigned managed identity** through Azure Resource Manager. Azure
Login supports OIDC federation with this identity as well as app registrations;
the workflow YAML does not need to change. Creation can still be restricted by
subscription policy, so verify each operation succeeds.

1. Search the portal for **Managed Identities** > **Create**.
2. Select `uvu-jordan-naegle`, resource group `rg-it3200-cicd`, region **North
   Central US**, and name `it3200-todolist-github`. Review and create.
3. Open the identity and copy its **Client ID** for `AZURE_CLIENT_ID`.
   Its **Principal ID** is a different identifier used for role assignment.
4. Open **Settings > Federated credentials > Add credential**. Choose **GitHub
   Actions deploying Azure resources**, then use the same organization,
   repository, branch, issuer, audience, and subject shown in the table below.
5. For step 3's registry role assignments, choose member type **Managed
   identity**, identity type **User-assigned managed identity**, and select this
   identity. Grant registry-scoped **AcrPush** plus **Reader**.
6. Use tenant ID `1ea2b65f-2f5e-440e-b025-dfdfafd8e097`, subscription ID
   `b5352350-3f6f-4580-8b5b-c228a662df25`, and `ACR_NAME=jordanit3200` for the
   remaining GitHub variables. These are resource/account identifiers, not keys.

Use the dedicated assignment identity rather than an identity from another project.
No VM attachment or `auth-type: IDENTITY` is needed: this uses federated OIDC
on the GitHub-hosted runner.

[Microsoft's managed identity federation guide](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust-user-assigned-managed-identity)
documents this supported setup.

### App registration route, when permitted by your tenant

1. Search **Microsoft Entra ID** > **App registrations** > **New registration**.
2. Name it `it3200-todolist-github`. Choose the current directory only; no redirect
   URI is needed. Register it.
3. Copy **Application (client) ID** and **Directory (tenant) ID** from Overview.
4. Open **Certificates & secrets** > **Federated credentials** > **Add credential**.
5. Choose **GitHub Actions deploying Azure resources** and enter:

   | Field | Exact value |
   | --- | --- |
   | Organization | `jordannaegle` |
   | Organization ID | `79476521` |
   | Repository | `TodoList` |
   | Repository ID | `1391247999` |
   | Entity type | Branch |
   | Branch | `codex/azure-container-pipeline` |
   | Credential name | `github-todolist-assignment-branch` |
   | Issuer | `https://token.actions.githubusercontent.com` |
   | Audience | `api://AzureADTokenExchange` |

6. Confirm the generated subject is exactly:

   ```text
   repo:jordannaegle@79476521/TodoList@1391247999:ref:refs/heads/codex/azure-container-pipeline
   ```

7. GitHub's OIDC settings API confirmed `use_immutable_subject: true` and prefix
   `repo:jordannaegle@79476521/TodoList@1391247999` for this fork. Organization ID
   means the numeric GitHub owner ID, even for a personal account. It is not the
   username or Azure tenant ID. Add the credential. Do not create a client secret.
   Do not add a GitHub
   Environment to the publish job without updating federation: it changes the
   OIDC subject to an environment subject.

If your school tenant blocks app registration or role assignment, ask the
subscription/tenant administrator for those specific operations. Creating an
ACR alone does not grant the pipeline access.

## 3. Grant registry-scoped push permission

1. Open your **ACR resource**, then **Access control (IAM)** > **Add role assignment**.
2. Select **AcrPush**. It permits image push/pull; assign it at this ACR only.
3. Choose **User, group, or service principal**, then select the
   `it3200-todolist-github` app/service principal.
4. Review and assign. Allow a few minutes for permissions to propagate.
5. Add a second role assignment for the same app: **Reader**, also scoped only
   to this registry. This allows the workflow to read the actual login server
   with `az acr show`; AcrPush supplies image data access.
6. Copy your **Subscription ID** from the registry Overview or Subscriptions.

This guide deliberately uses the registry's **RBAC Registry Permissions** mode.
If you created a registry with **RBAC Registry + ABAC Repository Permissions**,
`AcrPush` is not honored. Use **Container Registry Repository Writer** for data
access and **Reader** at this registry for the workflow's `az acr show` query,
or recreate this lab registry in the documented RBAC mode before publishing.
The workflow verifies a specific image, so catalog-list permission is unnecessary.

## 4. Add four GitHub repository variables

Open [repository Actions variables](https://github.com/jordannaegle/TodoList/settings/variables/actions).
Under **Repository variables**, create these exact names:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Application (client) ID from the app registration |
| `AZURE_TENANT_ID` | Directory (tenant) ID |
| `AZURE_SUBSCRIPTION_ID` | Student subscription ID |
| `ACR_NAME` | Actual registry resource name, without `.azurecr.io` |

For the completed setup, `AZURE_CLIENT_ID` is the managed identity's Client ID,
`30222b82-997d-48f3-91fa-05e05a4c0dfe`. Its principal/object ID is
`a73b384f-926c-4eb9-8da9-92ffdbde31a2`. Federation and registry-scoped AcrPush and
Reader were verified in the portal, and all four variables were saved to GitHub.

These are identifiers, not passwords. This workflow reads `vars`, so creating
them only under Secrets will not satisfy its configuration check.

## 5. Run and verify

Push changes to `codex/azure-container-pipeline`. CI starts automatically.
For another run after fixing Azure setup, open that run and choose **Re-run all
jobs**. This creates a fresh image artifact with the current run attempt.
Use **Re-run all jobs**, rather than only failed jobs, after an artifact expires
or when the run attempt changes.

The **Run workflow** button for `workflow_dispatch` might not appear until the
workflow exists on the default branch (`master`). You do not need to merge for
this assignment: a branch push triggers it. Alternatively, make a small useful
documentation update and push to the assignment branch.

In Actions, expect both **CI - build, test, and scan** and **CD - publish validated
image to ACR** to be green. The run summary records the image, full commit tag,
registry digest, and scanned image ID. Then in Azure open the registry >
**Services > Repositories** > **todo-list** > the full commit tag. Verify its
digest matches the run summary. See `submission/README.md` for evidence.

## Troubleshooting

| Failure | What to check |
| --- | --- |
| Missing repository variable | Names and values under Actions **Variables**, not only Secrets |
| OIDC has no matching federated identity | Exact owner, case, repository, branch subject, issuer, and audience |
| Azure login fails | Client ID versus object ID; tenant and subscription must match |
| ACR access denied | App/service principal has registry-scoped AcrPush and Reader; verify registry permissions mode and allow propagation |
| Security scan fails | Download scan report; update affected runtime packages/base image and rebuild; keep the gate enabled |
| Image artifact missing | Re-run all jobs to regenerate the one-day artifact |
| Image missing in portal | Check the subscription/registry and `todo-list` repository; tag is the full commit SHA |
| PR CD is skipped | Expected: PRs validate only and cannot request Azure credentials |

Only the final runtime image is scanned; this does not replace source/dependency
analysis of the build stage. The repository currently has no application unit
test files; the pipeline's runtime smoke test validates the built container.

## Official references

- [Azure Login with OIDC](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
- [Create ACR in the portal](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-get-started-portal)
- [ACR roles and permissions modes](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-overview)
- [Trivy action and vulnerability gate inputs](https://github.com/aquasecurity/trivy-action)
