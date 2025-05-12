#!/bin/bash
# delete_root_user_access_key.sh - Delete root user access keys
#
# Description:
#   This script deletes all access keys associated with the AWS root user account.
#   This is a security best practice once administrative users have been created
#   through IAM Identity Center, as the root user should not have programmatic access.
#
# Usage:
#   ./delete_root_user_access_key.sh [-p PROFILE] [-y] [-h]
#
# Parameters:
#   -p PROFILE      AWS CLI profile name (optional, default: sampleproject)
#   -y              Skip confirmation prompts (optional)
#   -h              Display this help message and exit

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
PROFILE="sampleproject"
FORCE_YES=false

# Parse command line options
while getopts ":p:yh" opt; do
    case ${opt} in
        p )
            PROFILE=$OPTARG
            ;;
        y )
            FORCE_YES=true
            ;;
        h )
            display_help
            ;;
        \? )
            echo "ERROR: Invalid option: $OPTARG" 1>&2
            display_help
            ;;
        : )
            echo "ERROR: Invalid option: $OPTARG requires an argument" 1>&2
            display_help
            ;;
    esac
done

# Function to prompt for a yes/no answer
prompt_yes_no() {
    local prompt=$1
    local default=${2:-"y"}
    local answer
    
    # If force yes is enabled, skip the prompt
    if [ "$FORCE_YES" = true ]; then
        return 0
    fi
    
    if [ "$default" = "y" ]; then
        prompt="$prompt [Y/n]: "
    else
        prompt="$prompt [y/N]: "
    fi
    
    while true; do
        read -p "$prompt" answer
        answer=${answer:-$default}
        
        case ${answer:0:1} in
            y|Y )
                return 0
                ;;
            n|N )
                return 1
                ;;
            * )
                echo "Please answer yes (y) or no (n)."
                ;;
        esac
    done
}

# Display a security warning
echo
echo "==================================================================="
echo "  WARNING: ROOT USER ACCESS KEY DELETION"
echo "==================================================================="
echo
echo "This script will delete all access keys associated with the AWS root user."
echo "This is a security best practice and should be done after administrative"
echo "users have been created through IAM Identity Center."
echo
echo "Make sure you have verified that your IAM Identity Center administrator"
echo "accounts are working properly before proceeding."
echo

# Confirm that the user wants to proceed
if ! prompt_yes_no "Do you want to proceed with deleting the root user access keys?"; then
    echo "Operation canceled."
    exit 0
fi

# Verify the profile
echo "Verifying AWS profile '$PROFILE'..."
if ! aws sts get-caller-identity --profile "$PROFILE" > /dev/null 2>&1; then
    echo "ERROR: Could not validate AWS profile '$PROFILE'. Please check the profile and try again." 1>&2
    exit 1
fi

# Get the account ID
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query "Account" --output text)
echo "Working with AWS account: $ACCOUNT_ID"

# Get all access keys for the root user
echo "Retrieving access keys for the root user..."
KEY_LIST=$(aws iam list-access-keys --profile "$PROFILE" --query "AccessKeyMetadata[].AccessKeyId" --output json)

if [ "$KEY_LIST" = "[]" ] || [ -z "$KEY_LIST" ]; then
    echo "No access keys found for the root user."
    exit 0
fi

echo "Found the following access keys:"
echo "$KEY_LIST" | jq -r '.[]'

# Final confirmation
if ! prompt_yes_no "Are you sure you want to delete these access keys? This action cannot be undone." "n"; then
    echo "Operation canceled."
    exit 0
fi

# Delete each access key
for KEY_ID in $(echo "$KEY_LIST" | jq -r '.[]'); do
    echo "Deleting access key: $KEY_ID"
    if aws iam delete-access-key --profile "$PROFILE" --access-key-id "$KEY_ID"; then
        echo "Successfully deleted access key: $KEY_ID"
    else
        echo "ERROR: Failed to delete access key: $KEY_ID" 1>&2
        exit 1
    fi
done

echo
echo "==================================================================="
echo "  SUCCESS: All root user access keys have been deleted"
echo "==================================================================="
echo
echo "You should now use IAM Identity Center (SSO) for all AWS access."
echo "The root user should only be used for account recovery or critical"
echo "account-level operations that cannot be performed by IAM users."
echo

exit 0