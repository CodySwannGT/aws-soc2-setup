#!/bin/bash
# create_sso_user.sh - Create a user in IAM Identity Center
#
# Description:
#   This script creates a new user in AWS IAM Identity Center (formerly AWS SSO)
#   using the provided parameters. After creating the user, you'll need to set
#   their initial password in the IAM Identity Center console.
#
# Usage:
#   ./create_sso_user.sh -u USERNAME -f FIRST_NAME -l LAST_NAME -e EMAIL [-p AWS_PROFILE] [-h]
#
# Parameters:
#   -u USERNAME    Username for the new user (required)
#   -f FIRST_NAME  First name of the user (required)
#   -l LAST_NAME   Last name of the user (required)
#   -e EMAIL       Work email address for the user (required)
#   -p PROFILE     AWS CLI profile to use (default: sampleproject)
#   -h             Display this help message and exit
#
# Examples:
#   ./create_sso_user.sh -u johndoe -f John -l Doe -e john.doe@example.com
#   ./create_sso_user.sh -u janedoe -f Jane -l Doe -e jane.doe@example.com -p my-profile
#
# Note:
#   After running this script, you'll need to go to the IAM Identity Center console
#   to set the initial password for the user.

# Set default values
AWS_PROFILE="sampleproject"

# Display help message
display_help() {
   grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
   exit 0
}

# Parse command line options
while getopts ":u:f:l:e:p:h" opt; do
   case ${opt} in
       u )
           USERNAME=$OPTARG
           ;;
       f )
           FIRST_NAME=$OPTARG
           ;;
       l )
           LAST_NAME=$OPTARG
           ;;
       e )
           EMAIL=$OPTARG
           ;;
       p )
           AWS_PROFILE=$OPTARG
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
if [ -z "$USERNAME" ] || [ -z "$FIRST_NAME" ] || [ -z "$LAST_NAME" ] || [ -z "$EMAIL" ]; then
   echo "ERROR: Missing required parameters!" 1>&2
   echo "Required parameters: -u USERNAME -f FIRST_NAME -l LAST_NAME -e EMAIL" 1>&2
   display_help
fi

# Validate AWS profile
if ! aws configure list --profile "$AWS_PROFILE" &>/dev/null; then
   echo "ERROR: AWS profile '$AWS_PROFILE' not found!" 1>&2
   exit 1
fi

echo "Creating user '$USERNAME' in IAM Identity Center..."
echo "  First Name: $FIRST_NAME"
echo "  Last Name: $LAST_NAME"
echo "  Email: $EMAIL"
echo "  Using AWS Profile: $AWS_PROFILE"

# Get the IAM Identity Center instance ARN and ID
echo "Retrieving IAM Identity Center instance details..."

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

# Create the user
echo "Creating user..."
USER_ID=$(aws identitystore create-user \
 --identity-store-id "$IDENTITY_STORE_ID" \
 --user-name "$USERNAME" \
 --display-name "$FIRST_NAME $LAST_NAME" \
 --name "GivenName=$FIRST_NAME,FamilyName=$LAST_NAME" \
 --emails "Type=Work,Value=$EMAIL" \
 --profile "$AWS_PROFILE" \
 --query "UserId" --output text 2>/dev/null)

if [ $? -ne 0 ]; then
   echo "ERROR: Failed to create user. Check the parameters and try again." 1>&2
   exit 1
fi

if [ -z "$USER_ID" ] || [ "$USER_ID" == "None" ]; then
   echo "ERROR: User creation failed or returned empty user ID." 1>&2
   exit 1
fi

echo "Success! User '$USERNAME' created with ID: $USER_ID"
echo ""
echo "IMPORTANT: You need to set the initial password for this user in the IAM Identity Center console."
echo "1. Sign in to the AWS Management Console"
echo "2. Navigate to IAM Identity Center"
echo "3. Go to Users"
echo "4. Select the user '$USERNAME'"
echo "5. Click on 'Reset password' to set the initial password"