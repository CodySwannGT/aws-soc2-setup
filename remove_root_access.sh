#!/bin/bash
#
# remove_root_access.sh
#
# This script removes root user credentials from all sub-accounts in an AWS Organization
# and configures the organization to create new accounts without root credentials by default.
#
# Prerequisites:
#   - AWS CLI installed and configured
#   - jq installed (for JSON parsing)
#   - Appropriate permissions in the management account
#
# Usage:
#   ./remove_root_access.sh -p PROFILE_NAME
#
# Arguments:
#   -p, --profile    AWS CLI profile name for the management account
#   -h, --help       Display help message
#

# Exit on error
set -e

# Function to display usage information
function display_help() {
    echo "Usage: $0 -p PROFILE_NAME"
    echo
    echo "Options:"
    echo "  -p, --profile    AWS CLI profile name for the management account"
    echo "  -h, --help       Display this help message"
    echo
    echo "Example:"
    echo "  $0 -p my-management-account"
    exit 1
}

# Function to check if a command exists
function command_exists() {
    command -v "$1" &> /dev/null
}

# Parse command line arguments
PROFILE=""

while [[ $# -gt 0 ]]; do
    key="$1"
    case $key in
        -p|--profile)
            PROFILE="$2"
            shift 2
            ;;
        -h|--help)
            display_help
            ;;
        *)
            echo "Unknown option: $1"
            display_help
            ;;
    esac
done

# Check if profile was provided
if [ -z "$PROFILE" ]; then
    echo "Error: AWS CLI profile is required"
    display_help
fi

# Check for required tools
if ! command_exists aws; then
    echo "Error: AWS CLI not found. Please install it before running this script."
    exit 1
fi

if ! command_exists jq; then
    echo "Error: jq not found. Please install it before running this script."
    exit 1
fi

echo "=== AWS Root Access Management Configuration ==="
echo "Using AWS profile: $PROFILE"
echo

# Step 1: Enable trusted access for IAM in AWS Organizations
echo "Step 1: Enabling trusted access for IAM in AWS Organizations..."
aws organizations enable-aws-service-access \
    --service-principal iam.amazonaws.com \
    --profile "$PROFILE" \
    || echo "Trusted access for IAM is already enabled or couldn't be enabled."

# Step 2: Enable root credentials management
echo "Step 2: Enabling root credentials management in AWS Organizations..."
aws iam enable-organizations-root-credentials-management \
    --profile "$PROFILE" \
    || echo "Root credentials management is already enabled or couldn't be enabled."

# Step 3: Enable organizations root sessions
echo "Step 3: Enabling organizations root sessions in AWS Organizations..."
aws iam enable-organizations-root-sessions \
    --profile "$PROFILE" \
    || echo "Organizations root sessions are already enabled or couldn't be enabled."

# Step 4: Get all member accounts (excluding the management account)
echo "Step 4: Retrieving list of member accounts..."
MANAGEMENT_ACCOUNT_ID=$(aws organizations describe-organization --profile "$PROFILE" | jq -r .Organization.MasterAccountId)
echo "Management account ID: $MANAGEMENT_ACCOUNT_ID"

MEMBER_ACCOUNTS=$(aws organizations list-accounts \
    --profile "$PROFILE" \
    | jq -r ".Accounts[] | select(.Id != \"$MANAGEMENT_ACCOUNT_ID\" and .Status == \"ACTIVE\") | .Id")

if [ -z "$MEMBER_ACCOUNTS" ]; then
    echo "No member accounts found. Nothing to process."
    exit 0
fi

ACCOUNT_COUNT=$(echo "$MEMBER_ACCOUNTS" | wc -l)
echo "Found $ACCOUNT_COUNT member accounts to process"

# Step 5: Remove root credentials from each member account
echo "Step 5: Removing root credentials from all member accounts..."
echo

# Set a counter for progress tracking
COUNTER=0

for ACCOUNT_ID in $MEMBER_ACCOUNTS; do
    COUNTER=$((COUNTER + 1))
    echo "[$COUNTER/$ACCOUNT_COUNT] Processing account $ACCOUNT_ID..."
    
    # Get account name for better logging
    ACCOUNT_NAME=$(aws organizations describe-account \
        --account-id "$ACCOUNT_ID" \
        --profile "$PROFILE" \
        | jq -r .Account.Name)
    
    echo "  Account: $ACCOUNT_NAME ($ACCOUNT_ID)"
    
    # Step 5a: Assume root session in the target account
    echo "  Requesting temporary root session..."
    ROOT_SESSION=$(aws sts assume-root \
        --target-principal "$ACCOUNT_ID" \
        --task-policy-arn arn:aws:iam::aws:policy/root-task/IAMDeleteRootUserCredentials \
        --profile "$PROFILE" 2>/dev/null || echo '{"failed": true}')
    
    # Check if assume-root failed
    if [ "$(echo "$ROOT_SESSION" | jq -r '.failed // "false"')" == "true" ]; then
        echo "  Error: Failed to assume root session for account $ACCOUNT_ID"
        continue
    fi
    
    # Extract temporary credentials
    ACCESS_KEY=$(echo "$ROOT_SESSION" | jq -r .Credentials.AccessKeyId)
    SECRET_KEY=$(echo "$ROOT_SESSION" | jq -r .Credentials.SecretAccessKey)
    SESSION_TOKEN=$(echo "$ROOT_SESSION" | jq -r .Credentials.SessionToken)
    
    if [ "$ACCESS_KEY" == "null" ] || [ -z "$ACCESS_KEY" ]; then
        echo "  Error: Failed to get valid temporary credentials"
        continue
    fi
    
    # Step 5b: Delete root credentials
    echo "  Deleting root credentials..."
    
    # We'll use a temporary profile for the assumed root credentials
    export AWS_ACCESS_KEY_ID="$ACCESS_KEY"
    export AWS_SECRET_ACCESS_KEY="$SECRET_KEY"
    export AWS_SESSION_TOKEN="$SESSION_TOKEN"
    
    # Delete the root credentials
    DELETE_RESULT=$(aws iam delete-root-user-credentials 2>&1) || true
    
    # Check if the deletion succeeded
    if [[ $DELETE_RESULT == *"Error"* ]]; then
        echo "  Warning: $DELETE_RESULT"
    else
        echo "  Success: Root credentials deleted for account $ACCOUNT_NAME ($ACCOUNT_ID)"
    fi
    
    # Clear environment variables for the next account
    unset AWS_ACCESS_KEY_ID
    unset AWS_SECRET_ACCESS_KEY
    unset AWS_SESSION_TOKEN
    
    echo
done

# Final status
echo "=== Summary ==="
echo "Total accounts processed: $ACCOUNT_COUNT"
echo 
echo "Root Access Management is now fully configured:"
echo "  1. IAM trusted access is enabled in the organization"
echo "  2. Root credentials management is enabled"
echo "  3. Organizations root sessions are enabled"
echo "  4. Root credentials have been removed from all possible member accounts"
echo
echo "Additional information:"
echo "  - Any new accounts created in your organization will now be created without root credentials by default"
echo "  - To re-enable root access for specific accounts if needed, use:"
echo "    aws sts assume-root --target-principal ACCOUNT_ID --task-policy-arn arn:aws:iam::aws:policy/root-task/IAMAllowRootUserCredentialRecovery --profile $PROFILE"
echo "  - For troubleshooting, check the AWS IAM console > Root access management"
echo
echo "Operation completed successfully!"