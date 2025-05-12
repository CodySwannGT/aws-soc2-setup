#!/bin/bash
# create_organizational_units.sh - Create organizational units (OUs) for AWS Control Tower
#
# Description:
#   This script creates additional organizational units (OUs) for a 
#   well-structured AWS Control Tower landing zone following the AWS multi-account strategy.
#
# Usage:
#   ./create_organizational_units.sh -p AWS_PROFILE [-i] [-w] [-s] [-h]
#
# Parameters:
#   -p PROFILE     AWS CLI profile with permissions to create OUs (required)
#   -i             Create Infrastructure OU (optional)
#   -w             Create Workloads OU (optional)
#   -s             Create Sandbox OU (optional)
#   -a             Create all recommended OUs (Infrastructure, Workloads, Sandbox)
#   -h             Display this help message and exit
#
# Examples:
#   ./create_organizational_units.sh -p sampleproject-admin -a
#   ./create_organizational_units.sh -p sampleproject-admin -i -w

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
CREATE_INFRASTRUCTURE=false
CREATE_WORKLOADS=false
CREATE_SANDBOX=false
AWS_PROFILE=""

# Parse command line options
while getopts ":p:iwsah" opt; do
    case ${opt} in
        p )
            AWS_PROFILE=$OPTARG
            ;;
        i )
            CREATE_INFRASTRUCTURE=true
            ;;
        w )
            CREATE_WORKLOADS=true
            ;;
        s )
            CREATE_SANDBOX=true
            ;;
        a )
            CREATE_INFRASTRUCTURE=true
            CREATE_WORKLOADS=true
            CREATE_SANDBOX=true
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

# Check if profile is provided
if [ -z "$AWS_PROFILE" ]; then
    echo "ERROR: AWS profile is required!" 1>&2
    echo "Use -p parameter to specify the AWS profile." 1>&2
    display_help
fi

# Validate AWS profile
if ! aws configure list --profile "$AWS_PROFILE" &>/dev/null; then
    echo "ERROR: AWS profile '$AWS_PROFILE' not found!" 1>&2
    exit 1
fi

# Function to check if an OU already exists
ou_exists() {
    local ou_name=$1
    local parent_id=$2
    
    aws organizations list-organizational-units-for-parent \
        --parent-id "$parent_id" \
        --profile "$AWS_PROFILE" \
        --query "OrganizationalUnits[?Name=='$ou_name'].Id" \
        --output text | grep -q .
    
    return $?
}

# Function to create an OU if it doesn't exist
create_ou() {
    local ou_name=$1
    local parent_id=$2
    local purpose=$3
    
    echo "Checking if OU '$ou_name' already exists..."
    if ou_exists "$ou_name" "$parent_id"; then
        echo "OU '$ou_name' already exists. Skipping creation."
        return 0
    fi
    
    echo "Creating OU '$ou_name'..."
    local ou_id=$(aws organizations create-organizational-unit \
        --parent-id "$parent_id" \
        --name "$ou_name" \
        --tags Key=Purpose,Value="$purpose" \
        --profile "$AWS_PROFILE" \
        --query "OrganizationalUnit.Id" \
        --output text)
    
    if [ -z "$ou_id" ]; then
        echo "ERROR: Failed to create OU '$ou_name'!" 1>&2
        return 1
    fi
    
    echo "Successfully created OU '$ou_name' with ID: $ou_id"
    return 0
}

# Main execution
echo "Getting AWS Organizations root ID..."
ROOT_ID=$(aws organizations list-roots --profile "$AWS_PROFILE" --query "Roots[0].Id" --output text)

if [ -z "$ROOT_ID" ]; then
    echo "ERROR: Failed to get AWS Organizations root ID. Make sure AWS Organizations is enabled." 1>&2
    exit 1
fi

echo "Found AWS Organizations root ID: $ROOT_ID"
echo

# Create OUs based on flags
if [ "$CREATE_INFRASTRUCTURE" = true ]; then
    create_ou "Infrastructure" "$ROOT_ID" "Shared Services"
    echo
fi

if [ "$CREATE_WORKLOADS" = true ]; then
    create_ou "Workloads" "$ROOT_ID" "Production"
    echo
fi

if [ "$CREATE_SANDBOX" = true ]; then
    create_ou "Sandbox" "$ROOT_ID" "Development"
    echo
fi

if [ "$CREATE_INFRASTRUCTURE" = false ] && [ "$CREATE_WORKLOADS" = false ] && [ "$CREATE_SANDBOX" = false ]; then
    echo "No OUs were specified to create. Use -i, -w, -s, or -a options to create OUs."
    echo "Run with -h for help."
    exit 0
fi

echo "OU creation process completed."
echo "Next steps:"
echo "1. Register these OUs with AWS Control Tower in the Control Tower console"
echo "2. Apply appropriate controls to each OU"