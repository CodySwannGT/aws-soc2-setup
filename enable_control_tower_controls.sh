#!/bin/bash
# enable_control_tower_controls.sh - Enable AWS Control Tower controls for SOC 2 compliance
#
# Description:
#   This script enables a set of AWS Control Tower controls that are relevant for
#   SOC 2 compliance across specified organizational units.
#
# Usage:
#   ./enable_control_tower_controls.sh -p PROFILE -o OU_ID [-s SOC2_TYPE] [-b BASELINE] [-h]
#
# Parameters:
#   -p PROFILE     AWS CLI profile with permissions to enable controls (required)
#   -o OU_ID       The ID of the organizational unit to apply controls to (required)
#   -s SOC2_TYPE   SOC 2 type to target: 'type1', 'type2', or 'both' (default: both)
#   -b BASELINE    Control baseline: 'minimal', 'recommended', or 'comprehensive' (default: recommended)
#   -h             Display this help message and exit
#
# Examples:
#   ./enable_control_tower_controls.sh -p sampleproject-admin -o ou-xxxx-xxxxxxxx
#   ./enable_control_tower_controls.sh -p sampleproject-admin -o ou-xxxx-xxxxxxxx -s type2 -b comprehensive

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
AWS_PROFILE=""
OU_ID=""
SOC2_TYPE="both"
BASELINE="recommended"

# Parse command line options
while getopts ":p:o:s:b:h" opt; do
    case ${opt} in
        p )
            AWS_PROFILE=$OPTARG
            ;;
        o )
            OU_ID=$OPTARG
            ;;
        s )
            SOC2_TYPE=$OPTARG
            ;;
        b )
            BASELINE=$OPTARG
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
if [ -z "$AWS_PROFILE" ] || [ -z "$OU_ID" ]; then
    echo "ERROR: Missing required parameters!" 1>&2
    echo "Required parameters: -p PROFILE -o OU_ID" 1>&2
    display_help
fi

# Validate AWS profile
if ! aws configure list --profile "$AWS_PROFILE" &>/dev/null; then
    echo "ERROR: AWS profile '$AWS_PROFILE' not found!" 1>&2
    exit 1
fi

# Validate OU_ID format (basic validation)
if ! [[ "$OU_ID" =~ ^ou-[a-z0-9]{4,8}-[a-z0-9]{8,32}$ ]]; then
    echo "WARNING: OU_ID format appears to be invalid. Expected format: ou-xxxx-xxxxxxxx" 1>&2
    echo "Continuing anyway, but this might fail." 1>&2
fi

# Validate SOC2_TYPE and BASELINE
if [[ ! "$SOC2_TYPE" =~ ^(type1|type2|both)$ ]]; then
    echo "ERROR: Invalid SOC2_TYPE. Must be 'type1', 'type2', or 'both'." 1>&2
    exit 1
fi

if [[ ! "$BASELINE" =~ ^(minimal|recommended|comprehensive)$ ]]; then
    echo "ERROR: Invalid BASELINE. Must be 'minimal', 'recommended', or 'comprehensive'." 1>&2
    exit 1
fi

# Function to enable a control
enable_control() {
    local control_id=$1
    local ou_id=$2
    local description=$3
    
    echo "Enabling control: $description (ID: $control_id)..."
    
    aws controltower enable-control \
        --control-identifier "$control_id" \
        --target-identifier "$ou_id" \
        --profile "$AWS_PROFILE" > /dev/null 2>&1
    
    if [ $? -eq 0 ]; then
        echo "  ✅ Successfully enabled $description"
        return 0
    else
        echo "  ❌ Failed to enable $description"
        echo "  Retrying with more details..."
        aws controltower enable-control \
            --control-identifier "$control_id" \
            --target-identifier "$ou_id" \
            --profile "$AWS_PROFILE"
        return 1
    fi
}

# Arrays of control IDs based on SOC 2 type and baseline
# These are examples - in production you'd want to use the actual global IDs
# For brevity, I've included a subset of the controls that would be relevant

# Minimal baseline controls for SOC 2 Type 1
minimal_type1_controls=(
    # Security controls
    "arn:aws:controlcatalog:::control/AWS-GR_ROOT_ACCOUNT_MFA_ENABLED"
    "arn:aws:controlcatalog:::control/AWS-GR_IAM_USER_MFA_ENABLED"
    "arn:aws:controlcatalog:::control/AWS-GR_RESTRICT_ROOT_USER"
    "arn:aws:controlcatalog:::control/AWS-GR_ENCRYPTED_VOLUMES"
)

# Minimal baseline controls for SOC 2 Type 2
minimal_type2_controls=(
    # Additional monitoring controls
    "arn:aws:controlcatalog:::control/AWS-GR_CLOUDTRAIL_ENABLED"
    "arn:aws:controlcatalog:::control/AWS-GR_CLOUDWATCH_ALARM_ACTION_CHECK"
)

# Recommended baseline additional controls for SOC 2 Type 1
recommended_type1_controls=(
    # Data protection
    "arn:aws:controlcatalog:::control/AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED"
    "arn:aws:controlcatalog:::control/AWS-GR_S3_BUCKET_PUBLIC_WRITE_PROHIBITED"
    "arn:aws:controlcatalog:::control/AWS-GR_S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED"
    "arn:aws:controlcatalog:::control/AWS-GR_RDS_STORAGE_ENCRYPTED"
    
    # Network protection
    "arn:aws:controlcatalog:::control/AWS-GR_RESTRICTED_SSH"
    "arn:aws:controlcatalog:::control/AWS-GR_RESTRICTED_COMMON_PORTS"
)

# Recommended baseline additional controls for SOC 2 Type 2
recommended_type2_controls=(
    # Logging and monitoring
    "arn:aws:controlcatalog:::control/AWS-GR_CLOUDTRAIL_VALIDATION_ENABLED"
    "arn:aws:controlcatalog:::control/AWS-GR_CLOUD_TRAIL_ENCRYPTION_ENABLED"
    "arn:aws:controlcatalog:::control/AWS-GR_CLOUDTRAIL_LOG_FILE_VALIDATION_ENABLED"
    
    # Incident response
    "arn:aws:controlcatalog:::control/AWS-GR_CONFIG_ENABLED"
)

# Comprehensive baseline additional controls for SOC 2 Type 1
comprehensive_type1_controls=(
    # Additional security
    "arn:aws:controlcatalog:::control/AWS-GR_LAMBDA_FUNCTION_PUBLIC_ACCESS_PROHIBITED"
    "arn:aws:controlcatalog:::control/AWS-GR_EBS_OPTIMIZED_INSTANCE"
    "arn:aws:controlcatalog:::control/AWS-GR_IAM_USER_GROUP_MEMBERSHIP_CHECK"
    "arn:aws:controlcatalog:::control/AWS-GR_IAM_GROUP_HAS_USERS_CHECK"
    "arn:aws:controlcatalog:::control/AWS-GR_IAM_POLICY_NO_STATEMENTS_WITH_ADMIN_ACCESS"
)

# Comprehensive baseline additional controls for SOC 2 Type 2
comprehensive_type2_controls=(
    # Advanced monitoring
    "arn:aws:controlcatalog:::control/AWS-GR_VPC_FLOW_LOGS_ENABLED"
    "arn:aws:controlcatalog:::control/AWS-GR_GUARDDUTY_ENABLED_CENTRALIZED"
    "arn:aws:controlcatalog:::control/AWS-GR_SECURITYHUB_ENABLED"
)

# Control descriptions for better output
declare -A control_descriptions
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_ROOT_ACCOUNT_MFA_ENABLED"]="Ensure Root Account has MFA Enabled"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_IAM_USER_MFA_ENABLED"]="Ensure IAM Users have MFA Enabled"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_RESTRICT_ROOT_USER"]="Restrict Root User Access"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_ENCRYPTED_VOLUMES"]="Ensure EBS Volumes are Encrypted"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_CLOUDTRAIL_ENABLED"]="Ensure CloudTrail is Enabled"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_CLOUDWATCH_ALARM_ACTION_CHECK"]="Ensure CloudWatch Alarms Have Actions"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED"]="Prohibit Public Read Access to S3 Buckets"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_S3_BUCKET_PUBLIC_WRITE_PROHIBITED"]="Prohibit Public Write Access to S3 Buckets"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED"]="Ensure S3 Buckets Have Encryption Enabled"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_RDS_STORAGE_ENCRYPTED"]="Ensure RDS Storage is Encrypted"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_RESTRICTED_SSH"]="Restrict SSH Access"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_RESTRICTED_COMMON_PORTS"]="Restrict Access to Common Ports"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_CLOUDTRAIL_VALIDATION_ENABLED"]="Enable CloudTrail Log File Validation"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_CLOUD_TRAIL_ENCRYPTION_ENABLED"]="Enable CloudTrail Encryption"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_CLOUDTRAIL_LOG_FILE_VALIDATION_ENABLED"]="Enable CloudTrail Log File Validation"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_CONFIG_ENABLED"]="Enable AWS Config"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_LAMBDA_FUNCTION_PUBLIC_ACCESS_PROHIBITED"]="Prohibit Public Access to Lambda Functions"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_EBS_OPTIMIZED_INSTANCE"]="Use EBS Optimized Instances"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_IAM_USER_GROUP_MEMBERSHIP_CHECK"]="Ensure IAM Users are in at Least One Group"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_IAM_GROUP_HAS_USERS_CHECK"]="Ensure IAM Groups Have at Least One User"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_IAM_POLICY_NO_STATEMENTS_WITH_ADMIN_ACCESS"]="Restrict Admin Access in IAM Policies"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_VPC_FLOW_LOGS_ENABLED"]="Enable VPC Flow Logs"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_GUARDDUTY_ENABLED_CENTRALIZED"]="Enable Centralized GuardDuty"
control_descriptions["arn:aws:controlcatalog:::control/AWS-GR_SECURITYHUB_ENABLED"]="Enable Security Hub"

# Main execution
echo "Starting to enable Control Tower controls for SOC 2 compliance..."
echo "  - OU ID: $OU_ID"
echo "  - SOC 2 Type: $SOC2_TYPE"
echo "  - Baseline: $BASELINE"
echo

# Initialize arrays to track controls to enable
controls_to_enable=()

# Add controls based on baseline and SOC 2 type
if [[ "$BASELINE" =~ ^(minimal|recommended|comprehensive)$ ]]; then
    if [[ "$SOC2_TYPE" =~ ^(type1|both)$ ]]; then
        controls_to_enable+=(${minimal_type1_controls[@]})
    fi
    if [[ "$SOC2_TYPE" =~ ^(type2|both)$ ]]; then
        controls_to_enable+=(${minimal_type2_controls[@]})
    fi
fi

if [[ "$BASELINE" =~ ^(recommended|comprehensive)$ ]]; then
    if [[ "$SOC2_TYPE" =~ ^(type1|both)$ ]]; then
        controls_to_enable+=(${recommended_type1_controls[@]})
    fi
    if [[ "$SOC2_TYPE" =~ ^(type2|both)$ ]]; then
        controls_to_enable+=(${recommended_type2_controls[@]})
    fi
fi

if [[ "$BASELINE" =~ ^(comprehensive)$ ]]; then
    if [[ "$SOC2_TYPE" =~ ^(type1|both)$ ]]; then
        controls_to_enable+=(${comprehensive_type1_controls[@]})
    fi
    if [[ "$SOC2_TYPE" =~ ^(type2|both)$ ]]; then
        controls_to_enable+=(${comprehensive_type2_controls[@]})
    fi
fi

# Remove duplicates from the array of controls
controls_to_enable=($(echo "${controls_to_enable[@]}" | tr ' ' '\n' | sort -u | tr '\n' ' '))

# Enable the selected controls
success_count=0
failure_count=0
echo "Enabling ${#controls_to_enable[@]} controls..."
echo

for control_id in "${controls_to_enable[@]}"; do
    description="${control_descriptions[$control_id]:-Unknown control}"
    enable_control "$control_id" "$OU_ID" "$description"
    if [ $? -eq 0 ]; then
        ((success_count++))
    else
        ((failure_count++))
    fi
    echo
done

echo "Control enabling process completed."
echo "  - Successfully enabled: $success_count controls"
echo "  - Failed: $failure_count controls"
echo
echo "Note: Control activation may take some time to complete in the AWS Control Tower console."
echo "Check the status in the AWS Control Tower console."