#!/bin/bash
# enable_security_services.sh - Enable and configure AWS security services
#
# Description:
#   This script enables and configures AWS security services required for
#   SOC 2 compliance, including GuardDuty, Security Hub, Config, and others.
#
# Usage:
#   ./enable_security_services.sh -p PROFILE [-g] [-s] [-c] [-m] [-i] [-a] [-h]
#
# Parameters:
#   -p PROFILE     AWS CLI profile with permissions to enable services (required)
#   -g             Enable Amazon GuardDuty
#   -s             Enable AWS Security Hub
#   -c             Enable AWS Config
#   -m             Enable Amazon Macie
#   -i             Enable Amazon Inspector
#   -a             Enable all security services
#   -h             Display this help message and exit
#
# Examples:
#   ./enable_security_services.sh -p sampleproject-admin -a
#   ./enable_security_services.sh -p sampleproject-admin -g -s -c

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
AWS_PROFILE=""
ENABLE_GUARDDUTY=false
ENABLE_SECURITY_HUB=false
ENABLE_CONFIG=false
ENABLE_MACIE=false
ENABLE_INSPECTOR=false

# Parse command line options
while getopts ":p:gscmiah" opt; do
    case ${opt} in
        p )
            AWS_PROFILE=$OPTARG
            ;;
        g )
            ENABLE_GUARDDUTY=true
            ;;
        s )
            ENABLE_SECURITY_HUB=true
            ;;
        c )
            ENABLE_CONFIG=true
            ;;
        m )
            ENABLE_MACIE=true
            ;;
        i )
            ENABLE_INSPECTOR=true
            ;;
        a )
            ENABLE_GUARDDUTY=true
            ENABLE_SECURITY_HUB=true
            ENABLE_CONFIG=true
            ENABLE_MACIE=true
            ENABLE_INSPECTOR=true
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

# Check if any services were selected
if [ "$ENABLE_GUARDDUTY" = false ] && [ "$ENABLE_SECURITY_HUB" = false ] && \
   [ "$ENABLE_CONFIG" = false ] && [ "$ENABLE_MACIE" = false ] && [ "$ENABLE_INSPECTOR" = false ]; then
    echo "ERROR: No security services selected to enable!" 1>&2
    echo "Use -g, -s, -c, -m, -i, or -a options to select services." 1>&2
    display_help
fi

# Get account ID for output
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query "Account" --output text)
if [ -z "$ACCOUNT_ID" ]; then
    echo "WARNING: Unable to retrieve AWS account ID." 1>&2
fi

# Function to create S3 bucket with encryption
create_s3_bucket_with_encryption() {
    local bucket_name=$1
    local region=$(aws configure get region --profile "$AWS_PROFILE")
    
    # Check if bucket exists
    if aws s3api head-bucket --bucket "$bucket_name" --profile "$AWS_PROFILE" 2>/dev/null; then
        echo "  Bucket '$bucket_name' already exists. Skipping creation."
        return 0
    fi
    
    # Create bucket command varies based on region
    if [ "$region" = "us-east-1" ]; then
        aws s3api create-bucket --bucket "$bucket_name" --profile "$AWS_PROFILE" > /dev/null
    else
        aws s3api create-bucket --bucket "$bucket_name" --create-bucket-configuration LocationConstraint="$region" --profile "$AWS_PROFILE" > /dev/null
    fi
    
    if [ $? -ne 0 ]; then
        echo "  ERROR: Failed to create bucket '$bucket_name'!" 1>&2
        return 1
    fi
    
    # Enable bucket encryption
    aws s3api put-bucket-encryption \
        --bucket "$bucket_name" \
        --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}' \
        --profile "$AWS_PROFILE" > /dev/null
    
    if [ $? -ne 0 ]; then
        echo "  WARNING: Failed to enable encryption on bucket '$bucket_name'!" 1>&2
    fi
    
    # Block public access
    aws s3api put-public-access-block \
        --bucket "$bucket_name" \
        --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
        --profile "$AWS_PROFILE" > /dev/null
    
    if [ $? -ne 0 ]; then
        echo "  WARNING: Failed to block public access on bucket '$bucket_name'!" 1>&2
    fi
    
    echo "  Successfully created encrypted bucket: $bucket_name"
    return 0
}

# Main execution
echo "Starting security services configuration for SOC 2 compliance..."
echo "Using AWS Profile: $AWS_PROFILE"
echo

# Enable AWS Config if requested
if [ "$ENABLE_CONFIG" = true ]; then
    echo "Enabling AWS Config..."
    
    # Create S3 bucket for Config
    CONFIG_BUCKET="config-bucket-$ACCOUNT_ID"
    CONFIG_PREFIX="config"
    create_s3_bucket_with_encryption "$CONFIG_BUCKET"
    
    # Add bucket policy to allow AWS Config to write to the bucket
    echo "  Setting up S3 bucket policy for AWS Config..."
    TEMP_BUCKET_POLICY=$(mktemp)
    cat > "$TEMP_BUCKET_POLICY" << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AWSConfigBucketPermissionsCheck",
      "Effect": "Allow",
      "Principal": {
        "Service": "config.amazonaws.com"
      },
      "Action": "s3:GetBucketAcl",
      "Resource": "arn:aws:s3:::$CONFIG_BUCKET"
    },
    {
      "Sid": "AWSConfigBucketDelivery",
      "Effect": "Allow",
      "Principal": {
        "Service": "config.amazonaws.com"
      },
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::$CONFIG_BUCKET/$CONFIG_PREFIX/AWSLogs/$ACCOUNT_ID/Config/*",
      "Condition": {
        "StringEquals": {
          "s3:x-amz-acl": "bucket-owner-full-control"
        }
      }
    }
  ]
}
EOF

    # Apply the bucket policy
    aws s3api put-bucket-policy \
        --bucket "$CONFIG_BUCKET" \
        --policy file://"$TEMP_BUCKET_POLICY" \
        --profile "$AWS_PROFILE" > /dev/null
        
    if [ $? -ne 0 ]; then
        echo "  WARNING: Failed to set bucket policy for '$CONFIG_BUCKET'!" 1>&2
    else
        echo "  Successfully set bucket policy for AWS Config."
    fi
    
    rm -f "$TEMP_BUCKET_POLICY"
    
    # Create IAM role for Config if it doesn't exist
    CONFIG_ROLE_NAME="AWSConfigRole"
    CONFIG_ROLE_ARN=""
    
    # Check if role exists
    CONFIG_ROLE_ARN=$(aws iam get-role --role-name "$CONFIG_ROLE_NAME" --profile "$AWS_PROFILE" --query "Role.Arn" --output text 2>/dev/null)
    
    if [ -z "$CONFIG_ROLE_ARN" ] || [ "$CONFIG_ROLE_ARN" == "None" ]; then
        echo "  Creating IAM role for AWS Config..."
        
        # Create trust policy document
        TEMP_TRUST_POLICY=$(mktemp)
        cat > "$TEMP_TRUST_POLICY" << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "config.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
        
        # Create the role
        CONFIG_ROLE_ARN=$(aws iam create-role \
            --role-name "$CONFIG_ROLE_NAME" \
            --assume-role-policy-document file://"$TEMP_TRUST_POLICY" \
            --profile "$AWS_PROFILE" \
            --query "Role.Arn" \
            --output text)
        
        rm -f "$TEMP_TRUST_POLICY"
        
        if [ -z "$CONFIG_ROLE_ARN" ] || [ "$CONFIG_ROLE_ARN" == "None" ]; then
            echo "  ERROR: Failed to create IAM role for AWS Config!" 1>&2
            echo "  Skipping AWS Config configuration."
            echo
        else
            # Attach necessary policies
            aws iam attach-role-policy \
                --role-name "$CONFIG_ROLE_NAME" \
                --policy-arn "arn:aws:iam::aws:policy/service-role/AWS_ConfigRole" \
                --profile "$AWS_PROFILE" > /dev/null
            
            echo "  Successfully created IAM role for AWS Config: $CONFIG_ROLE_ARN"
        fi
    else
        echo "  Using existing IAM role for AWS Config: $CONFIG_ROLE_ARN"
    fi
    
    if [ -n "$CONFIG_ROLE_ARN" ]; then
        # Enable Config recording
        echo "  Configuring AWS Config recorder..."
        
        # Configure AWS Config recorder
        echo "  Configuring AWS Config recorder..."
        
        aws configservice put-configuration-recorder \
            --configuration-recorder name=default,roleARN="$CONFIG_ROLE_ARN" \
            --recording-group allSupported=true,includeGlobalResourceTypes=true \
            --profile "$AWS_PROFILE" > /dev/null
        
        if [ $? -ne 0 ]; then
            echo "  ERROR: Failed to configure AWS Config recorder!" 1>&2
            echo "  Skipping remaining AWS Config setup steps."
        else
            echo "  Successfully configured AWS Config recorder."
            
            # Set up delivery channel only if recorder was configured successfully
            echo "  Setting up AWS Config delivery channel..."
            
            aws configservice put-delivery-channel \
                --delivery-channel name=default,s3BucketName="$CONFIG_BUCKET",s3KeyPrefix="$CONFIG_PREFIX",configSnapshotDeliveryProperties={deliveryFrequency=One_Hour} \
                --profile "$AWS_PROFILE" > /dev/null
            
            if [ $? -ne 0 ]; then
                echo "  ERROR: Failed to set up AWS Config delivery channel!" 1>&2
                echo "  Skipping remaining AWS Config setup steps."
            else
                echo "  Successfully set up AWS Config delivery channel."
                
                # Start the recorder only if delivery channel was set up successfully
                echo "  Starting AWS Config recorder..."
                
                aws configservice start-configuration-recorder \
                    --configuration-recorder-name default \
                    --profile "$AWS_PROFILE" > /dev/null
                
                if [ $? -ne 0 ]; then
                    echo "  ERROR: Failed to start AWS Config recorder!" 1>&2
                else
                    echo "  Successfully started AWS Config recorder."
                fi
            fi
        fi
    fi
    
    echo "AWS Config setup completed."
    echo
fi

# Enable GuardDuty if requested
# Continuing with enable_security_services.sh script...

# Enable GuardDuty if requested
if [ "$ENABLE_GUARDDUTY" = true ]; then
    echo "Enabling Amazon GuardDuty..."
    
    # Check if GuardDuty is already enabled
    GD_DETECTOR_ID=$(aws guardduty list-detectors --profile "$AWS_PROFILE" --query "DetectorIds[0]" --output text)
    
    if [ -z "$GD_DETECTOR_ID" ] || [ "$GD_DETECTOR_ID" == "None" ]; then
        # Enable GuardDuty
        echo "  Creating new GuardDuty detector..."
        
        GD_DETECTOR_ID=$(aws guardduty create-detector \
            --enable \
            --finding-publishing-frequency FIFTEEN_MINUTES \
            --profile "$AWS_PROFILE" \
            --query "DetectorId" \
            --output text)
        
        if [ -z "$GD_DETECTOR_ID" ] || [ "$GD_DETECTOR_ID" == "None" ]; then
            echo "  ERROR: Failed to enable GuardDuty!" 1>&2
        else
            echo "  Successfully enabled GuardDuty with detector ID: $GD_DETECTOR_ID"
        fi
    else
        echo "  GuardDuty is already enabled with detector ID: $GD_DETECTOR_ID"
        
        # Update the existing detector to ensure it's enabled
        aws guardduty update-detector \
            --detector-id "$GD_DETECTOR_ID" \
            --enable \
            --finding-publishing-frequency FIFTEEN_MINUTES \
            --profile "$AWS_PROFILE" > /dev/null
        
        if [ $? -ne 0 ]; then
            echo "  ERROR: Failed to update GuardDuty detector settings!" 1>&2
        else
            echo "  Successfully updated GuardDuty detector settings."
        fi
    fi
    
    echo "GuardDuty setup completed."
    echo
fi

# Enable Security Hub if requested
if [ "$ENABLE_SECURITY_HUB" = true ]; then
    echo "Enabling AWS Security Hub..."
    
    # Enable Security Hub
    aws securityhub enable-security-hub \
        --enable-default-standards \
        --profile "$AWS_PROFILE" > /dev/null
    
    if [ $? -ne 0 ]; then
        echo "  WARNING: Failed to enable Security Hub. It might already be enabled." 1>&2
        
        # Check if Security Hub is already enabled
        HUB_STATUS=$(aws securityhub get-enabled-standards --profile "$AWS_PROFILE" --query "StandardsSubscriptions[0].StandardsStatus" --output text 2>/dev/null)
        
        if [ -n "$HUB_STATUS" ]; then
            echo "  Security Hub is already enabled with status: $HUB_STATUS"
        else
            echo "  ERROR: Could not determine Security Hub status. Check in the AWS console." 1>&2
        fi
    else
        echo "  Successfully enabled Security Hub with default standards."
    fi
    
    # Enable SOC 2 specific Security Hub standards
    echo "  Enabling CIS AWS Foundations Benchmark..."
    
    # Get CIS standard ARN
    CIS_ARN="arn:aws:securityhub:::ruleset/cis-aws-foundations-benchmark/v/1.2.0"
    
    aws securityhub batch-enable-standards \
        --standards-subscription-requests "[{\"StandardsArn\":\"$CIS_ARN\"}]" \
        --profile "$AWS_PROFILE" > /dev/null
    
    if [ $? -ne 0 ]; then
        echo "  WARNING: Failed to enable CIS standard. It might already be enabled." 1>&2
    else
        echo "  Successfully enabled CIS AWS Foundations Benchmark."
    fi
    
    echo "Security Hub setup completed."
    echo
fi

# Enable Macie if requested
if [ "$ENABLE_MACIE" = true ]; then
    echo "Enabling Amazon Macie..."
    
    # Enable Macie
    aws macie2 enable-macie --profile "$AWS_PROFILE" > /dev/null
    
    if [ $? -ne 0 ]; then
        echo "  WARNING: Failed to enable Macie. It might already be enabled." 1>&2
        
        # Check if Macie is already enabled
        MACIE_STATUS=$(aws macie2 get-macie-session --profile "$AWS_PROFILE" --query "status" --output text 2>/dev/null)
        
        if [ -n "$MACIE_STATUS" ]; then
            echo "  Macie is already enabled with status: $MACIE_STATUS"
        else
            echo "  ERROR: Could not determine Macie status. Check in the AWS console." 1>&2
        fi
    else
        echo "  Successfully enabled Macie."
        
        # Configure auto-discovery of sensitive data
        echo "  Configuring automated sensitive data discovery..."
        
        aws macie2 update-automated-discovery-configuration \
            --status ENABLED \
            --profile "$AWS_PROFILE" > /dev/null
        
        if [ $? -ne 0 ]; then
            echo "  WARNING: Failed to enable automated sensitive data discovery." 1>&2
        else
            echo "  Successfully enabled automated sensitive data discovery."
        fi
    fi
    
    echo "Macie setup completed."
    echo
fi

# Enable Inspector if requested
if [ "$ENABLE_INSPECTOR" = true ]; then
    echo "Enabling Amazon Inspector..."
    
    # Enable Inspector
    aws inspector2 enable \
        --resource-types EC2 ECR LAMBDA \
        --profile "$AWS_PROFILE" > /dev/null
    
    if [ $? -ne 0 ]; then
        echo "  WARNING: Failed to enable Inspector. It might already be enabled." 1>&2
        
        # Check if Inspector is already enabled
        INSPECTOR_STATUS=$(aws inspector2 describe-configuration --profile "$AWS_PROFILE" --query "ec2.status" --output text 2>/dev/null)
        
        if [ -n "$INSPECTOR_STATUS" ]; then
            echo "  Inspector is already enabled with EC2 scanning status: $INSPECTOR_STATUS"
        else
            echo "  ERROR: Could not determine Inspector status. Check in the AWS console." 1>&2
        fi
    else
        echo "  Successfully enabled Inspector for EC2, ECR, and Lambda."
        
        # Configure scanning frequency
        echo "  Configuring scanning settings..."
        
        aws inspector2 update-configuration \
            --scanning-configuration '{"ec2":{"scanningStatus":"ENABLED"},"ecr":{"scanningStatus":"ENABLED","rescanDuration":"DAYS_30"},"lambda":{"scanningStatus":"ENABLED"}}' \
            --profile "$AWS_PROFILE" > /dev/null
        
        if [ $? -ne 0 ]; then
            echo "  WARNING: Failed to update Inspector scanning settings." 1>&2
        else
            echo "  Successfully configured Inspector scanning settings."
        fi
    fi
    
    echo "Inspector setup completed."
    echo
fi

echo "Security services configuration completed."
echo
echo "Next steps:"
echo "1. Check the AWS console to verify all services are properly configured"
echo "2. For AWS Organizations-wide deployment, consider configuring delegated administrators"
echo "3. Set up notification channels for security findings"