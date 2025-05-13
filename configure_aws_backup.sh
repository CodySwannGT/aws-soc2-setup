#!/bin/bash
# configure_aws_backup.sh - Configure AWS Backup for SOC 2 compliance
#
# Description:
#   This script configures AWS Backup for SOC 2 compliance, setting up
#   backup plans, vault settings, and appropriate IAM roles.
#
# Usage:
#   ./configure_aws_backup.sh -p PROFILE -c CENTRAL_ACCOUNT -a ADMIN_ACCOUNT [-v VAULT_NAME] [-k KMS_KEY] [-h]
#
# Parameters:
#   -p PROFILE         AWS CLI profile with permissions to configure AWS Backup (required)
#   -c CENTRAL_ACCOUNT The account ID for the central backup account (required)
#   -a ADMIN_ACCOUNT   The account ID for the backup administrator account (required)
#   -v VAULT_NAME      The name for the backup vault (optional, default: "soc2-backup-vault")
#   -k KMS_KEY         KMS key ARN for encrypting backups (optional)
#   -h                 Display this help message and exit
#
# Examples:
#   ./configure_aws_backup.sh -p sampleproject-admin -c 111122223333 -a 444455556666
#   ./configure_aws_backup.sh -p sampleproject-admin -c 111122223333 -a 444455556666 -v "SOC2-Vault" -k "arn:aws:kms:us-east-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab"

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
AWS_PROFILE=""
CENTRAL_ACCOUNT=""
ADMIN_ACCOUNT=""
VAULT_NAME="soc2-backup-vault"
KMS_KEY=""

# Parse command line options
while getopts ":p:c:a:v:k:h" opt; do
    case ${opt} in
        p )
            AWS_PROFILE=$OPTARG
            ;;
        c )
            CENTRAL_ACCOUNT=$OPTARG
            ;;
        a )
            ADMIN_ACCOUNT=$OPTARG
            ;;
        v )
            VAULT_NAME=$OPTARG
            ;;
        k )
            KMS_KEY=$OPTARG
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
if [ -z "$AWS_PROFILE" ] || [ -z "$CENTRAL_ACCOUNT" ] || [ -z "$ADMIN_ACCOUNT" ]; then
    echo "ERROR: Missing required parameters!" 1>&2
    echo "Required parameters: -p PROFILE -c CENTRAL_ACCOUNT -a ADMIN_ACCOUNT" 1>&2
    display_help
fi

# Validate AWS profile
if ! aws configure list --profile "$AWS_PROFILE" &>/dev/null; then
    echo "ERROR: AWS profile '$AWS_PROFILE' not found!" 1>&2
    exit 1
fi

# Validate account IDs
if ! [[ "$CENTRAL_ACCOUNT" =~ ^[0-9]{12}$ ]]; then
    echo "ERROR: Invalid central account ID. Must be a 12-digit number." 1>&2
    exit 1
fi

if ! [[ "$ADMIN_ACCOUNT" =~ ^[0-9]{12}$ ]]; then
    echo "ERROR: Invalid admin account ID. Must be a 12-digit number." 1>&2
    exit 1
fi

# Get the account's region
REGION=$(aws configure get region --profile "$AWS_PROFILE")
if [ -z "$REGION" ]; then
    echo "ERROR: Could not determine the AWS region for profile '$AWS_PROFILE'!" 1>&2
    exit 1
fi

# Create KMS key if not provided
if [ -z "$KMS_KEY" ]; then
    echo "No KMS key provided. Creating a new KMS key for backups..."
    
    # Create a suitable key policy
    TEMP_KEY_POLICY=$(mktemp)
    
    # Get current account ID
    ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query "Account" --output text)
    
    cat > "$TEMP_KEY_POLICY" << EOF
{
    "Version": "2012-10-17",
    "Id": "backup-key-policy",
    "Statement": [
        {
            "Sid": "Enable IAM User Permissions",
            "Effect": "Allow",
            "Principal": {
                "AWS": "arn:aws:iam::${ACCOUNT_ID}:root"
            },
            "Action": "kms:*",
            "Resource": "*"
        },
        {
            "Sid": "Allow use of the key for AWS Backup",
            "Effect": "Allow",
            "Principal": {
                "Service": "backup.amazonaws.com"
            },
            "Action": [
                "kms:Encrypt",
                "kms:Decrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
                "kms:DescribeKey"
            ],
            "Resource": "*"
        },
        {
            "Sid": "Allow access to central backup account",
            "Effect": "Allow",
            "Principal": {
                "AWS": "arn:aws:iam::${CENTRAL_ACCOUNT}:root"
            },
            "Action": [
                "kms:Encrypt",
                "kms:Decrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
                "kms:DescribeKey"
            ],
            "Resource": "*"
        }
    ]
}
EOF

    # Create the key
    KMS_KEY=$(aws kms create-key \
        --description "AWS Backup encryption key for SOC 2 compliance" \
        --policy file://"$TEMP_KEY_POLICY" \
        --multi-region \
        --profile "$AWS_PROFILE" \
        --query "KeyMetadata.Arn" \
        --output text)
    
    # Clean up
    rm -f "$TEMP_KEY_POLICY"
    
    if [ -z "$KMS_KEY" ] || [ "$KMS_KEY" == "None" ]; then
        echo "ERROR: Failed to create KMS key!" 1>&2
        exit 1
    fi
    
    # Create an alias for the key
    KMS_KEY_ID=$(echo "$KMS_KEY" | sed 's/.*key\///')
    
    # Check if the alias already exists
    EXISTING_ALIAS=$(aws kms list-aliases \
        --query "Aliases[?AliasName=='alias/aws-backup-soc2'].AliasName" \
        --profile "$AWS_PROFILE" \
        --output text)
    
    if [ -z "$EXISTING_ALIAS" ] || [ "$EXISTING_ALIAS" == "None" ]; then
        # Alias doesn't exist, create it
        if aws kms create-alias \
            --alias-name "alias/aws-backup-soc2" \
            --target-key-id "$KMS_KEY_ID" \
            --profile "$AWS_PROFILE" 2>/dev/null; then
            echo "Created new alias 'alias/aws-backup-soc2' for KMS key"
        else
            echo "  WARNING: Failed to create KMS alias. It might already exist." 1>&2
        fi
    else
        echo "Using existing KMS alias: $EXISTING_ALIAS"
    fi
    
    echo "Using KMS key: $KMS_KEY"
    echo
fi

# Main execution
echo "Configuring AWS Backup for SOC 2 compliance..."
echo "  - AWS Profile: $AWS_PROFILE"
echo "  - Central Backup Account: $CENTRAL_ACCOUNT"
echo "  - Backup Administrator Account: $ADMIN_ACCOUNT"
echo "  - Backup Vault Name: $VAULT_NAME"
echo "  - KMS Key: $KMS_KEY"
echo

# Step 1: Create a backup vault
echo "Creating backup vault..."

VAULT_ARN=$(aws backup create-backup-vault \
    --backup-vault-name "$VAULT_NAME" \
    --encryption-key-arn "$KMS_KEY" \
    --profile "$AWS_PROFILE" \
    --query "BackupVaultArn" \
    --output text)

if [ -z "$VAULT_ARN" ] || [ "$VAULT_ARN" == "None" ]; then
    echo "  WARNING: Failed to create backup vault. It might already exist." 1>&2
    
    # Check if vault exists
    VAULT_ARN=$(aws backup list-backup-vaults \
        --profile "$AWS_PROFILE" \
        --query "BackupVaultList[?BackupVaultName=='$VAULT_NAME'].BackupVaultArn" \
        --output text)
    
    if [ -z "$VAULT_ARN" ] || [ "$VAULT_ARN" == "None" ]; then
        echo "  ERROR: Could not find or create backup vault '$VAULT_NAME'!" 1>&2
        exit 1
    else
        echo "  Using existing backup vault: $VAULT_ARN"
    fi
else
    echo "  Successfully created backup vault: $VAULT_ARN"
fi

# Step 2: Create a backup plan
echo "Creating SOC 2 backup plan..."

# Create a temp file for the backup plan
TEMP_BACKUP_PLAN=$(mktemp)

cat > "$TEMP_BACKUP_PLAN" << EOF
{
  "BackupPlan": {
    "BackupPlanName": "SOC2-Backup-Plan",
    "Rules": [
      {
        "RuleName": "DailyBackups",
        "TargetBackupVaultName": "$VAULT_NAME",
        "ScheduleExpression": "cron(0 5 ? * * *)",
        "StartWindowMinutes": 60,
        "CompletionWindowMinutes": 180,
        "Lifecycle": {
          "MoveToColdStorageAfterDays": 30,
          "DeleteAfterDays": 365
        },
        "RecoveryPointTags": {
          "Compliance": "SOC2"
        }
      },
      {
        "RuleName": "WeeklyBackups",
        "TargetBackupVaultName": "$VAULT_NAME",
        "ScheduleExpression": "cron(0 5 ? * 1 *)",
        "StartWindowMinutes": 60,
        "CompletionWindowMinutes": 360,
        "Lifecycle": {
          "MoveToColdStorageAfterDays": 90,
          "DeleteAfterDays": 730
        },
        "RecoveryPointTags": {
          "Compliance": "SOC2"
        }
      }
    ]
  }
}
EOF

# Check for existing backup plans using a more robust approach
echo "Checking for existing backup plan..."

# Get all backup plans
BACKUP_PLANS_JSON=$(aws backup list-backup-plans \
    --profile "$AWS_PROFILE" \
    --output json)

# Initialize backup plan ID as empty
BACKUP_PLAN_ID=""

# First try to find by name (case insensitive)
BACKUP_PLAN_ID=$(echo "$BACKUP_PLANS_JSON" | \
    jq -r '.BackupPlansList[] | select(.BackupPlan.BackupPlanName != null and (.BackupPlan.BackupPlanName | ascii_downcase) == "soc2-backup-plan") | .BackupPlanId' | head -1)

if [ -z "$BACKUP_PLAN_ID" ] || [ "$BACKUP_PLAN_ID" == "None" ]; then
    echo "  No backup plan found by name. Trying to create a new one..."
    
    # Try to create the backup plan
    # If it fails with AlreadyExistsException, extract the existing plan ID from the error message
    CREATE_OUTPUT=$(aws backup create-backup-plan \
        --cli-input-json file://"$TEMP_BACKUP_PLAN" \
        --profile "$AWS_PROFILE" 2>&1)
    
    # Check if the command was successful
    if echo "$CREATE_OUTPUT" | grep -q "BackupPlanId"; then
        # Successfully created a new plan
        BACKUP_PLAN_ID=$(echo "$CREATE_OUTPUT" | jq -r '.BackupPlanId')
        echo "  Successfully created backup plan with ID: $BACKUP_PLAN_ID"
    elif echo "$CREATE_OUTPUT" | grep -q "AlreadyExistsException"; then
        echo "  A backup plan with the same content already exists."
        
        # Get all backup plans again to find the one with similar rules
        BACKUP_PLANS_DETAILED=$(aws backup list-backup-plans \
            --profile "$AWS_PROFILE" \
            --output json)
        
        # Loop through each plan ID to find one with matching rules
        for PLAN_ID in $(echo "$BACKUP_PLANS_DETAILED" | jq -r '.BackupPlansList[].BackupPlanId'); do
            # Get the details of this plan
            PLAN_DETAILS=$(aws backup get-backup-plan \
                --backup-plan-id "$PLAN_ID" \
                --profile "$AWS_PROFILE" \
                --output json)
            
            # Check if this plan has similar rules (daily and weekly backups to the same vault)
            if echo "$PLAN_DETAILS" | jq -r '.BackupPlan.Rules | if . != null and length > 0 then .[].TargetBackupVaultName else empty end' | grep -q "$VAULT_NAME"; then
                BACKUP_PLAN_ID="$PLAN_ID"
                PLAN_NAME=$(echo "$PLAN_DETAILS" | jq -r '.BackupPlan.BackupPlanName')
                echo "  Found existing backup plan: $PLAN_NAME (ID: $BACKUP_PLAN_ID)"
                break
            fi
        done
        
        # If we still couldn't find a matching plan, exit with error
        if [ -z "$BACKUP_PLAN_ID" ] || [ "$BACKUP_PLAN_ID" == "None" ]; then
            echo "  ERROR: Could not identify the existing backup plan!" 1>&2
            exit 1
        fi
    else
        # Some other error occurred
        echo "  ERROR: Failed to create backup plan!" 1>&2
        echo "$CREATE_OUTPUT" 1>&2
        exit 1
    fi
else
    echo "  Using existing backup plan with ID: $BACKUP_PLAN_ID"
fi

# Clean up
rm -f "$TEMP_BACKUP_PLAN"

# Step 3: Create a resource selection for the backup plan
echo "Creating resource selection for backup plan..."

# Create a temp file for the resource selection
TEMP_SELECTION=$(mktemp)

cat > "$TEMP_SELECTION" << EOF
{
  "BackupSelection": {
    "SelectionName": "SOC2-Resources",
    "IamRoleArn": "arn:aws:iam::$ACCOUNT_ID:role/service-role/AWSBackupDefaultServiceRole",
    "Resources": ["*"],
    "ListOfTags": [
      {
        "ConditionType": "STRINGEQUALS",
        "ConditionKey": "Backup",
        "ConditionValue": "true"
      }
    ]
  }
}
EOF

SELECTION_ID=$(aws backup create-backup-selection \
    --backup-plan-id "$BACKUP_PLAN_ID" \
    --cli-input-json file://"$TEMP_SELECTION" \
    --profile "$AWS_PROFILE" \
    --query "SelectionId" \
    --output text)

# Clean up
rm -f "$TEMP_SELECTION"

if [ -z "$SELECTION_ID" ] || [ "$SELECTION_ID" == "None" ]; then
    echo "  ERROR: Failed to create resource selection!" 1>&2
    echo "  Make sure the AWSBackupDefaultServiceRole exists." 1>&2
    exit 1
fi

echo "  Successfully created resource selection with ID: $SELECTION_ID"

# Step 4: Configure cross-account backup settings
echo "Configuring cross-account backup settings..."

# Check if this is the management account
echo "  Registering the central backup account..."

aws organizations register-delegated-administrator \
    --service-principal backup.amazonaws.com \
    --account-id "$CENTRAL_ACCOUNT" \
    --profile "$AWS_PROFILE" > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "  WARNING: Failed to register delegated administrator. This is expected if not running from the Organizations management account." 1>&2
    echo "  Please run the following command from the Organizations management account:"
    echo "  aws organizations register-delegated-administrator --service-principal backup.amazonaws.com --account-id $CENTRAL_ACCOUNT"
else
    echo "  Successfully registered the central backup account as a delegated administrator."
fi

echo "AWS Backup configuration completed."
echo
echo "Next steps:"
echo "1. Tag important resources with Backup=true to include them in the backup plan"
echo "2. Configure cross-account backup in the AWS Backup console"
echo "3. Set up backup notifications in the central backup account"
echo "4. Test the backup and recovery processes"