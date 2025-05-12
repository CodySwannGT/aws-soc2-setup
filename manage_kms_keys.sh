#!/bin/bash
# manage_kms_keys.sh - Manage KMS keys for AWS Control Tower
#
# Description:
#   This script helps manage KMS keys created for AWS Control Tower, allowing
#   you to add administrators, update key policies, and check key status.
#
# Usage:
#   ./manage_kms_keys.sh -p PROFILE -k KEY_ID [-a ADD_ADMIN] [-r REMOVE_ADMIN] [-s] [-e] [-d] [-h]
#
# Parameters:
#   -p PROFILE       AWS CLI profile to use (required)
#   -k KEY_ID        The KMS key ID to manage (required)
#   -a ADD_ADMIN     ARN of IAM user/role to add as key administrator (optional)
#   -r REMOVE_ADMIN  ARN of IAM user/role to remove as key administrator (optional)
#   -s               Show the current key policy (optional)
#   -e               Enable automatic key rotation (optional)
#   -d               Disable automatic key rotation (optional)
#   -h               Display this help message and exit
#
# Examples:
#   ./manage_kms_keys.sh -p sampleproject-admin -k 1234abcd-12ab-34cd-56ef-1234567890ab -s
#   ./manage_kms_keys.sh -p sampleproject-admin -k 1234abcd-12ab-34cd-56ef-1234567890ab -a "arn:aws:iam::123456789012:role/AdminRole"
#   ./manage_kms_keys.sh -p sampleproject-admin -k 1234abcd-12ab-34cd-56ef-1234567890ab -e

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
AWS_PROFILE=""
KEY_ID=""
ADD_ADMIN=""
REMOVE_ADMIN=""
SHOW_POLICY=false
ENABLE_ROTATION=false
DISABLE_ROTATION=false

# Parse command line options
while getopts ":p:k:a:r:sedh" opt; do
    case ${opt} in
        p )
            AWS_PROFILE=$OPTARG
            ;;
        k )
            KEY_ID=$OPTARG
            ;;
        a )
            ADD_ADMIN=$OPTARG
            ;;
        r )
            REMOVE_ADMIN=$OPTARG
            ;;
        s )
            SHOW_POLICY=true
            ;;
        e )
            ENABLE_ROTATION=true
            ;;
        # Continuing with the manage_kms_keys.sh script...

        d )
            DISABLE_ROTATION=true
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
if [ -z "$AWS_PROFILE" ] || [ -z "$KEY_ID" ]; then
    echo "ERROR: Missing required parameters!" 1>&2
    echo "Required parameters: -p PROFILE -k KEY_ID" 1>&2
    display_help
fi

# Validate AWS profile
if ! aws configure list --profile "$AWS_PROFILE" &>/dev/null; then
    echo "ERROR: AWS profile '$AWS_PROFILE' not found!" 1>&2
    exit 1
fi

# Check if the key exists
echo "Checking KMS key $KEY_ID..."
KEY_INFO=$(aws kms describe-key --key-id "$KEY_ID" --profile "$AWS_PROFILE" 2>/dev/null)

if [ $? -ne 0 ]; then
    echo "ERROR: KMS key with ID '$KEY_ID' not found or you don't have access to it!" 1>&2
    exit 1
fi

KEY_ARN=$(echo "$KEY_INFO" | jq -r '.KeyMetadata.Arn')
KEY_STATE=$(echo "$KEY_INFO" | jq -r '.KeyMetadata.KeyState')

echo "Found KMS key: $KEY_ARN"
echo "Key state: $KEY_STATE"
echo

# Show the current key policy if requested
if [ "$SHOW_POLICY" = true ]; then
    echo "Current key policy:"
    aws kms get-key-policy --key-id "$KEY_ID" --policy-name default --output text --profile "$AWS_PROFILE"
    echo
fi

# Add an administrator to the key policy
if [ -n "$ADD_ADMIN" ]; then
    echo "Adding administrator $ADD_ADMIN to key policy..."
    
    # Get the current policy
    TEMP_POLICY_FILE=$(mktemp)
    aws kms get-key-policy --key-id "$KEY_ID" --policy-name default --output text --profile "$AWS_PROFILE" > "$TEMP_POLICY_FILE"
    
    # Make sure it's valid JSON
    if ! jq empty "$TEMP_POLICY_FILE" 2>/dev/null; then
        echo "ERROR: Current policy is not valid JSON!" 1>&2
        rm -f "$TEMP_POLICY_FILE"
        exit 1
    fi
    
    # Create an updated policy
    TEMP_UPDATE_FILE=$(mktemp)
    
    # Check if the policy already has an admin statement
    ADMIN_SID=$(jq -r '.Statement[] | select(.Sid == "Allow administration of the key") | .Sid' "$TEMP_POLICY_FILE")
    
    if [ -n "$ADMIN_SID" ] && [ "$ADMIN_SID" != "null" ]; then
        # Update the existing admin statement
        jq --arg admin "$ADD_ADMIN" '(.Statement[] | select(.Sid == "Allow administration of the key") | .Principal.AWS) |= if type == "array" then . + [$admin] else [$., $admin] end' "$TEMP_POLICY_FILE" > "$TEMP_UPDATE_FILE"
    else
        # Create a new admin statement
        ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query "Account" --output text)
        
        # Add a new statement to the policy
        jq --arg admin "$ADD_ADMIN" --arg account "$ACCOUNT_ID" '.Statement += [{
            "Sid": "Allow administration of the key",
            "Effect": "Allow",
            "Principal": {
                "AWS": $admin
            },
            "Action": [
                "kms:Create*",
                "kms:Describe*",
                "kms:Enable*",
                "kms:List*",
                "kms:Put*",
                "kms:Update*",
                "kms:Revoke*",
                "kms:Disable*",
                "kms:Get*",
                "kms:Delete*",
                "kms:TagResource",
                "kms:UntagResource",
                "kms:ScheduleKeyDeletion",
                "kms:CancelKeyDeletion",
                "kms:RotateKeyOnDemand"
            ],
            "Resource": "*"
        }]' "$TEMP_POLICY_FILE" > "$TEMP_UPDATE_FILE"
    fi
    
    # Update the key policy
    aws kms put-key-policy --key-id "$KEY_ID" --policy-name default --policy file://"$TEMP_UPDATE_FILE" --profile "$AWS_PROFILE"
    
    if [ $? -eq 0 ]; then
        echo "Successfully added administrator $ADD_ADMIN to key policy."
    else
        echo "ERROR: Failed to update key policy!" 1>&2
    fi
    
    # Clean up
    rm -f "$TEMP_POLICY_FILE" "$TEMP_UPDATE_FILE"
    echo
fi

# Remove an administrator from the key policy
if [ -n "$REMOVE_ADMIN" ]; then
    echo "Removing administrator $REMOVE_ADMIN from key policy..."
    
    # Get the current policy
    TEMP_POLICY_FILE=$(mktemp)
    aws kms get-key-policy --key-id "$KEY_ID" --policy-name default --output text --profile "$AWS_PROFILE" > "$TEMP_POLICY_FILE"
    
    # Make sure it's valid JSON
    if ! jq empty "$TEMP_POLICY_FILE" 2>/dev/null; then
        echo "ERROR: Current policy is not valid JSON!" 1>&2
        rm -f "$TEMP_POLICY_FILE"
        exit 1
    fi
    
    # Create an updated policy
    TEMP_UPDATE_FILE=$(mktemp)
    
    # Check if the policy has an admin statement
    ADMIN_SID=$(jq -r '.Statement[] | select(.Sid == "Allow administration of the key") | .Sid' "$TEMP_POLICY_FILE")
    
    if [ -n "$ADMIN_SID" ] && [ "$ADMIN_SID" != "null" ]; then
        # Update the existing admin statement
        jq --arg admin "$REMOVE_ADMIN" '(.Statement[] | select(.Sid == "Allow administration of the key") | .Principal.AWS) |= if type == "array" then . - [$admin] else if . == $admin then null else . end end' "$TEMP_POLICY_FILE" > "$TEMP_UPDATE_FILE"
        
        # Update the key policy
        aws kms put-key-policy --key-id "$KEY_ID" --policy-name default --policy file://"$TEMP_UPDATE_FILE" --profile "$AWS_PROFILE"
        
        if [ $? -eq 0 ]; then
            echo "Successfully removed administrator $REMOVE_ADMIN from key policy."
        else
            echo "ERROR: Failed to update key policy!" 1>&2
        fi
    else
        echo "No administrator statement found in the key policy."
    fi
    
    # Clean up
    rm -f "$TEMP_POLICY_FILE" "$TEMP_UPDATE_FILE"
    echo
fi

# Enable key rotation
if [ "$ENABLE_ROTATION" = true ]; then
    echo "Enabling automatic key rotation..."
    
    aws kms enable-key-rotation --key-id "$KEY_ID" --profile "$AWS_PROFILE"
    
    if [ $? -eq 0 ]; then
        echo "Successfully enabled automatic key rotation."
    else
        echo "ERROR: Failed to enable key rotation!" 1>&2
    fi
    echo
fi

# Disable key rotation
if [ "$DISABLE_ROTATION" = true ]; then
    echo "Disabling automatic key rotation..."
    
    aws kms disable-key-rotation --key-id "$KEY_ID" --profile "$AWS_PROFILE"
    
    if [ $? -eq 0 ]; then
        echo "Successfully disabled automatic key rotation."
    else
        echo "ERROR: Failed to disable key rotation!" 1>&2
    fi
    echo
fi

# Show key rotation status
echo "Current key rotation status:"
aws kms get-key-rotation-status --key-id "$KEY_ID" --profile "$AWS_PROFILE"
echo

echo "KMS key management completed."