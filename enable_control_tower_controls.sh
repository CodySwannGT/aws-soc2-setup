#!/bin/bash
# enable_control_tower_controls.sh - Enable AWS Control Tower controls for SOC 2 compliance
#
# Description:
#   This script enables a set of AWS Control Tower controls that are relevant for
#   SOC 2 compliance across specified organizational units.
#
# Usage:
#   ./enable_control_tower_controls.sh -p PROFILE -o OU_ID [-s SOC2_TYPE] [-b BASELINE] [-a] [-h]
#
# Parameters:
#   -p PROFILE     AWS CLI profile with permissions to enable controls (required)
#   -o OU_ID       The ID of the organizational unit to apply controls to (required)
#                  Supported formats:
#                  - Direct OU ID: ou-abcd-12345678
#                  - Path format: r-abcd/ou-abcd-12345678
#                  - Full ARN: arn:aws:organizations::123456789012:ou/o-abcdefghij/ou-abcd-12345678
#   -s SOC2_TYPE   SOC 2 type to target: 'type1', 'type2', or 'both' (default: both)
#   -b BASELINE    Control baseline: 'minimal', 'recommended', or 'comprehensive' (default: recommended)
#   -a             Alternative mode: Enable Security Hub instead of Control Tower if Control Tower fails
#   -h             Display this help message and exit
#
# Examples:
#   ./enable_control_tower_controls.sh -p sampleproject-admin -o ou-abcd-12345678
#   ./enable_control_tower_controls.sh -p sampleproject-admin -o ou-abcd-12345678 -s type2 -b comprehensive
#   ./enable_control_tower_controls.sh -p sampleproject-admin -o ou-abcd-12345678 -a
#
# Notes:
#   If you encounter errors enabling controls, consider using AWS Security Hub instead.
#   It provides similar security controls with easier management and broader compatibility.

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
USE_ALTERNATIVE=false

# Parse command line options
while getopts ":p:o:s:b:ah" opt; do
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
        a )
            USE_ALTERNATIVE=true
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

# Validate AWS profile and permissions
if ! aws configure list --profile "$AWS_PROFILE" &>/dev/null; then
    echo "ERROR: AWS profile '$AWS_PROFILE' not found!" 1>&2
    exit 1
fi

# Test AWS permissions - ensure we can call Organizations API
if ! aws organizations describe-organization --profile "$AWS_PROFILE" &>/dev/null; then
    echo "WARNING: You may not have permission to access AWS Organizations" 1>&2
    echo "         This script requires OrganizationAccountAccessRole or equivalent." 1>&2
    echo "         Will proceed anyway, but this may cause problems later." 1>&2
fi

# Validate OU_ID format (basic validation)
if ! [[ "$OU_ID" =~ ^ou-[a-z0-9]{4}-[a-z0-9]{8}$ ]] && ! [[ "$OU_ID" =~ ^arn:aws:organizations:: ]] && ! [[ "$OU_ID" =~ .*/ou-[a-z0-9]{4}-[a-z0-9]{8}$ ]]; then
    echo "WARNING: OU_ID format appears to be invalid." 1>&2
    echo "Expected formats:" 1>&2
    echo "  - Direct OU ID: ou-abcd-12345678" 1>&2
    echo "  - Path format: r-abcd/ou-abcd-12345678" 1>&2 
    echo "  - Full ARN: arn:aws:organizations::123456789012:ou/o-abcdefghij/ou-abcd-12345678" 1>&2
    echo "The script will attempt to convert to a proper ARN, but may fail if the format cannot be interpreted." 1>&2
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

# Function to get the AWS account ID
get_aws_account_id() {
    aws sts get-caller-identity --query "Account" --output text --profile "$AWS_PROFILE"
}

# Function to get AWS account ID
get_aws_account_id() {
    aws sts get-caller-identity --query "Account" --output text --profile "$AWS_PROFILE"
}

# Function to get the organization ID
get_organization_id() {
    local result=$(aws organizations describe-organization --query "Organization.Id" --output text --profile "$AWS_PROFILE" 2>/dev/null)
    if [ $? -eq 0 ] && [ -n "$result" ]; then
        echo "$result"
        return 0
    else
        # Try to get it from list-roots
        local roots_output=$(aws organizations list-roots --profile "$AWS_PROFILE" --output json 2>/dev/null)
        local org_id=$(echo "$roots_output" | grep -o '"o-[a-z0-9]\+"' | head -1 | tr -d '"')
        
        if [ -n "$org_id" ]; then
            echo "$org_id"
            return 0
        fi
    fi
    
    echo "ERROR: Could not determine organization ID." 1>&2
    return 1
}

# Function to enable a control
enable_control() {
    local control_id=$1
    local ou_id=$2
    local description=$3
    
    # Get the organization ID dynamically
    local org_id=$(get_organization_id)
    if [ $? -ne 0 ]; then
        echo "  ❌ Failed to get organization ID"
        return 1
    fi
    
    # Get AWS account ID
    local account_id=$(get_aws_account_id)
    
    # Construct the full OU ARN with the correct format (discovered from list-enabled-controls)
    local full_ou_arn="arn:aws:organizations::${account_id}:ou/${org_id}/${ou_id}"
    
    # Get the current AWS region for dynamic control ARNs
    local aws_region=$(aws configure get region --profile "$AWS_PROFILE")
    if [ -z "$aws_region" ]; then
        aws_region="us-east-1"  # Default to us-east-1 if region not found
    fi
    
    # Use the EXACT format discovered from list-enabled-controls
    local controltower_format="arn:aws:controltower:${aws_region}::control/${control_id}"
    
    # Get a special ARN based on the control ID
    # This function maps control IDs to their specific ARN formats
    get_special_arn() {
        local control="$1"
        
        case "$control" in
            # Control Tower format controls (these have been confirmed to work)
            "AWS-GR_CLOUDTRAIL_ENABLED")
                echo "arn:aws:controltower:us-east-1::control/AWS-GR_CLOUDTRAIL_ENABLED"
                ;;
            "AWS-GR_CONFIG_ENABLED")
                echo "arn:aws:controltower:us-east-1::control/AWS-GR_CONFIG_ENABLED"
                ;;
            "AWS-GR_CLOUDTRAIL_VALIDATION_ENABLED")
                echo "arn:aws:controltower:us-east-1::control/AWS-GR_CLOUDTRAIL_VALIDATION_ENABLED"
                ;;
            "AWS-GR_CLOUDWATCH_EVENTS_CHANGE_PROHIBITED")
                echo "arn:aws:controltower:us-east-1::control/AWS-GR_CLOUDWATCH_EVENTS_CHANGE_PROHIBITED"
                ;;
            "AWS-GR_ENCRYPTED_VOLUMES")
                echo "arn:aws:controltower:us-east-1::control/AWS-GR_ENCRYPTED_VOLUMES"
                ;;
            "AWS-GR_IAM_USER_MFA_ENABLED")
                echo "arn:aws:controltower:us-east-1::control/AWS-GR_IAM_USER_MFA_ENABLED"
                ;;
            "AWS-GR_RESTRICTED_COMMON_PORTS")
                echo "arn:aws:controltower:us-east-1::control/AWS-GR_RESTRICTED_COMMON_PORTS"
                ;;
            "AWS-GR_RESTRICTED_SSH")
                echo "arn:aws:controltower:us-east-1::control/AWS-GR_RESTRICTED_SSH"
                ;;
            "AWS-GR_RESTRICT_ROOT_USER")
                echo "arn:aws:controltower:us-east-1::control/AWS-GR_RESTRICT_ROOT_USER"
                ;;
            "AWS-GR_ROOT_ACCOUNT_MFA_ENABLED")
                echo "arn:aws:controltower:us-east-1::control/AWS-GR_ROOT_ACCOUNT_MFA_ENABLED"
                ;;
            
            # Control Catalog format controls per AWS documentation
            "AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED")
                echo "arn:aws:controlcatalog:::control/AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED"
                ;;
            "AWS-GR_S3_BUCKET_PUBLIC_WRITE_PROHIBITED")
                echo "arn:aws:controlcatalog:::control/AWS-GR_S3_BUCKET_PUBLIC_WRITE_PROHIBITED"
                ;;
            "AWS-GR_S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED")
                echo "arn:aws:controlcatalog:::control/AWS-GR_S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED"
                ;;
            *)
                echo ""
                ;;
        esac
    }
    
    # Check if this is a known special control with exact ARN
    local special_arn=$(get_special_arn "$control_id")
    
    # Try multiple control identifier formats, with known ones first
    # Use a space-separated string instead of an array for better sh compatibility
    local formats=""
    
    # Add the special ARN first if available
    if [ -n "$special_arn" ]; then
        formats="$special_arn"
    fi
    
    # Then add standard formats
    if [ -n "$formats" ]; then
        formats="$formats $controltower_format $control_id arn:aws:controlcatalog:::control/$control_id arn:aws:controltower:${aws_region}::control/$control_id"
    else
        formats="$controltower_format $control_id arn:aws:controlcatalog:::control/$control_id arn:aws:controltower:${aws_region}::control/$control_id"
    fi
    
    local success=false
    local result_output=""
    local error_output=""
    
    echo "Enabling control: $description (ID: $control_id)..."
    echo "  Using target identifier: $full_ou_arn"
    
    # Try each format until one works (using sh-compatible approach)
    echo "$formats" | tr ' ' '\n' | while read -r format_id; do
        if [ -n "$format_id" ]; then
            echo "  Attempting with identifier: $format_id"
            
            # Capture both stdout and stderr
            result_output=$(aws controltower enable-control \
                --control-identifier "$format_id" \
                --target-identifier "$full_ou_arn" \
                --profile "$AWS_PROFILE" 2>&1)
            
            if [ $? -eq 0 ]; then
                echo "  ✅ Successfully enabled $description"
                success=true
                # Signal success via a temporary file since we can't easily break out of the pipe loop
                echo "true" > "/tmp/control_success_$$"
                break
            else
                error_output="$result_output"
                echo "  ❌ Failed with identifier: $format_id"
            fi
        fi
    done
    
    # Check if any format succeeded
    if [ -f "/tmp/control_success_$$" ]; then
        success=true
        rm -f "/tmp/control_success_$$"
    fi
    
    if [ "$success" = true ]; then
        return 0
    else
        echo "  ❌ All attempts to enable $description failed"
        echo "  Last error: $error_output"
        
        # Recommend Security Hub as alternative
        echo "\n  📌 RECOMMENDATION: Consider using AWS Security Hub instead of Control Tower for this control."
        echo "     You can enable Security Hub with: aws securityhub enable-security-hub --profile $AWS_PROFILE"
        echo "     Security Hub has similar controls that are easier to enable and manage."
        
        return 1
    fi
}

# Arrays of control IDs based on SOC 2 type and baseline
# Control ARNs follow the format arn:aws:controltower:{region}::control/{control-id}
# Note: For production use, validate these controls are available in your AWS environment
# The actual control identifiers may vary by AWS Region or account setup
# We're updating from controlcatalog format to controltower format

# Minimal baseline controls for SOC 2 Type 1 - using space-separated string for sh compatibility
minimal_type1_controls="AWS-GR_ROOT_ACCOUNT_MFA_ENABLED AWS-GR_IAM_USER_MFA_ENABLED AWS-GR_RESTRICT_ROOT_USER AWS-GR_ENCRYPTED_VOLUMES"

# Minimal baseline controls for SOC 2 Type 2
minimal_type2_controls="AWS-GR_CLOUDTRAIL_ENABLED AWS-GR_CLOUDWATCH_ALARM_ACTION_CHECK"

# Recommended baseline additional controls for SOC 2 Type 1
recommended_type1_controls="AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED AWS-GR_S3_BUCKET_PUBLIC_WRITE_PROHIBITED AWS-GR_S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED AWS-GR_RDS_STORAGE_ENCRYPTED AWS-GR_RESTRICTED_SSH AWS-GR_RESTRICTED_COMMON_PORTS"

# Recommended baseline additional controls for SOC 2 Type 2
recommended_type2_controls="AWS-GR_CLOUDTRAIL_VALIDATION_ENABLED AWS-GR_CLOUD_TRAIL_ENCRYPTION_ENABLED AWS-GR_CLOUDTRAIL_LOG_FILE_VALIDATION_ENABLED AWS-GR_CONFIG_ENABLED"

# Comprehensive baseline additional controls for SOC 2 Type 1
comprehensive_type1_controls="AWS-GR_LAMBDA_FUNCTION_PUBLIC_ACCESS_PROHIBITED AWS-GR_EBS_OPTIMIZED_INSTANCE AWS-GR_IAM_USER_GROUP_MEMBERSHIP_CHECK AWS-GR_IAM_GROUP_HAS_USERS_CHECK AWS-GR_IAM_POLICY_NO_STATEMENTS_WITH_ADMIN_ACCESS"

# Comprehensive baseline additional controls for SOC 2 Type 2
comprehensive_type2_controls="AWS-GR_VPC_FLOW_LOGS_ENABLED AWS-GR_GUARDDUTY_ENABLED_CENTRALIZED AWS-GR_SECURITYHUB_ENABLED"

# Function to get control description
get_control_description() {
    local control_id="$1"
    
    # Extract just the AWS-GR_ part if full ARN is provided
    local control_name="$control_id"
    if [[ "$control_id" == arn:* ]]; then
        control_name=$(echo "$control_id" | grep -o 'AWS-GR_[A-Z_]\+')
    fi
    
    case "$control_name" in
        "AWS-GR_ROOT_ACCOUNT_MFA_ENABLED")
            echo "Ensure Root Account has MFA Enabled"
            ;;
        "AWS-GR_IAM_USER_MFA_ENABLED")
            echo "Ensure IAM Users have MFA Enabled"
            ;;
        "AWS-GR_RESTRICT_ROOT_USER")
            echo "Restrict Root User Access"
            ;;
        "AWS-GR_ENCRYPTED_VOLUMES")
            echo "Ensure EBS Volumes are Encrypted"
            ;;
        "AWS-GR_CLOUDTRAIL_ENABLED")
            echo "Ensure CloudTrail is Enabled"
            ;;
        "AWS-GR_CLOUDWATCH_ALARM_ACTION_CHECK")
            echo "Ensure CloudWatch Alarms Have Actions"
            ;;
        "AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED")
            echo "Prohibit Public Read Access to S3 Buckets"
            ;;
        "AWS-GR_S3_BUCKET_PUBLIC_WRITE_PROHIBITED")
            echo "Prohibit Public Write Access to S3 Buckets"
            ;;
        "AWS-GR_S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED")
            echo "Ensure S3 Buckets Have Encryption Enabled"
            ;;
        "AWS-GR_RDS_STORAGE_ENCRYPTED")
            echo "Ensure RDS Storage is Encrypted"
            ;;
        "AWS-GR_RESTRICTED_SSH")
            echo "Restrict SSH Access"
            ;;
        "AWS-GR_RESTRICTED_COMMON_PORTS")
            echo "Restrict Access to Common Ports"
            ;;
        "AWS-GR_CLOUDTRAIL_VALIDATION_ENABLED")
            echo "Enable CloudTrail Log File Validation"
            ;;
        "AWS-GR_CLOUD_TRAIL_ENCRYPTION_ENABLED")
            echo "Enable CloudTrail Encryption"
            ;;
        "AWS-GR_CLOUDTRAIL_LOG_FILE_VALIDATION_ENABLED")
            echo "Enable CloudTrail Log File Validation"
            ;;
        "AWS-GR_CONFIG_ENABLED")
            echo "Enable AWS Config"
            ;;
        "AWS-GR_LAMBDA_FUNCTION_PUBLIC_ACCESS_PROHIBITED")
            echo "Prohibit Public Access to Lambda Functions"
            ;;
        "AWS-GR_EBS_OPTIMIZED_INSTANCE")
            echo "Use EBS Optimized Instances"
            ;;
        "AWS-GR_IAM_USER_GROUP_MEMBERSHIP_CHECK")
            echo "Ensure IAM Users are in at Least One Group"
            ;;
        "AWS-GR_IAM_GROUP_HAS_USERS_CHECK")
            echo "Ensure IAM Groups Have at Least One User"
            ;;
        "AWS-GR_IAM_POLICY_NO_STATEMENTS_WITH_ADMIN_ACCESS")
            echo "Restrict Admin Access in IAM Policies"
            ;;
        "AWS-GR_VPC_FLOW_LOGS_ENABLED")
            echo "Enable VPC Flow Logs"
            ;;
        "AWS-GR_GUARDDUTY_ENABLED_CENTRALIZED")
            echo "Enable Centralized GuardDuty"
            ;;
        "AWS-GR_SECURITYHUB_ENABLED")
            echo "Enable Security Hub"
            ;;
        *)
            echo "Unknown control: $control_name"
            ;;
    esac
}

# Function to check if Control Tower is enabled
check_control_tower() {
    echo "Checking if AWS Control Tower is properly set up..."
    
    # Check if we can access Control Tower API
    if ! aws controltower list-enabled-controls --profile "$AWS_PROFILE" 2>&1 | grep -q "Error"; then
        echo "✅ AWS Control Tower API is accessible"
        return 0
    else
        echo "⚠️ Could not access AWS Control Tower API. This may be due to:"
        echo "  - Control Tower is not set up in this account"
        echo "  - Your AWS profile does not have required permissions"
        echo "  - You are in a region where Control Tower is not available"
        
        # Suggest alternative controls framework
        echo "\nConsider using AWS Security Hub for implementing security controls."
        echo "You can enable it with: aws securityhub enable-security-hub --profile $AWS_PROFILE"
        echo "\nProceeding anyway with Control Tower controls as requested..."
        return 1
    fi
}

# Main execution
echo "Starting to enable Control Tower controls for SOC 2 compliance..."
echo "  - OU ID: $OU_ID"
echo "  - SOC 2 Type: $SOC2_TYPE"
echo "  - Baseline: $BASELINE"
echo

# Check if Control Tower is available
if ! check_control_tower && [ "$USE_ALTERNATIVE" = true ]; then
    echo "\nWARNING: AWS Control Tower appears to be unavailable."
    echo "Since you specified the -a flag, we'll try to use AWS Security Hub instead."
    echo "Enabling AWS Security Hub..."
    
    # Try to enable Security Hub
    enable_output=$(aws securityhub enable-security-hub --profile "$AWS_PROFILE" 2>&1)
    if [ $? -eq 0 ]; then
        echo "✅ Successfully enabled AWS Security Hub"
        echo "Enabling AWS Security Hub standard: AWS Foundational Security Best Practices"
        
        # Get the standard ARN
        standard_arn=$(aws securityhub describe-standards --profile "$AWS_PROFILE" --query "Standards[?Name=='AWS Foundational Security Best Practices v1.0.0'].StandardsArn" --output text)
        
        if [ -n "$standard_arn" ]; then
            aws securityhub batch-enable-standards --standards-subscription-requests "StandardsArn=$standard_arn" --profile "$AWS_PROFILE"
            if [ $? -eq 0 ]; then
                echo "✅ Successfully enabled AWS Foundational Security Best Practices standard"
                echo "Your AWS environment is now being protected by Security Hub controls."
                echo "This provides similar protection to the Control Tower controls you were trying to enable."
                exit 0
            else
                echo "❌ Failed to enable Security Hub standard"
            fi
        else
            echo "❌ Could not find AWS Foundational Security Best Practices standard"
        fi
    else
        echo "❌ Failed to enable AWS Security Hub: $enable_output"
        echo "Continuing with Control Tower controls attempt..."
    fi
fi

# Initialize string to track controls to enable - using space-separated string for better compatibility
controls_to_enable=""

# Add controls based on baseline and SOC 2 type
if [ "$BASELINE" = "minimal" ] || [ "$BASELINE" = "recommended" ] || [ "$BASELINE" = "comprehensive" ]; then
    if [ "$SOC2_TYPE" = "type1" ] || [ "$SOC2_TYPE" = "both" ]; then
        for control in $minimal_type1_controls; do
            controls_to_enable="$controls_to_enable $control"
        done
    fi
    if [ "$SOC2_TYPE" = "type2" ] || [ "$SOC2_TYPE" = "both" ]; then
        for control in $minimal_type2_controls; do
            controls_to_enable="$controls_to_enable $control"
        done
    fi
fi

if [ "$BASELINE" = "recommended" ] || [ "$BASELINE" = "comprehensive" ]; then
    if [ "$SOC2_TYPE" = "type1" ] || [ "$SOC2_TYPE" = "both" ]; then
        for control in $recommended_type1_controls; do
            controls_to_enable="$controls_to_enable $control"
        done
    fi
    if [ "$SOC2_TYPE" = "type2" ] || [ "$SOC2_TYPE" = "both" ]; then
        for control in $recommended_type2_controls; do
            controls_to_enable="$controls_to_enable $control"
        done
    fi
fi

if [ "$BASELINE" = "comprehensive" ]; then
    if [ "$SOC2_TYPE" = "type1" ] || [ "$SOC2_TYPE" = "both" ]; then
        for control in $comprehensive_type1_controls; do
            controls_to_enable="$controls_to_enable $control"
        done
    fi
    if [ "$SOC2_TYPE" = "type2" ] || [ "$SOC2_TYPE" = "both" ]; then
        for control in $comprehensive_type2_controls; do
            controls_to_enable="$controls_to_enable $control"
        done
    fi
fi

# Remove duplicates from the list of controls
controls_to_enable=$(echo "$controls_to_enable" | tr ' ' '\n' | sort -u | tr '\n' ' ')

# Enable the selected controls
success_count=0
failure_count=0
# Remove this line as it's redundant with the counting code below

# Handle the case where no controls are selected
if [ -z "$controls_to_enable" ]; then
    echo "No controls selected based on your criteria. Please check your SOC2_TYPE and BASELINE settings."
    exit 0
fi

# Count the number of controls for reporting
control_count=$(echo "$controls_to_enable" | wc -w)
echo "Enabling $control_count controls..."
echo

# Process each control in the space-separated list
echo "$controls_to_enable" | tr ' ' '\n' | while read -r control_id; do
    if [ -n "$control_id" ]; then
        description="$(get_control_description "$control_id")"
        enable_control "$control_id" "$OU_ID" "$description"
        result=$?
        
        # Track success/failure in temporary files for later counting
        if [ $result -eq 0 ]; then
            echo "success" >> "/tmp/control_results_success_$$"
        else
            echo "failure" >> "/tmp/control_results_failure_$$"
        fi
        
        echo
    fi
done

# Count successes and failures from temporary files
success_count=0
if [ -f "/tmp/control_results_success_$$" ]; then
    success_count=$(cat "/tmp/control_results_success_$$" | wc -l)
    rm -f "/tmp/control_results_success_$$"
fi

failure_count=0
if [ -f "/tmp/control_results_failure_$$" ]; then
    failure_count=$(cat "/tmp/control_results_failure_$$" | wc -l)
    rm -f "/tmp/control_results_failure_$$"
fi

echo "Control enabling process completed."
echo "  - Successfully enabled: $success_count controls"
echo "  - Failed: $failure_count controls"
echo

# Provide recommendations based on results
if [ $failure_count -gt 0 ]; then
    echo "Recommendations for failed controls:"
    echo "  - Check if AWS Control Tower is fully set up in your AWS environment"
    echo "  - Verify that the control identifiers are valid for your AWS region"
    echo "  - Ensure your AWS profile has sufficient permissions"
    echo "  - Consider using AWS Security Hub as an alternative controls framework"
    echo "  - Review AWS Control Tower documentation for your specific region"
    if [ $success_count -eq 0 ]; then
        echo "  - Try running the script with a different AWS region specified with AWS_DEFAULT_REGION"
        echo "    Example: AWS_DEFAULT_REGION=us-west-2 ./enable_control_tower_controls.sh ..."
        
        # If all controls failed and alternative mode is enabled, try Security Hub
        if [ "$USE_ALTERNATIVE" = true ]; then
            echo "\nSince all controls failed to enable and -a flag was specified,"
            echo "attempting to set up AWS Security Hub as an alternative..."
            
            # Try to enable Security Hub
            enable_output=$(aws securityhub enable-security-hub --profile "$AWS_PROFILE" 2>&1)
            if [ $? -eq 0 ]; then
                echo "✅ Successfully enabled AWS Security Hub"
                
                # Enable AWS Foundational Security Best Practices
                standard_arn=$(aws securityhub describe-standards --profile "$AWS_PROFILE" \
                    --query "Standards[?Name=='AWS Foundational Security Best Practices v1.0.0'].StandardsArn" \
                    --output text)
                
                if [ -n "$standard_arn" ]; then
                    aws securityhub batch-enable-standards \
                        --standards-subscription-requests "StandardsArn=$standard_arn" \
                        --profile "$AWS_PROFILE"
                    
                    if [ $? -eq 0 ]; then
                        echo "✅ Successfully enabled AWS Foundational Security Best Practices standard"
                        echo "\nALTERNATIVE IMPLEMENTATION: Your AWS environment is now being protected by Security Hub controls."
                        echo "This provides similar protection to the Control Tower controls you were trying to enable."
                        echo "You can view and manage these controls in the Security Hub console."
                        exit 0
                    fi
                fi
                
                # Try enabling CIS AWS Foundations Benchmark if FSBP failed
                standard_arn=$(aws securityhub describe-standards --profile "$AWS_PROFILE" \
                    --query "Standards[?Name=='CIS AWS Foundations Benchmark v1.2.0'].StandardsArn" \
                    --output text)
                
                if [ -n "$standard_arn" ]; then
                    aws securityhub batch-enable-standards \
                        --standards-subscription-requests "StandardsArn=$standard_arn" \
                        --profile "$AWS_PROFILE"
                    
                    if [ $? -eq 0 ]; then
                        echo "✅ Successfully enabled CIS AWS Foundations Benchmark standard"
                        echo "\nALTERNATIVE IMPLEMENTATION: Your AWS environment is now being protected by Security Hub CIS controls."
                        echo "This provides similar protection to the Control Tower controls you were trying to enable."
                        echo "You can view and manage these controls in the Security Hub console."
                        exit 0
                    fi
                fi
                
                echo "❌ Failed to enable specific Security Hub standards"
                echo "Security Hub is enabled, but you'll need to manually enable standards in the console."
                echo "Visit: https://console.aws.amazon.com/securityhub/home#/standards"
                exit 1
            else
                echo "❌ Failed to enable AWS Security Hub: $enable_output"
            fi
        fi
    fi
fi

echo "Note: Control activation may take some time to complete in the AWS Control Tower console."
echo "Check the status in the AWS Control Tower console."

# Exit with appropriate status code
if [ $failure_count -gt 0 ] && [ $success_count -eq 0 ]; then
    echo "All controls failed to enable. Exiting with error code 1."
    echo "\nCONSIDER ALTERNATIVES:" 
    echo "1. Use AWS Security Hub instead with: aws securityhub enable-security-hub --profile $AWS_PROFILE"
    echo "2. Use AWS Config Rules directly to create similar controls"
    echo "3. Check AWS Control Tower setup in your account"
    exit 1
elif [ $failure_count -gt 0 ]; then
    echo "Some controls failed to enable, but others succeeded. Exiting with code 0."
    exit 0
else
    echo "All controls enabled successfully. Exiting with code 0."
    exit 0
fi