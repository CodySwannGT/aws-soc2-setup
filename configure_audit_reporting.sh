#!/bin/bash
# configure_audit_reporting.sh - Configure AWS audit and reporting for SOC 2 compliance
#
# Description:
#   This script configures AWS Audit Manager, Config, and CloudTrail for comprehensive
#   audit and reporting capabilities required for SOC 2 compliance.
#
# Usage:
#   ./configure_audit_reporting.sh -p PROFILE [-b BUCKET_NAME] [-a] [-f] [-r] [-h]
#
# Parameters:
#   -p PROFILE     AWS CLI profile to use (required)
#   -b BUCKET_NAME Name of the S3 bucket for audit reports (optional)
#   -a             Enable AWS Audit Manager (optional)
#   -f             Create SOC 2 framework in Audit Manager (optional)
#   -r             Set up Config aggregator for multi-account reporting (optional)
#   -h             Display this help message and exit
#
# Examples:
#   ./configure_audit_reporting.sh -p thehobbyhome-admin -a -f
#   ./configure_audit_reporting.sh -p thehobbyhome-admin -b audit-reports-bucket -a -f -r

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
AWS_PROFILE=""
BUCKET_NAME=""
ENABLE_AUDIT_MANAGER=false
CREATE_SOC2_FRAMEWORK=false
SETUP_CONFIG_AGGREGATOR=false

# Parse command line options
while getopts ":p:b:afrh" opt; do
    case ${opt} in
        p )
            AWS_PROFILE=$OPTARG
            ;;
        b )
            BUCKET_NAME=$OPTARG
            ;;
        a )
            ENABLE_AUDIT_MANAGER=true
            ;;
        f )
            CREATE_SOC2_FRAMEWORK=true
            ;;
        r )
            SETUP_CONFIG_AGGREGATOR=true
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

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query "Account" --output text)
if [ -z "$ACCOUNT_ID" ]; then
    echo "ERROR: Could not retrieve AWS account ID!" 1>&2
    exit 1
fi

# Get region
REGION=$(aws configure get region --profile "$AWS_PROFILE")
if [ -z "$REGION" ]; then
    echo "ERROR: Could not determine AWS region for profile '$AWS_PROFILE'!" 1>&2
    exit 1
fi

# Generate bucket name if not provided
if [ -z "$BUCKET_NAME" ]; then
    BUCKET_NAME="audit-reports-$ACCOUNT_ID"
    echo "No bucket name provided. Using default: $BUCKET_NAME"
fi

# Main execution
echo "Starting audit and reporting configuration for SOC 2 compliance..."
echo "  - AWS Profile: $AWS_PROFILE"
echo "  - Account ID: $ACCOUNT_ID"
echo "  - Region: $REGION"
echo "  - Audit Reports Bucket: $BUCKET_NAME"
echo

# Create S3 bucket for audit reports
echo "Creating S3 bucket for audit reports..."

# Check if bucket exists
if ! aws s3api head-bucket --bucket "$BUCKET_NAME" --profile "$AWS_PROFILE" 2>/dev/null; then
    # Create bucket command varies based on region
    if [ "$REGION" = "us-east-1" ]; then
        aws s3api create-bucket --bucket "$BUCKET_NAME" --profile "$AWS_PROFILE" > /dev/null
    else
        aws s3api create-bucket --bucket "$BUCKET_NAME" --create-bucket-configuration LocationConstraint="$REGION" --profile "$AWS_PROFILE" > /dev/null
    fi
    
    if [ $? -ne 0 ]; then
        echo "  ERROR: Failed to create bucket '$BUCKET_NAME'!" 1>&2
        echo "  Using existing bucket(s) for audit reports." 1>&2
    else
        echo "  Successfully created bucket: $BUCKET_NAME"
        
        # Enable bucket encryption
        aws s3api put-bucket-encryption \
            --bucket "$BUCKET_NAME" \
            --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}' \
            --profile "$AWS_PROFILE" > /dev/null
        
        # Block public access
        aws s3api put-public-access-block \
            --bucket "$BUCKET_NAME" \
            --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
            --profile "$AWS_PROFILE" > /dev/null
    fi
else
    echo "  Bucket '$BUCKET_NAME' already exists. Using existing bucket."
fi

echo

# Enable AWS Audit Manager if requested
if [ "$ENABLE_AUDIT_MANAGER" = true ]; then
    echo "Enabling AWS Audit Manager..."
    
    # Check if Audit Manager is already enabled
    AM_STATUS=$(aws auditmanager get-settings --profile "$AWS_PROFILE" --query "settings.status" --output text 2>/dev/null)
    
    if [ "$AM_STATUS" = "ACTIVE" ]; then
        echo "  AWS Audit Manager is already enabled."
    else
        # Enable Audit Manager with S3 bucket configuration
        aws auditmanager update-settings \
            --default-assessment-reports-destination "destinationType=S3,destination=s3://$BUCKET_NAME" \
            --profile "$AWS_PROFILE" > /dev/null
        
        if [ $? -ne 0 ]; then
            echo "  ERROR: Failed to enable AWS Audit Manager!" 1>&2
        else
            echo "  Successfully enabled AWS Audit Manager."
            
            # Register delegated administrator if this is the management account
            echo "  Attempting to register delegated administrator..."
            
            aws organizations register-delegated-administrator \
                --service-principal auditmanager.amazonaws.com \
                --account-id "$ACCOUNT_ID" \
                --profile "$AWS_PROFILE" > /dev/null 2>&1
            
            if [ $? -ne 0 ]; then
                echo "  INFO: Could not register delegated administrator. This is expected if not the Organizations management account." 1>&2
            else
                echo "  Successfully registered the account as a delegated administrator for Audit Manager."
            fi
        fi
    fi
    
    echo
fi

# Create SOC 2 framework in Audit Manager if requested
if [ "$CREATE_SOC2_FRAMEWORK" = true ]; then
    echo "Creating SOC 2 framework in AWS Audit Manager..."
    
    # Check if Audit Manager is enabled
    AM_STATUS=$(aws auditmanager get-settings --profile "$AWS_PROFILE" --query "settings.status" --output text 2>/dev/null)
    
    if [ "$AM_STATUS" != "ACTIVE" ]; then
        echo "  ERROR: AWS Audit Manager is not enabled! Enable it first with -a option." 1>&2
    else
        # List available frameworks to find SOC 2 framework
        SOC2_FRAMEWORK_ID=$(aws auditmanager list-assessment-frameworks \
            --framework-type Standard \
            --profile "$AWS_PROFILE" \
            --query "frameworkMetadataList[?name=='SOC 2'].id" \
            --output text)
        
        if [ -z "$SOC2_FRAMEWORK_ID" ] || [ "$SOC2_FRAMEWORK_ID" == "None" ]; then
            echo "  ERROR: Could not find standard SOC 2 framework in Audit Manager!" 1>&2
        else
            echo "  Found SOC 2 framework: $SOC2_FRAMEWORK_ID"
            
            # Create a SOC 2 assessment
            ASSESSMENT_ID=$(aws auditmanager create-assessment \
                --name "SOC 2 Type 2 Assessment" \
                --description "Automated SOC 2 Type 2 assessment created by script" \
                --assessment-reports-destination "destinationType=S3,destination=s3://$BUCKET_NAME" \
                --scope "awsAccounts=[{id=$ACCOUNT_ID,name=Primary}]" \
                --framework-id "$SOC2_FRAMEWORK_ID" \
                --profile "$AWS_PROFILE" \
                --query "assessment.id" \
                --output text)
            
            if [ -z "$ASSESSMENT_ID" ] || [ "$ASSESSMENT_ID" == "None" ]; then
                echo "  ERROR: Failed to create SOC 2 assessment!" 1>&2
            else
                echo "  Successfully created SOC 2 assessment with ID: $ASSESSMENT_ID"
            fi
        fi
    fi
    
    echo
fi

# Set up Config aggregator for multi-account reporting if requested
if [ "$SETUP_CONFIG_AGGREGATOR" = true ]; then
    echo "Setting up AWS Config aggregator for multi-account reporting..."
    
    # Check if Config is enabled
    CONFIG_RECORDER=$(aws configservice describe-configuration-recorders \
        --profile "$AWS_PROFILE" \
        --query "ConfigurationRecorders[0].name" \
        --output text 2>/dev/null)
    
    if [ -z "$CONFIG_RECORDER" ] || [ "$CONFIG_RECORDER" == "None" ]; then
        echo "  ERROR: AWS Config is not enabled! Enable it first." 1>&2
    else
        # Create Config aggregator
        AGGREGATOR_NAME="SOC2-Config-Aggregator"
        
        # Check if aggregator already exists
        EXISTING_AGGREGATOR=$(aws configservice describe-configuration-aggregators \
            --profile "$AWS_PROFILE" \
            --query "ConfigurationAggregators[?ConfigurationAggregatorName=='$AGGREGATOR_NAME'].ConfigurationAggregatorName" \
            --output text 2>/dev/null)
        
        if [ -n "$EXISTING_AGGREGATOR" ] && [ "$EXISTING_AGGREGATOR" != "None" ]; then
            echo "  Config aggregator '$AGGREGATOR_NAME' already exists."
        else
            # Create aggregator
            aws configservice put-configuration-aggregator \
                --configuration-aggregator-name "$AGGREGATOR_NAME" \
                --organization-aggregation-source "{\"RoleArn\":\"arn:aws:iam::$ACCOUNT_ID:role/aws-service-role/config.amazonaws.com/AWSServiceRoleForConfig\",\"AllAwsRegions\":true}" \
                --profile "$AWS_PROFILE" > /dev/null
            
            if [ $? -ne 0 ]; then
                echo "  ERROR: Failed to create Config aggregator!" 1>&2
                echo "  Make sure the account has proper permissions in the organization." 1>&2
            else
                echo "  Successfully created Config aggregator: $AGGREGATOR_NAME"
            fi
        fi
    fi
    
    echo
fi

echo "Audit and reporting configuration completed."
echo
echo "Next steps:"
echo "1. Visit AWS Audit Manager in the console to manage your assessment"
echo "2. Configure automated evidence collection rules in Audit Manager"
echo "3. Set up scheduled exports of evidence to the S3 bucket"
echo "4. Implement a review process for audit findings"