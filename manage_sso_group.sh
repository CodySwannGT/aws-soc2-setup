#!/bin/bash
# manage_sso_group.sh - Create and manage groups in IAM Identity Center
#
# Description:
#   This script creates groups in IAM Identity Center and adds users to them.
#   It can also assign permission sets to groups across AWS accounts.
#
# Usage:
#   ./manage_sso_group.sh -p PROFILE -g GROUP_NAME [-d DESCRIPTION] [-a ACCOUNT_ID] [-r PERMISSION_SET] [-u "USERNAME1 USERNAME2 ..."] [-h]
#
# Parameters:
#   -p PROFILE      AWS CLI profile to use (required)
#   -g GROUP_NAME   Name of the group to create or manage (required)
#   -d DESCRIPTION  Description for the group (optional)
#   -a ACCOUNT_ID   AWS account ID to grant access to (optional)
#   -r PERMISSION   Permission set name to assign (optional, default: "AdministratorAccess")
#   -u USERS        Space-separated list of usernames to add to the group (optional)
#   -h              Display this help message and exit
#
# Examples:
#   ./manage_sso_group.sh -p admin-profile -g AdminGroup -d "Administrators Group"
#   ./manage_sso_group.sh -p admin-profile -g AdminGroup -a 123456789012 -r AdministratorAccess
#   ./manage_sso_group.sh -p admin-profile -g AdminGroup -u "user1 user2 user3"

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
AWS_PROFILE=""
GROUP_NAME=""
DESCRIPTION=""
ACCOUNT_ID=""
PERMISSION_SET="AdministratorAccess"
USERS=""

# Parse command line options
while getopts ":p:g:d:a:r:u:h" opt; do
    case ${opt} in
        p )
            AWS_PROFILE=$OPTARG
            ;;
        g )
            GROUP_NAME=$OPTARG
            ;;
        d )
            DESCRIPTION=$OPTARG
            ;;
        a )
            ACCOUNT_ID=$OPTARG
            ;;
        r )
            PERMISSION_SET=$OPTARG
            ;;
        u )
            USERS=$OPTARG
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

# Set default description if not provided
if [ -z "$DESCRIPTION" ]; then
    DESCRIPTION="Group created by manage_sso_group.sh script"
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

# Create the group if it doesn't exist
if [ -z "$GROUP_ID" ] || [ "$GROUP_ID" == "None" ]; then
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
    echo "Group '$GROUP_NAME' already exists with ID: $GROUP_ID"
fi

# Add users to the group if specified
if [ -n "$USERS" ]; then
    echo "Adding users to group '$GROUP_NAME'..."
    
    for username in $USERS; do
        echo "  Processing user '$username'..."
        
        # Find the user ID
        USER_ID=$(aws identitystore list-users \
            --identity-store-id "$IDENTITY_STORE_ID" \
            --filters "AttributePath=UserName,AttributeValue=$username" \
            --profile "$AWS_PROFILE" \
            --query "Users[0].UserId" \
            --output text)
        
        if [ -z "$USER_ID" ] || [ "$USER_ID" == "None" ]; then
            echo "  WARNING: User '$username' not found. Skipping." 1>&2
            continue
        fi
        
        # Check if user is already in the group
        MEMBERSHIP_ID=$(aws identitystore list-group-memberships \
            --identity-store-id "$IDENTITY_STORE_ID" \
            --group-id "$GROUP_ID" \
            --profile "$AWS_PROFILE" \
            --query "GroupMemberships[?contains(MemberId.UserId, '$USER_ID')].MembershipId" \
            --output text)
        
        if [ -n "$MEMBERSHIP_ID" ] && [ "$MEMBERSHIP_ID" != "None" ]; then
            echo "  User '$username' is already a member of the group."
            continue
        fi
        
        # Add user to the group
        aws identitystore create-group-membership \
            --identity-store-id "$IDENTITY_STORE_ID" \
            --group-id "$GROUP_ID" \
            --member-id "UserId=$USER_ID" \
            --profile "$AWS_PROFILE" > /dev/null
        
        if [ $? -ne 0 ]; then
            echo "  WARNING: Failed to add user '$username' to group!" 1>&2
        else
            echo "  Successfully added user '$username' to group."
        fi
    done
fi

# Add all existing users to the group
if [ "$USERS" = "ALL" ]; then
    echo "Adding all existing users to group '$GROUP_NAME'..."
    
    # List all users
    USERS_JSON=$(aws identitystore list-users \
        --identity-store-id "$IDENTITY_STORE_ID" \
        --profile "$AWS_PROFILE" \
        --query "Users[].{Id:UserId,Username:UserName}" \
        --output json)
    
    # Process each user
    USER_COUNT=$(echo "$USERS_JSON" | jq length)
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
        else
            echo "  Successfully added user '$USERNAME' to group."
        fi
    done
fi

# Assign permission set to the group for a specific account if specified
if [ -n "$ACCOUNT_ID" ]; then
    echo "Assigning '$PERMISSION_SET' permission set to group for account $ACCOUNT_ID..."
    
    # Validate account ID
    if ! [[ "$ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
        echo "ERROR: Invalid account ID. Must be a 12-digit number." 1>&2
        exit 1
    fi
    
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
    
    # Check if the assignment already exists
    EXISTING_ASSIGNMENT=$(aws sso-admin list-account-assignments \
        --instance-arn "$INSTANCE_ARN" \
        --account-id "$ACCOUNT_ID" \
        --permission-set-arn "$PERMISSION_SET_ARN" \
        --profile "$AWS_PROFILE" \
        --query "AccountAssignments[?PrincipalId=='$GROUP_ID' && PrincipalType=='GROUP'].PrincipalId" \
        --output text)
    
    if [ -n "$EXISTING_ASSIGNMENT" ] && [ "$EXISTING_ASSIGNMENT" != "None" ]; then
        echo "Assignment already exists for group '$GROUP_NAME' in account $ACCOUNT_ID with permission set '$PERMISSION_SET'."
    else
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
            echo "ERROR: Failed to create account assignment!" 1>&2
            exit 1
        fi
        
        echo "Successfully assigned permission set '$PERMISSION_SET' to group '$GROUP_NAME' in account $ACCOUNT_ID."
    fi
fi

echo "Group management completed successfully."