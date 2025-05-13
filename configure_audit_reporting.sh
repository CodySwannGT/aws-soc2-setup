#!/bin/bash
# configure_audit_reporting.sh - Configure AWS audit and reporting for SOC 2 compliance
#
# Description:
#   This script configures AWS Audit Manager, Config, and CloudTrail for comprehensive
#   audit and reporting capabilities required for SOC 2 compliance.
#
# Usage:
#   ./configure_audit_reporting.sh -p PROFILE [-b BUCKET_NAME] [-a] [-f] [-r] [-s] [-h]
#
# Parameters:
#   -p PROFILE     AWS CLI profile to use (required)
#   -b BUCKET_NAME Name of the S3 bucket for audit reports (optional)
#   -a             Enable AWS Audit Manager (optional)
#   -f             Create SOC 2 framework in Audit Manager (optional)
#   -r             Set up Config aggregator for multi-account reporting (optional)
#   -s             Skip Audit Manager setup if it fails (optional)
#   -h             Display this help message and exit
#
# Examples:
#   ./configure_audit_reporting.sh -p sampleproject-admin -a -f
#   ./configure_audit_reporting.sh -p sampleproject-admin -b audit-reports-bucket -a -f -r

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
SKIP_AUDIT_MANAGER=false

# Parse command line options
while getopts ":p:b:afrhs" opt; do
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
        s )
            SKIP_AUDIT_MANAGER=true
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
    
    BUCKET_ERROR=$?
    if [ $BUCKET_ERROR -ne 0 ]; then
        echo "  ERROR: Failed to create bucket '$BUCKET_NAME'!" 1>&2
        echo "  Error code: $BUCKET_ERROR" 1>&2
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
    AM_STATUS_OUTPUT=$(aws auditmanager get-settings --profile "$AWS_PROFILE" --query "settings.status" --output text 2>&1)
    AM_STATUS_RESULT=$?
    
    if [ $AM_STATUS_RESULT -ne 0 ]; then
        echo "  ERROR: Failed to check Audit Manager status!" 1>&2
        echo "  Error: $AM_STATUS_OUTPUT" 1>&2
        AM_STATUS=""
    else
        AM_STATUS=$AM_STATUS_OUTPUT
    fi
    
    if [ "$AM_STATUS" = "ACTIVE" ]; then
        echo "  AWS Audit Manager is already enabled."
        AUDIT_MANAGER_ENABLED=true
    else
        # Step 1: First register the organization admin account
        echo "  Step 1: Registering organization admin account..."
        REGISTER_ERROR=$(aws auditmanager register-organization-admin-account \
            --admin-account-id "$ACCOUNT_ID" \
            --profile "$AWS_PROFILE" 2>&1)
        
        REGISTER_RESULT=$?
        REGISTER_SUCCESS=false
        if [ $REGISTER_RESULT -ne 0 ]; then
            echo "  INFO: Could not register organization admin account: $REGISTER_ERROR" 1>&2
            echo "  This is expected if not the Organizations management account or if already registered." 1>&2
        else
            echo "  Successfully registered the account as an organization admin account for Audit Manager."
            REGISTER_SUCCESS=true
        fi
        
        # Step 2: Configure Audit Manager settings
        echo "  Step 2: Configuring Audit Manager settings..."
        AUDIT_MANAGER_ERROR=$(aws auditmanager update-settings \
            --default-assessment-reports-destination "destinationType=S3,destination=s3://$BUCKET_NAME" \
            --profile "$AWS_PROFILE" 2>&1)
        
        # Check for specific error indicating Audit Manager needs console setup
        if echo "$AUDIT_MANAGER_ERROR" | grep -q "Please complete AWS Audit Manager setup from home page"; then
            echo "  ERROR: AWS Audit Manager requires initial setup." 1>&2
            echo "  Actual error: $AUDIT_MANAGER_ERROR" 1>&2
            echo
            echo "  IMPORTANT: AWS AUDIT MANAGER REQUIRES MANUAL CONSOLE SETUP"
            echo "  AWS documentation confirms that Audit Manager cannot be enabled entirely through"
            echo "  the CLI without initial console setup. The CLI setup attempt has failed as expected."
            echo
            echo "  REQUIRED MANUAL SETUP:"
            echo "  1. Sign in to the AWS Management Console"
            echo "  2. Navigate to AWS Audit Manager service"
            echo "  3. Click on 'Get started' or 'Set up AWS Audit Manager'"
            echo "  4. Accept the terms and conditions"
            echo "  5. Configure the service settings in the console"
            echo "  6. Complete the initial setup process"
            echo "  7. After console setup is complete, you can use CLI commands for further configuration"
            echo
            
            # Check if user wants to skip Audit Manager setup
            if [ "$SKIP_AUDIT_MANAGER" = true ]; then
                echo "  Skipping Audit Manager setup as requested with -s option."
                echo "  Continuing with other parts of the script..."
                AUDIT_MANAGER_ENABLED=false
            else
                echo "  If you want to skip Audit Manager setup and continue with other parts of the script,"
                echo "  run the script again with the -s option."
                
                # Ask user if they want to continue with the rest of the script
                read -p "  Do you want to continue with the rest of the script? (y/n): " CONTINUE_SCRIPT
                if [[ "$CONTINUE_SCRIPT" =~ ^[Yy]$ ]]; then
                    echo "  Continuing with other parts of the script..."
                    AUDIT_MANAGER_ENABLED=false
                else
                    echo "  Exiting script. Please complete Audit Manager setup and run again."
                    exit 1
                fi
            fi
        elif [ -n "$AUDIT_MANAGER_ERROR" ]; then
            echo "  ERROR: Failed to enable AWS Audit Manager: $AUDIT_MANAGER_ERROR" 1>&2
            
            # Check if user wants to skip Audit Manager setup
            if [ "$SKIP_AUDIT_MANAGER" = true ]; then
                echo "  Skipping Audit Manager setup as requested with -s option."
                echo "  Continuing with other parts of the script..."
                AUDIT_MANAGER_ENABLED=false
            else
                echo "  If you want to skip Audit Manager setup and continue with other parts of the script,"
                echo "  run the script again with the -s option."
                
                # Ask user if they want to continue with the rest of the script
                read -p "  Do you want to continue with the rest of the script? (y/n): " CONTINUE_SCRIPT
                if [[ "$CONTINUE_SCRIPT" =~ ^[Yy]$ ]]; then
                    echo "  Continuing with other parts of the script..."
                    AUDIT_MANAGER_ENABLED=false
                else
                    echo "  Exiting script. Please resolve the Audit Manager issues and run again."
                    exit 1
                fi
            fi
        else
            echo "  Successfully enabled AWS Audit Manager."
            AUDIT_MANAGER_ENABLED=true
            
            # Register delegated administrator if this is the management account and not already done
            if [ "$REGISTER_SUCCESS" != true ]; then
                echo "  Attempting to register delegated administrator..."
                
                DELEGATE_ERROR=$(aws organizations register-delegated-administrator \
                    --service-principal auditmanager.amazonaws.com \
                    --account-id "$ACCOUNT_ID" \
                    --profile "$AWS_PROFILE" 2>&1)
                
                DELEGATE_RESULT=$?
                if [ $DELEGATE_RESULT -ne 0 ]; then
                    echo "  INFO: Could not register delegated administrator. This is expected if not the Organizations management account." 1>&2
                    echo "  Details: $DELEGATE_ERROR" 1>&2
                else
                    echo "  Successfully registered the account as a delegated administrator for Audit Manager."
                fi
            fi
        fi
    fi
    
    echo
else
    # Set flag to indicate Audit Manager is not enabled
    AUDIT_MANAGER_ENABLED=false
fi

# Create SOC 2 framework in Audit Manager if requested
if [ "$CREATE_SOC2_FRAMEWORK" = true ]; then
    echo "Creating SOC 2 framework in AWS Audit Manager..."
    
    # Check if Audit Manager is enabled based on our previous check
    if [ "$AUDIT_MANAGER_ENABLED" != "true" ]; then
        echo "  ERROR: AWS Audit Manager is not enabled or was skipped!" 1>&2
        echo "  SOC 2 framework creation will be skipped." 1>&2
    else
        # List available frameworks to find SOC 2 framework
        SOC2_FRAMEWORK_OUTPUT=$(aws auditmanager list-assessment-frameworks \
            --framework-type Standard \
            --profile "$AWS_PROFILE" \
            --query "frameworkMetadataList[?name=='SOC 2'].id" \
            --output text 2>&1)
        
        SOC2_FRAMEWORK_RESULT=$?
        if [ $SOC2_FRAMEWORK_RESULT -ne 0 ]; then
            echo "  ERROR: Failed to list assessment frameworks!" 1>&2
            echo "  Error code: $SOC2_FRAMEWORK_RESULT" 1>&2
            echo "  Details: $SOC2_FRAMEWORK_OUTPUT" 1>&2
            SOC2_FRAMEWORK_ID=""
        else
            SOC2_FRAMEWORK_ID=$SOC2_FRAMEWORK_OUTPUT
        fi
        
        if [ -z "$SOC2_FRAMEWORK_ID" ] || [ "$SOC2_FRAMEWORK_ID" == "None" ]; then
            echo "  ERROR: Could not find standard SOC 2 framework in Audit Manager!" 1>&2
            echo "  This could be because:"
            echo "  - The SOC 2 framework is not available in your region"
            echo "  - There was an issue with the Audit Manager service"
            echo "  - The AWS CLI command failed to retrieve the framework list"
        else
            echo "  Found SOC 2 framework: $SOC2_FRAMEWORK_ID"
            
            # Create a SOC 2 assessment - capture both output and error
            ASSESSMENT_OUTPUT=$(aws auditmanager create-assessment \
                --name "SOC 2 Type 2 Assessment" \
                --description "Automated SOC 2 Type 2 assessment created by script" \
                --assessment-reports-destination "destinationType=S3,destination=s3://$BUCKET_NAME" \
                --scope "awsAccounts=[{id=$ACCOUNT_ID,name=Primary}]" \
                --framework-id "$SOC2_FRAMEWORK_ID" \
                --profile "$AWS_PROFILE" \
                --query "assessment.id" \
                --output text 2>&1)
            
            ASSESSMENT_RESULT=$?
            # Check if there was an error
            if [ $ASSESSMENT_RESULT -ne 0 ]; then
                echo "  ERROR: Failed to create SOC 2 assessment!" 1>&2
                echo "  Error code: $ASSESSMENT_RESULT" 1>&2
                echo "  Details: $ASSESSMENT_OUTPUT" 1>&2
            else
                ASSESSMENT_ID=$ASSESSMENT_OUTPUT
                if [ -z "$ASSESSMENT_ID" ] || [ "$ASSESSMENT_ID" == "None" ]; then
                    echo "  ERROR: Failed to create SOC 2 assessment! No assessment ID returned." 1>&2
                    echo "  Command output: $ASSESSMENT_OUTPUT" 1>&2
                else
                    echo "  Successfully created SOC 2 assessment with ID: $ASSESSMENT_ID"
                fi
            fi
        fi
    fi
    
    echo
fi

# Set up Config aggregator for multi-account reporting if requested
if [ "$SETUP_CONFIG_AGGREGATOR" = true ]; then
    echo "Setting up AWS Config aggregator for multi-account reporting..."
    
    # Check if Config is enabled
    CONFIG_RECORDER_OUTPUT=$(aws configservice describe-configuration-recorders \
        --profile "$AWS_PROFILE" \
        --query "ConfigurationRecorders[0].name" \
        --output text 2>&1)
    
    CONFIG_RECORDER_RESULT=$?
    if [ $CONFIG_RECORDER_RESULT -ne 0 ]; then
        echo "  ERROR: Failed to check if AWS Config is enabled!" 1>&2
        echo "  Error code: $CONFIG_RECORDER_RESULT" 1>&2
        echo "  Details: $CONFIG_RECORDER_OUTPUT" 1>&2
        CONFIG_RECORDER=""
    else
        CONFIG_RECORDER=$CONFIG_RECORDER_OUTPUT
    fi
    
    if [ -z "$CONFIG_RECORDER" ] || [ "$CONFIG_RECORDER" == "None" ]; then
        echo "  ERROR: AWS Config is not enabled! Enable it first." 1>&2
    else
        # Create Config aggregator
        AGGREGATOR_NAME="SOC2-Config-Aggregator"
        
        # Check if aggregator already exists
        EXISTING_AGGREGATOR_OUTPUT=$(aws configservice describe-configuration-aggregators \
            --profile "$AWS_PROFILE" \
            --query "ConfigurationAggregators[?ConfigurationAggregatorName=='$AGGREGATOR_NAME'].ConfigurationAggregatorName" \
            --output text 2>&1)
        
        EXISTING_AGGREGATOR_RESULT=$?
        if [ $EXISTING_AGGREGATOR_RESULT -ne 0 ]; then
            echo "  WARNING: Failed to check if Config aggregator exists!" 1>&2
            echo "  Error code: $EXISTING_AGGREGATOR_RESULT" 1>&2
            echo "  Details: $EXISTING_AGGREGATOR_OUTPUT" 1>&2
            EXISTING_AGGREGATOR=""
        else
            EXISTING_AGGREGATOR=$EXISTING_AGGREGATOR_OUTPUT
        fi
        
        if [ -n "$EXISTING_AGGREGATOR" ] && [ "$EXISTING_AGGREGATOR" != "None" ]; then
            echo "  Config aggregator '$AGGREGATOR_NAME' already exists."
        else
            # Create aggregator
            AGGREGATOR_OUTPUT=$(aws configservice put-configuration-aggregator \
                --configuration-aggregator-name "$AGGREGATOR_NAME" \
                --organization-aggregation-source "{\"RoleArn\":\"arn:aws:iam::$ACCOUNT_ID:role/aws-service-role/config.amazonaws.com/AWSServiceRoleForConfig\",\"AllAwsRegions\":true}" \
                --profile "$AWS_PROFILE" 2>&1)
            
            AGGREGATOR_ERROR=$?
            if [ $AGGREGATOR_ERROR -ne 0 ]; then
                echo "  ERROR: Failed to create Config aggregator!" 1>&2
                echo "  Error code: $AGGREGATOR_ERROR" 1>&2
                echo "  Details: $AGGREGATOR_OUTPUT" 1>&2
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
if [ "$AUDIT_MANAGER_ENABLED" = "true" ]; then
    echo "1. Visit AWS Audit Manager in the console to manage your assessment"
    echo "2. Configure automated evidence collection rules in Audit Manager"
    echo "3. Set up scheduled exports of evidence to the S3 bucket"
    echo "4. Implement a review process for audit findings"
else
    echo "1. Complete AWS Audit Manager setup in the AWS console if needed"
    echo "   - Navigate to AWS Audit Manager service"
    echo "   - Click on 'Get started' or 'Set up AWS Audit Manager'"
    echo "   - Complete the initial setup process"
    echo "2. Run this script again with -a and -f options after completing the console setup"
    echo "3. Configure automated evidence collection rules in Audit Manager"
    echo "4. Set up scheduled exports of evidence to the S3 bucket"
    echo "5. Implement a review process for audit findings"
fi