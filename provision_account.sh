#!/bin/bash
# provision_account.sh - Provision a new account through AWS Control Tower Account Factory
#
# Description:
#   This script provisions a new AWS account through the AWS Control Tower Account Factory.
#   It automates the account creation process with proper organizational unit placement.
#
# Usage:
#   ./provision_account.sh -p PROFILE -n NAME -e EMAIL -o OU_NAME [-s SSO_EMAIL] [-f FIRST] [-l LAST] [-h]
#
# Parameters:
#   -p PROFILE     AWS CLI profile with permissions to provision accounts (required)
#   -n NAME        Name for the new account (required)
#   -e EMAIL       Email address for the new account's root user (required)
#   -o OU_NAME     Organizational Unit name to place the account in (required)
#   -s SSO_EMAIL   Email for the SSO user (optional, defaults to same as account email)
#   -f FIRST       First name for the SSO user (optional, defaults to "Admin")
#   -l LAST        Last name for the SSO user (optional, defaults to "User")
#   -h             Display this help message and exit
#
# Examples:
#   ./provision_account.sh -p sampleproject-admin -n "Production" -e prod@example.com -o Workloads
#   ./provision_account.sh -p sampleproject-admin -n "Sandbox" -e sandbox@example.com -o Sandbox -s admin@example.com -f John -l Doe

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
AWS_PROFILE=""
ACCOUNT_NAME=""
ACCOUNT_EMAIL=""
OU_NAME=""
SSO_EMAIL=""
SSO_FIRST="Admin"
SSO_LAST="User"

# Parse command line options
while getopts ":p:n:e:o:s:f:l:h" opt; do
    case ${opt} in
        p )
            AWS_PROFILE=$OPTARG
            ;;
        n )
            ACCOUNT_NAME=$OPTARG
            ;;
        e )
            ACCOUNT_EMAIL=$OPTARG
            ;;
        o )
            OU_NAME=$OPTARG
            ;;
        s )
            SSO_EMAIL=$OPTARG
            ;;
        f )
            SSO_FIRST=$OPTARG
            ;;
        l )
            SSO_LAST=$OPTARG
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
if [ -z "$AWS_PROFILE" ] || [ -z "$ACCOUNT_NAME" ] || [ -z "$ACCOUNT_EMAIL" ] || [ -z "$OU_NAME" ]; then
    echo "ERROR: Missing required parameters!" 1>&2
    echo "Required parameters: -p PROFILE -n NAME -e EMAIL -o OU_NAME" 1>&2
    display_help
fi

# If SSO email not provided, use account email
if [ -z "$SSO_EMAIL" ]; then
    SSO_EMAIL="$ACCOUNT_EMAIL"
fi

# Validate AWS profile
if ! aws configure list --profile "$AWS_PROFILE" &>/dev/null; then
    echo "ERROR: AWS profile '$AWS_PROFILE' not found!" 1>&2
    exit 1
fi

# Validate email format (basic validation)
if ! [[ "$ACCOUNT_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    echo "ERROR: Invalid account email format: $ACCOUNT_EMAIL" 1>&2
    exit 1
fi

if ! [[ "$SSO_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    echo "ERROR: Invalid SSO email format: $SSO_EMAIL" 1>&2
    exit 1
fi

# Main execution
echo "Starting AWS Control Tower Account Factory provisioning..."
echo "  - AWS Profile: $AWS_PROFILE"
echo "  - Account Name: $ACCOUNT_NAME"
echo "  - Account Email: $ACCOUNT_EMAIL"
echo "  - Organizational Unit: $OU_NAME"
echo "  - SSO User: $SSO_FIRST $SSO_LAST ($SSO_EMAIL)"
echo

# Generate a unique token for this provisioning request
PROVISION_TOKEN=$(uuidgen)

# Get the Account Factory product ID
echo "Retrieving Account Factory product information..."

SC_PORTFOLIO_ID=$(aws servicecatalog list-portfolios \
    --profile "$AWS_PROFILE" \
    --query "PortfolioDetails[?DisplayName=='AWS Control Tower Account Factory Portfolio'].Id" \
    --output text)

if [ -z "$SC_PORTFOLIO_ID" ] || [ "$SC_PORTFOLIO_ID" == "None" ]; then
    echo "ERROR: Could not find the Account Factory portfolio!" 1>&2
    echo "Make sure AWS Control Tower is properly set up." 1>&2
    exit 1
fi

echo "Found Account Factory portfolio: $SC_PORTFOLIO_ID"

SC_PRODUCT_ID=$(aws servicecatalog search-products \
    --portfolio-id "$SC_PORTFOLIO_ID" \
    --profile "$AWS_PROFILE" \
    --query "ProductViewSummaries[?Name=='AWS Control Tower Account Factory'].ProductId" \
    --output text)

if [ -z "$SC_PRODUCT_ID" ] || [ "$SC_PRODUCT_ID" == "None" ]; then
    echo "ERROR: Could not find the Account Factory product!" 1>&2
    echo "Make sure AWS Control Tower is properly set up." 1>&2
    exit 1
fi

echo "Found Account Factory product: $SC_PRODUCT_ID"

# Get the latest provisioning artifact
PA_ID=$(aws servicecatalog describe-product \
    --id "$SC_PRODUCT_ID" \
    --profile "$AWS_PROFILE" \
    --query "ProvisioningArtifacts[0].Id" \
    --output text)

if [ -z "$PA_ID" ] || [ "$PA_ID" == "None" ]; then
    echo "ERROR: Could not find a provisioning artifact for the Account Factory product!" 1>&2
    exit 1
fi

echo "Found provisioning artifact: $PA_ID"

# Create the account
echo "Provisioning new account..."

PP_ID=$(aws servicecatalog provision-product \
    --product-id "$SC_PRODUCT_ID" \
    --provisioning-artifact-id "$PA_ID" \
    --provision-token "$PROVISION_TOKEN" \
    --provisioned-product-name "$ACCOUNT_NAME" \
    --provisioning-parameters \
        "Key=AccountName,Value=$ACCOUNT_NAME" \
        "Key=AccountEmail,Value=$ACCOUNT_EMAIL" \
        "Key=SSOUserFirstName,Value=$SSO_FIRST" \
        "Key=SSOUserLastName,Value=$SSO_LAST" \
        "Key=SSOUserEmail,Value=$SSO_EMAIL" \
        "Key=ManagedOrganizationalUnit,Value=$OU_NAME" \
    --profile "$AWS_PROFILE" \
    --query "RecordDetail.ProvisionedProductId" \
    --output text)

if [ -z "$PP_ID" ] || [ "$PP_ID" == "None" ]; then
    echo "ERROR: Failed to provision the account!" 1>&2
    exit 1
fi

echo "Successfully initiated account provisioning!"
echo "Provisioned Product ID: $PP_ID"
echo
echo "The account provisioning process is now running in the background."
echo "This typically takes 30-60 minutes to complete."
echo
echo "You can check the status with:"
echo "aws servicecatalog describe-record --id <record-id> --profile $AWS_PROFILE"
echo
echo "After provisioning completes, the account will be available in the AWS Control Tower console."