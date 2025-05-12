#!/bin/bash
# assign_sso_permissions.sh - Assign permission sets to users in IAM Identity Center
#
# Description:
#   This script assigns permission sets (like AdministratorAccess) to users in
#   IAM Identity Center across specific AWS accounts.
#
# Usage:
#   ./assign_sso_permissions.sh -p PROFILE -u USERNAME -a ACCOUNT_ID -r PERMISSION_SET [-h]
#
# Parameters:
#   -p PROFILE          AWS CLI profile to use (required)
#   -u USERNAME         IAM Identity Center username to assign permissions to (required)
#   -a ACCOUNT_ID       AWS account ID to grant access to (required)
#   -r PERMISSION_SET   Permission set name to assign (default: "AdministratorAccess")
#   -h                  Display this help message and exit
#
# Examples:
#   ./assign_sso_permissions.sh -p thehobbyhome-admin -u admin -a 123456789012
#   ./assign_sso_permissions.sh -p thehobbyhome-admin -u developer -a 123456789012 -r PowerUserAccess

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
AWS_PROFILE=""
USERNAME=""
ACCOUNT_ID=""
PERMISSION_SET="AdministratorAccess"

# Parse command line options
while getopts ":p:u:a:r:h" opt; do
    case ${opt} in
        p )
            AWS_PROFILE=$OPTARG
            ;;
        u )
            USERNAME=$OPTARG
            ;;
        a )
            ACCOUNT_ID=$OPTARG
            ;;
        r )
            PERMISSION_SET=$OPTARG
            ;;
        h )
            display_help
            ;;
        \? )
            echo "Invalid option: $OPTARG" 1>&2
            display_help
            ;;
        : )
            echo "Invalid option: $OPTARG requires an argument" 1>&2
            display_help
            ;;
    esac
done

# Check required parameters
if [ -z "$AWS_PROFILE" ] || [ -z "$USERNAME" ] || [ -z "$ACCOUNT_ID" ]; then
    echo "ERROR: Missing required parameters!" 1>&2
    echo "Required parameters: -p PROFILE -u USERNAME -a ACCOUNT_ID" 1>&2
    display_help
fi

# Validate AWS profile
if ! aws configure list --profile "$AWS_PROFILE" &>/dev/null; then
    echo "ERROR: AWS profile '$AWS_PROFILE' not found!" 1>&2
    exit 1
fi

# Validate account ID
if ! [[ "$ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
    echo "ERROR: Invalid account ID. Must be a 12-digit number." 1>&2
    exit 1
fi

# Main execution
echo "Assigning IAM Identity Center permissions..."
echo "  - AWS Profile: $AWS_PROFILE"
echo "  - Username: $USERNAME"
echo "  - Account ID: $ACCOUNT_ID"
echo "  - Permission Set: $PERMISSION_SET"
echo

# Get IAM Identity Center instance ARN and ID
echo "Retrieving IAM Identity Center instance..."
INSTANCE_ARN=$(aws sso-admin list-instances --profile "$AWS_PROFILE" --query "Instances[0].InstanceArn" --output text)
if [ -z "$INSTANCE_ARN" ] || [ "$INSTANCE_ARN" == "None" ]; then
    echo "ERROR: Could not find an IAM Identity Center instance. Make sure it's enabled." 1>&2
    exit 1
fi

IDENTITY_STORE_ID=$(aws sso-admin list-instances --profile "$AWS_PROFILE" --query "Instances[0].IdentityStoreId" --output text)
if [ -z "$IDENTITY_STORE_ID" ] || [ "$IDENTITY_STORE_ID" == "None" ]; then
    echo "ERROR: Could not find an identity store ID." 1>&2
    exit 1
fi

echo "Found IAM Identity Center instance: $INSTANCE_ARN"
echo "Found Identity Store ID: $IDENTITY_STORE_ID"

# Find the user ID
echo "Looking up user '$USERNAME'..."
USER_ID=$(aws identitystore list-users \
    --identity-store-id "$IDENTITY_STORE_ID" \
    --filters "AttributePath=UserName,AttributeValue=$USERNAME" \
    --profile "$AWS_PROFILE" \
    --query "Users[0].UserId" \
    --output text)

if [ -z "$USER_ID" ] || [ "$USER_ID" == "None" ]; then
    echo "ERROR: User '$USERNAME' not found in IAM Identity Center!" 1>&2
    exit 1
fi

echo "Found user ID: $USER_ID"

# Find the permission set ARN
echo "Looking up permission set '$PERMISSION_SET'..."
PERMISSION_SET_ARN=$(aws sso-admin list-permission-sets \
    --instance-arn "$INSTANCE_ARN" \
    --profile "$AWS_PROFILE" \
    --query "PermissionSets[]" \
    --output text)

if [ -z "$PERMISSION_SET_ARN" ] || [ "$PERMISSION_SET_ARN" == "None" ]; then
    echo "ERROR: No permission sets found in IAM Identity Center!" 1>&2
    exit 1
fi

# Get details of each permission set to find the matching one
PERMISSION_SET_ARN_FOUND=""
for PS_ARN in $PERMISSION_SET_ARN; do
    PS_NAME=$(aws sso-admin describe-permission-set \
        --instance-arn "$INSTANCE_ARN" \
        --permission-set-arn "$PS_ARN" \
        --profile "$AWS_PROFILE" \
        --query "PermissionSet.Name" \
        --output text)
    
    if [ "$PS_NAME" == "$PERMISSION_SET" ]; then
        PERMISSION_SET_ARN_FOUND="$PS_ARN"
        break
    fi
done

if [ -z "$PERMISSION_SET_ARN_FOUND" ]; then
    echo "ERROR: Permission set '$PERMISSION_SET' not found!" 1>&2
    echo "Available permission sets:"
    for PS_ARN in $PERMISSION_SET_ARN; do
        PS_NAME=$(aws sso-admin describe-permission-set \
            --instance-arn "$INSTANCE_ARN" \
            --permission-set-arn "$PS_ARN" \
            --profile "$AWS_PROFILE" \
            --query "PermissionSet.Name" \
            --output text)
        echo "  - $PS_NAME"
    done
    exit 1
fi

echo "Found permission set ARN: $PERMISSION_SET_ARN_FOUND"

# Check if the assignment already exists
echo "Checking if assignment already exists..."
EXISTING_ASSIGNMENT=$(aws sso-admin list-account-assignments \
    --instance-arn "$INSTANCE_ARN" \
    --account-id "$ACCOUNT_ID" \
    --permission-set-arn "$PERMISSION_SET_ARN_FOUND" \
    --profile "$AWS_PROFILE" \
    --query "AccountAssignments[?PrincipalId=='$USER_ID'].PrincipalId" \
    --output text)

if [ -n "$EXISTING_ASSIGNMENT" ] && [ "$EXISTING_ASSIGNMENT" != "None" ]; then
    echo "Assignment already exists for user '$USERNAME' in account $ACCOUNT_ID with permission set '$PERMISSION_SET'."
    exit 0
fi

# Create the assignment
echo "Creating assignment..."
aws sso-admin create-account-assignment \
    --instance-arn "$INSTANCE_ARN" \
    --target-id "$ACCOUNT_ID" \
    --target-type AWS_ACCOUNT \
    --permission-set-arn "$PERMISSION_SET_ARN_FOUND" \
    --principal-type USER \
    --principal-id "$USER_ID" \
    --profile "$AWS_PROFILE" > /dev/null

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create account assignment!" 1>&2
    exit 1
fi

echo "Successfully assigned permission set '$PERMISSION_SET' to user '$USERNAME' in account $ACCOUNT_ID."
echo
echo "Next steps:"
echo "1. The user can now sign in to the AWS access portal"
echo "2. They should have the assigned permissions in the specified account"
echo "3. To use these permissions via CLI, the user should configure an SSO profile with 'aws configure sso'"