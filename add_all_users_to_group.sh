#!/bin/bash
# add_all_users_to_group.sh - Add all existing users to a group and assign permissions
#
# Description:
#   This script adds all existing users in IAM Identity Center to a specified group
#   and optionally assigns a permission set to that group for specified accounts.
#
# Usage:
#   ./add_all_users_to_group.sh -p PROFILE -g GROUP_NAME [-c] [-a "ACCOUNT1 ACCOUNT2..."] [-r PERMISSION_SET] [-h]
#
# Parameters:
#   -p PROFILE      AWS CLI profile to use (required)
#   -g GROUP_NAME   Name of the group to add users to (required)
#   -c              Create the group if it doesn't exist (optional)
#   -d DESCRIPTION  Description for the group if creating it (optional, default: "Group created by script")
#   -a ACCOUNTS     Space-separated list of account IDs to grant access to, in quotes (optional)
#   -r PERMISSION   Permission set name to assign (optional, default: "AWSAdministratorAccess")
#   -h              Display this help message and exit
#
# Examples:
#   ./add_all_users_to_group.sh -p admin-profile -g AdminGroup -c -d "Administrators Group"
#   ./add_all_users_to_group.sh -p admin-profile -g AdminGroup -a "123456789012 234567890123" -r AWSAdministratorAccess

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
AWS_PROFILE=""
GROUP_NAME=""
CREATE_GROUP=false
DESCRIPTION="Group created by add_all_users_to_group.sh script"
ACCOUNTS=""
PERMISSION_SET="AWSAdministratorAccess"

# Parse command line options
while getopts ":p:g:cd:a:r:h" opt; do
    case ${opt} in
        p )
            AWS_PROFILE=$OPTARG
            ;;
        g )
            GROUP_NAME=$OPTARG
            ;;
        c )
            CREATE_GROUP=true
            ;;
        d )
            DESCRIPTION=$OPTARG
            ;;
        a )
            ACCOUNTS=$OPTARG
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
if [ -z "$AWS_PROFILE" ] || [ -z "$GROUP_NAME" ]; then
    echo "ERROR: Missing required parameters!" 1>&2
    echo "Required parameters: -p PROFILE -g GROUP_NAME" 1>&2
    display_help
fi

# Validate AWS profile
if ! aws configure list --profile "$AWS_PROFILE" &>/dev/null; then
    echo "ERROR: AWS profile '$AWS_PROFILE' not found!" 1>&2
    exit 1
fi

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

# Check if the group already exists
echo "Checking if group '$GROUP_NAME' already exists..."
GROUP_ID=$(aws identitystore list-groups \
    --identity-store-id "$IDENTITY_STORE_ID" \
    --filters "AttributePath=DisplayName,AttributeValue=$GROUP_NAME" \
    --profile "$AWS_PROFILE" \
    --query "Groups[0].GroupId" \
    --output text)

# Create the group if it doesn't exist and requested
if [ -z "$GROUP_ID" ] || [ "$GROUP_ID" == "None" ]; then
    if [ "$CREATE_GROUP" = true ]; then
        echo "Creating group '$GROUP_NAME'..."
        GROUP_ID=$(aws identitystore create-group \
            --identity-store-id "$IDENTITY_STORE_ID" \
            --display-name "$GROUP_NAME" \
            --description "$DESCRIPTION" \
            --profile "$AWS_PROFILE" \
            --query "GroupId" \
            --output text)
        
        if [ -z "$GROUP_ID" ] || [ "$GROUP_ID" == "None" ]; then
            echo "ERROR: Failed to create group '$GROUP_NAME'!" 1>&2
            exit 1
        fi
        
        echo "Successfully created group: $GROUP_NAME with ID: $GROUP_ID"
    else
        echo "ERROR: Group '$GROUP_NAME' does not exist and -c option not specified!" 1>&2
        exit 1
    fi
else
    echo "Group '$GROUP_NAME' already exists with ID: $GROUP_ID"
fi

# Get all users
echo "Retrieving all users from IAM Identity Center..."
USERS_JSON=$(aws identitystore list-users \
    --identity-store-id "$IDENTITY_STORE_ID" \
    --profile "$AWS_PROFILE" \
    --query "Users[].{Id:UserId,Username:UserName}" \
    --output json)

USER_COUNT=$(echo "$USERS_JSON" | jq length)
if [ "$USER_COUNT" -eq 0 ]; then
    echo "No users found in IAM Identity Center."
    exit 0
fi

echo "Found $USER_COUNT users."

# Add all users to the group
echo "Adding all users to group '$GROUP_NAME'..."
ADDED_COUNT=0
ALREADY_MEMBER_COUNT=0
FAILED_COUNT=0

for ((i=0; i<$USER_COUNT; i++)); do
    USER_ID=$(echo "$USERS_JSON" | jq -r ".[$i].Id")
    USERNAME=$(echo "$USERS_JSON" | jq -r ".[$i].Username")
    
    echo "  Processing user '$USERNAME'..."
    
    # Check if user is already in the group
    MEMBERSHIP_ID=$(aws identitystore list-group-memberships \
        --identity-store-id "$IDENTITY_STORE_ID" \
        --group-id "$GROUP_ID" \
        --profile "$AWS_PROFILE" \
        --query "GroupMemberships[?contains(MemberId.UserId, '$USER_ID')].MembershipId" \
        --output text)
    
    if [ -n "$MEMBERSHIP_ID" ] && [ "$MEMBERSHIP_ID" != "None" ]; then
        echo "  User '$USERNAME' is already a member of the group."
        ALREADY_MEMBER_COUNT=$((ALREADY_MEMBER_COUNT+1))
        continue
    fi
    
    # Add user to the group
    aws identitystore create-group-membership \
        --identity-store-id "$IDENTITY_STORE_ID" \
        --group-id "$GROUP_ID" \
        --member-id "UserId=$USER_ID" \
        --profile "$AWS_PROFILE" > /dev/null
    
    if [ $? -ne 0 ]; then
        echo "  WARNING: Failed to add user '$USERNAME' to group!" 1>&2
        FAILED_COUNT=$((FAILED_COUNT+1))
    else
        echo "  Successfully added user '$USERNAME' to group."
        ADDED_COUNT=$((ADDED_COUNT+1))
    fi
done

echo "User addition summary:"
echo "  - Users already in group: $ALREADY_MEMBER_COUNT"
echo "  - Users successfully added: $ADDED_COUNT"
echo "  - Users failed to add: $FAILED_COUNT"

# Assign permission set to the group for specified accounts
if [ -n "$ACCOUNTS" ]; then
    echo "Assigning '$PERMISSION_SET' permission set to group for specified accounts..."
    
    # Find the permission set ARN
    PERMISSION_SETS=$(aws sso-admin list-permission-sets \
        --instance-arn "$INSTANCE_ARN" \
        --profile "$AWS_PROFILE" \
        --query "PermissionSets[]" \
        --output text)
    
    PERMISSION_SET_ARN=""
    for PS_ARN in $PERMISSION_SETS; do
        PS_NAME=$(aws sso-admin describe-permission-set \
            --instance-arn "$INSTANCE_ARN" \
            --permission-set-arn "$PS_ARN" \
            --profile "$AWS_PROFILE" \
            --query "PermissionSet.Name" \
            --output text)
        
        if [ "$PS_NAME" == "$PERMISSION_SET" ]; then
            PERMISSION_SET_ARN="$PS_ARN"
            break
        fi
    done
    
    if [ -z "$PERMISSION_SET_ARN" ]; then
        echo "ERROR: Permission set '$PERMISSION_SET' not found!" 1>&2
        echo "Available permission sets:"
        for PS_ARN in $PERMISSION_SETS; do
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
    
    echo "Found permission set ARN: $PERMISSION_SET_ARN"
    
    # Process each account
    for ACCOUNT_ID in $ACCOUNTS; do
        echo "  Processing account $ACCOUNT_ID..."
        
        # Validate account ID
        if ! [[ "$ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
            echo "  WARNING: Invalid account ID '$ACCOUNT_ID'. Must be a 12-digit number. Skipping." 1>&2
            continue
        fi
        
        # Check if the assignment already exists
        EXISTING_ASSIGNMENT=$(aws sso-admin list-account-assignments \
            --instance-arn "$INSTANCE_ARN" \
            --account-id "$ACCOUNT_ID" \
            --permission-set-arn "$PERMISSION_SET_ARN" \
            --profile "$AWS_PROFILE" \
            --query "AccountAssignments[?PrincipalId=='$GROUP_ID' && PrincipalType=='GROUP'].PrincipalId" \
            --output text)
        
        if [ -n "$EXISTING_ASSIGNMENT" ] && [ "$EXISTING_ASSIGNMENT" != "None" ]; then
            echo "  Assignment already exists for group '$GROUP_NAME' in account $ACCOUNT_ID with permission set '$PERMISSION_SET'."
            continue
        fi
        
        # Create the assignment
        aws sso-admin create-account-assignment \
            --instance-arn "$INSTANCE_ARN" \
            --target-id "$ACCOUNT_ID" \
            --target-type AWS_ACCOUNT \
            --permission-set-arn "$PERMISSION_SET_ARN" \
            --principal-type GROUP \
            --principal-id "$GROUP_ID" \
            --profile "$AWS_PROFILE" > /dev/null
        
        if [ $? -ne 0 ]; then
            echo "  ERROR: Failed to create account assignment for account $ACCOUNT_ID!" 1>&2
        else
            echo "  Successfully assigned permission set '$PERMISSION_SET' to group '$GROUP_NAME' in account $ACCOUNT_ID."
        fi
    done
fi

echo "Group management completed successfully."