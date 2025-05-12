#!/bin/bash
# update_sso_domain.sh - Update IAM Identity Center domain for an AWS CLI profile
#
# Usage:
#   ./update_sso_domain.sh PROFILE DOMAIN
#
# Parameters:
#   PROFILE    AWS CLI profile name to update
#   DOMAIN     Your custom domain (without https:// or /start)
#
# Example:
#   ./update_sso_domain.sh sampleproject-admin sampleproject

# Check if correct number of arguments are provided
if [ $# -ne 2 ]; then
    echo "Usage: $0 PROFILE DOMAIN"
    echo "Example: $0 sampleproject-admin sampleproject"
    exit 1
fi

PROFILE=$1
DOMAIN=$2
NEW_URL="https://$DOMAIN.awsapps.com/start"

# Check if profile exists
if ! aws configure list --profile "$PROFILE" &>/dev/null; then
    echo "Error: Profile '$PROFILE' not found."
    exit 1
fi

# Get the SSO session name
SSO_SESSION=$(aws configure get sso_session --profile "$PROFILE" 2>/dev/null)

# Update the URL
if [ -n "$SSO_SESSION" ]; then
    # Profile uses sso_session
    aws configure set sso_start_url "$NEW_URL" --section "sso-session $SSO_SESSION"
    echo "Updated SSO session '$SSO_SESSION' with URL: $NEW_URL"
else
    # Profile has direct SSO config
    aws configure set sso_start_url "$NEW_URL" --profile "$PROFILE"
    echo "Updated profile '$PROFILE' with URL: $NEW_URL"
fi

echo "Done. You may need to logout and login again:"
echo "  aws sso logout --profile $PROFILE"
echo "  aws sso login --profile $PROFILE"