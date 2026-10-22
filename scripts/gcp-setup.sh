#!/usr/bin/env bash
# One-time Google Cloud setup for the import service (docs/import-service.md).
# Run it in Cloud Shell, in the project that should host the service:
#
#   bash gcp-setup.sh [project-id]
#
# GitHub Actions signs in with GitHub's own short-lived token (workload identity
# federation), so there's no key to create or store. Only this repository can use it.
# Safe to run again.
set -euo pipefail

REPO=tywiththewifi/landing-page-harness
PROJECT_ID=${1:-$(gcloud config get-value project 2> /dev/null)}
if [ -z "$PROJECT_ID" ]; then
  echo "Pass the project ID: bash gcp-setup.sh my-project-id" >&2
  exit 1
fi
gcloud config set project "$PROJECT_ID" > /dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')
SA="github-deploy@$PROJECT_ID.iam.gserviceaccount.com"
POOL="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github"
# A new account can take a few seconds to be visible to IAM.
retry() { for _ in 1 2 3 4 5 6; do "$@" && return; sleep 10; done; return 1; }

echo "Enabling the APIs (takes a minute the first time)"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

echo "Service account $SA"
gcloud iam service-accounts describe "$SA" > /dev/null 2>&1 ||
  gcloud iam service-accounts create github-deploy --display-name "GitHub deploys"
for role in roles/run.admin roles/artifactregistry.admin roles/iam.serviceAccountUser; do
  retry gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA" --role "$role" --condition None > /dev/null
done

echo "Letting GitHub Actions in $REPO sign in as it"
gcloud iam workload-identity-pools describe github --location global > /dev/null 2>&1 ||
  gcloud iam workload-identity-pools create github --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers describe landing-page-harness --location global --workload-identity-pool github > /dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc landing-page-harness --location global --workload-identity-pool github \
    --display-name "landing-page-harness" \
    --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition "assertion.repository == '$REPO'"
retry gcloud iam service-accounts add-iam-policy-binding "$SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/$POOL/attribute.repository/$REPO" > /dev/null

cat << EOF

Done. In GitHub, open $REPO > Settings > Secrets and variables > Actions > Variables,
and add these two repository variables (they aren't secret):

  GCP_WORKLOAD_IDENTITY_PROVIDER  $POOL/providers/landing-page-harness
  GCP_SERVICE_ACCOUNT             $SA
EOF
