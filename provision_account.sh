#!/bin/bash
# provision_account.sh - Provision a new account through AWS Control Tower Account Factory
#
# Description:
#   This script provisions a new AWS account through the AWS Control Tower Account Factory.
#   It automates the account creation process with proper organizational unit placement.
#   Can optionally wait for the account enrollment to complete.
#
# Usage:
#   ./provision_account.sh -p PROFILE -n NAME -e EMAIL -o OU_NAME [-s SSO_EMAIL] [-f FIRST] [-l LAST] [-w] [-h]
#
# Parameters:
#   -p PROFILE     AWS CLI profile with permissions to provision accounts (required)
#   -n NAME        Name for the new account (required)
#   -e EMAIL       Email address for the new account's root user (required)
#   -o OU_NAME     Organizational Unit name to place the account in (required)
#   -s SSO_EMAIL   Email for the SSO user (optional, defaults to same as account email)
#   -f FIRST       First name for the SSO user (optional, defaults to "Admin")
#   -l LAST        Last name for the SSO user (optional, defaults to "User")
#   -w             Wait for the account enrollment to complete (optional)
#   -h             Display this help message and exit
#
# Examples:
#   ./provision_account.sh -p sampleproject-admin -n "Production" -e prod@example.com -o Workloads
#   ./provision_account.sh -p sampleproject-admin -n "Sandbox" -e sandbox@example.com -o Sandbox -s admin@example.com -f John -l Doe
#   ./provision_account.sh -p sampleproject-admin -n "Dev" -e dev@example.com -o Workloads -w

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
WAIT_FOR_COMPLETION=false

# Parse command line options
while getopts ":p:n:e:o:s:f:l:wh" opt; do
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
        w )
            WAIT_FOR_COMPLETION=true
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

# The search-products command doesn't support --portfolio-id parameter
# Need to use search-products-as-admin instead
SC_PRODUCT_ID=$(aws servicecatalog search-products-as-admin \
    --portfolio-id "$SC_PORTFOLIO_ID" \
    --profile "$AWS_PROFILE" \
    --query "ProductViewDetails[?ProductViewSummary.Name=='AWS Control Tower Account Factory'].ProductViewSummary.ProductId" \
    --output text)

if [ -z "$SC_PRODUCT_ID" ] || [ "$SC_PRODUCT_ID" == "None" ]; then
    echo "Warning: Could not find the Account Factory product with search-products-as-admin. Trying alternative approach..."
    
    # Alternative approach using list-provisioning-artifacts
    SC_PRODUCTS=$(aws servicecatalog list-accepted-portfolio-shares \
        --portfolio-share-type AWS_ORGANIZATIONS \
        --profile "$AWS_PROFILE" \
        --query "PortfolioDetails[?DisplayName=='AWS Control Tower Account Factory Portfolio'].Id" \
        --output text)
    
    if [ -n "$SC_PRODUCTS" ]; then
        echo "Found shared portfolio: $SC_PRODUCTS"
        
        SC_PRODUCT_ID=$(aws servicecatalog list-provisioning-artifacts \
            --product-id "$SC_PRODUCTS" \
            --profile "$AWS_PROFILE" \
            --query "ProvisioningArtifactDetails[0].ProductId" \
            --output text 2>/dev/null)
    fi
    
    # Try another approach - search for the product directly
    if [ -z "$SC_PRODUCT_ID" ] || [ "$SC_PRODUCT_ID" == "None" ]; then
        echo "Trying to find Account Factory product directly..."
        SC_PRODUCT_ID=$(aws servicecatalog search-products \
            --filters FullTextSearch="AWS Control Tower Account Factory" \
            --profile "$AWS_PROFILE" \
            --query "ProductViewSummaries[?Name=='AWS Control Tower Account Factory'].ProductId" \
            --output text)
    fi
    
    if [ -z "$SC_PRODUCT_ID" ] || [ "$SC_PRODUCT_ID" == "None" ]; then
        echo "ERROR: Could not find the Account Factory product!" 1>&2
        echo "Make sure AWS Control Tower is properly set up." 1>&2
        echo "Try running this command to see available Service Catalog products:" 1>&2
        echo "aws servicecatalog search-products --profile $AWS_PROFILE" 1>&2
        exit 1
    fi
fi

echo "Found Account Factory product: $SC_PRODUCT_ID"

# Get the latest provisioning artifact
echo "Getting provisioning artifact for product $SC_PRODUCT_ID..."
PA_ID=""

# Try with describe-product first (most common)
PA_ID=$(aws servicecatalog describe-product \
    --id "$SC_PRODUCT_ID" \
    --profile "$AWS_PROFILE" \
    --query "ProvisioningArtifacts[0].Id" \
    --output text 2>/dev/null)

# Fallback to describe-product-as-admin if needed
if [ -z "$PA_ID" ] || [ "$PA_ID" == "None" ]; then
    echo "Trying with describe-product-as-admin..."
    PA_ID=$(aws servicecatalog describe-product-as-admin \
        --id "$SC_PRODUCT_ID" \
        --profile "$AWS_PROFILE" \
        --query "ProvisioningArtifactSummaries[0].Id" \
        --output text 2>/dev/null)
fi

# Fallback to list-provisioning-artifacts if needed
if [ -z "$PA_ID" ] || [ "$PA_ID" == "None" ]; then
    echo "Trying with list-provisioning-artifacts..."
    PA_ID=$(aws servicecatalog list-provisioning-artifacts \
        --product-id "$SC_PRODUCT_ID" \
        --profile "$AWS_PROFILE" \
        --query "ProvisioningArtifactDetails[0].Id" \
        --output text 2>/dev/null)
fi

if [ -z "$PA_ID" ] || [ "$PA_ID" == "None" ]; then
    echo "ERROR: Could not find a provisioning artifact for the Account Factory product!" 1>&2
    echo "Try running this command manually to inspect available artifacts:" 1>&2
    echo "aws servicecatalog list-provisioning-artifacts --product-id $SC_PRODUCT_ID --profile $AWS_PROFILE" 1>&2
    exit 1
fi

echo "Found provisioning artifact: $PA_ID"

# Create the account
echo "Provisioning new account..."

# Create the provisioning parameters in the format AWS CLI expects
echo "Setting up provisioning parameters..."
PARAMS=$(cat <<EOF
[
  {"Key":"AccountName","Value":"$ACCOUNT_NAME"},
  {"Key":"AccountEmail","Value":"$ACCOUNT_EMAIL"},
  {"Key":"SSOUserFirstName","Value":"$SSO_FIRST"},
  {"Key":"SSOUserLastName","Value":"$SSO_LAST"},
  {"Key":"SSOUserEmail","Value":"$SSO_EMAIL"},
  {"Key":"ManagedOrganizationalUnit","Value":"$OU_NAME"}
]
EOF
)

echo "Provisioning Account Factory product..."
# Capture both the provisioned product ID and record ID
PROVISION_RESULT=$(aws servicecatalog provision-product \
    --product-id "$SC_PRODUCT_ID" \
    --provisioning-artifact-id "$PA_ID" \
    --provision-token "$PROVISION_TOKEN" \
    --provisioned-product-name "$ACCOUNT_NAME" \
    --provisioning-parameters "$PARAMS" \
    --profile "$AWS_PROFILE" \
    --output json)

PP_ID=$(echo "$PROVISION_RESULT" | jq -r '.RecordDetail.ProvisionedProductId')
RECORD_ID=$(echo "$PROVISION_RESULT" | jq -r '.RecordDetail.RecordId')

if [ -z "$PP_ID" ] || [ "$PP_ID" == "None" ]; then
    echo "ERROR: Failed to provision the account!" 1>&2
    exit 1
fi

# Function to check provisioning status
check_provisioning_status() {
    local record_id=$1
    local profile=$2
    local status

    status=$(aws servicecatalog describe-record --id "$record_id" --profile "$profile" --query "RecordDetail.Status" --output text 2>/dev/null)
    echo "$status"
}

echo "Successfully initiated account provisioning!"
echo "Provisioned Product ID: $PP_ID"
echo "Record ID: $RECORD_ID"
echo

# The account provisioning process is now running in the background
if [ "$WAIT_FOR_COMPLETION" = true ]; then
    echo "Waiting for account provisioning to complete (this typically takes 30-60 minutes)..."
    
    # Initial delay before starting checks
    sleep 30
    
    # Loop until provisioning is complete or fails
    while true; do
        STATUS=$(check_provisioning_status "$RECORD_ID" "$AWS_PROFILE")
        
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Current status: $STATUS"
        
        if [[ "$STATUS" == "SUCCEEDED" ]]; then
            echo "Account provisioning completed successfully!"
            break
        elif [[ "$STATUS" == "FAILED" || "$STATUS" == "CANCELED" ]]; then
            echo "ERROR: Account provisioning failed with status: $STATUS" 1>&2
            echo "Check the AWS Service Catalog console for details." 1>&2
            exit 1
        fi
        
        # Wait before checking again
        echo "Waiting for 60 seconds before checking again..."
        sleep 60
    done
    
    # Get the newly created account ID
    ACCOUNT_ID=$(aws servicecatalog describe-record --id "$RECORD_ID" --profile "$AWS_PROFILE" \
        --query "RecordDetail.RecordOutputs[?OutputKey=='AccountId'].OutputValue" --output text)
    
    if [ -n "$ACCOUNT_ID" ]; then
        echo "New account ID: $ACCOUNT_ID"
    fi
    
    echo "Account provisioning is complete. The account is now available in the AWS Control Tower console."
else
    echo "The account provisioning process is now running in the background."
    echo "This typically takes 30-60 minutes to complete."
    echo
    echo "You can check the status with:"
    echo "aws servicecatalog describe-record --id $RECORD_ID --profile $AWS_PROFILE"
    echo
    echo "After provisioning completes, the account will be available in the AWS Control Tower console."
fi