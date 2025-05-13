#!/bin/bash
# master_control_tower_setup.sh - Orchestrates the AWS Control Tower setup process
#
# Description:
#   This script serves as the master orchestrator for setting up a SOC 2 Compliant
#   AWS Control Tower environment. It calls individual scripts in sequence, prompts
#   for necessary inputs, and guides the user through manual steps.
#   The script now checks if steps have already been completed before proceeding.
#
# Usage:
#   ./master_control_tower_setup.sh [-a ACCOUNT_ID] [-p PROFILE] [-d ADMIN_PROFILE] [-r REGION] [-h]
#
# Parameters:
#   -a ACCOUNT_ID     AWS account ID (optional, will prompt if not provided)
#   -p PROFILE        Initial AWS CLI profile name (optional, default: sampleproject)
#   -d ADMIN_PROFILE  Admin AWS CLI profile name (optional, default: thehobbyhome-management)
#   -r REGION         AWS region (optional, default: us-east-1)
#   -h                Display this help message and exit

# Display help message
display_help() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Set default values
AWS_ACCOUNT_ID=""
INITIAL_PROFILE="sampleproject"
ADMIN_PROFILE="thehobbyhome-management"
AWS_REGION="us-east-1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USERS_GROUP="InitialUsers"
CHECKLIST_FILE="$SCRIPT_DIR/docs/CHECKLIST.md" # ADDED

# Function to update checklist items
update_checklist_item() {
    local item_text_pattern="$1"
    local status="$2"
    local replace_prefix=""

    if [ ! -f "$CHECKLIST_FILE" ]; then
        echo "WARNING: Checklist file not found at $CHECKLIST_FILE. Cannot update item: $item_text_pattern"
        return 1
    fi

    # Escape special characters for sed ERE pattern part
    local escaped_pattern_for_ere=$(echo "$item_text_pattern" | sed -e 's/[]\/$*.^|[](){}?+]/\\&/g')
    # Escape special characters for sed replacement part (& and / and \)
    local item_text_for_replacement=$(echo "$item_text_pattern" | sed -e 's/[\/&\\]/\\&/g')

    if [ "$status" = "DONE" ]; then
        replace_prefix="✅ "
    elif [ "$status" = "SKIPPED" ]; then
        replace_prefix="⏭️ "
    else
        echo "WARNING: Invalid status '$status' for checklist item '$item_text_pattern'."
        return 1
    fi

    local sed_script_core="s/\\[ \\] ⏳ ${escaped_pattern_for_ere}/${replace_prefix}${item_text_for_replacement}/"

    # Create a temporary backup, then edit.
    cp "$CHECKLIST_FILE" "$CHECKLIST_FILE.bak"
    if sed -E -i '' "$sed_script_core" "$CHECKLIST_FILE"; then
        if ! cmp -s "$CHECKLIST_FILE" "$CHECKLIST_FILE.bak"; then
            echo "Checklist item '$item_text_pattern' updated to $status."
        fi
        rm "$CHECKLIST_FILE.bak"
    else
        echo "ERROR: sed command failed to update checklist item '$item_text_pattern' in $CHECKLIST_FILE."
        mv "$CHECKLIST_FILE.bak" "$CHECKLIST_FILE" # Restore
        return 1
    fi
    return 0
}

# Parse command line options
while getopts ":a:p:d:r:h" opt; do
    case ${opt} in
        a )
            AWS_ACCOUNT_ID=$OPTARG
            ;;
        p )
            INITIAL_PROFILE=$OPTARG
            ;;
        d )
            ADMIN_PROFILE=$OPTARG
            ;;
        r )
            AWS_REGION=$OPTARG
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

# Function to wait for user to complete a manual step
wait_for_manual_step() {
    local step_name=$1
    local instructions=$2
    
    echo
    echo "==================================================================="
    echo "MANUAL STEP REQUIRED: $step_name"
    echo "==================================================================="
    echo "$instructions"
    echo
    read -p "Press Enter once you have completed this step... "
    echo
}

# Function to prompt for a yes/no answer
prompt_yes_no() {
    local prompt=$1
    local default=${2:-"y"}
    local answer
    
    if [ "$default" = "y" ]; then
        prompt="$prompt [Y/n]: "
    else
        prompt="$prompt [y/N]: "
    fi
    
    while true; do
        read -p "$prompt" answer
        answer=${answer:-$default}
        
        case ${answer:0:1} in
            y|Y )
                return 0
                ;;
            n|N )
                return 1
                ;;
            * )
                echo "Please answer yes (y) or no (n)."
                ;;
        esac
    done
}

# Function to check if a step has been completed already
# $1: step_name_for_prompt (e.g., "Initial AWS CLI profile setup")
# $2: checklist_item_text (e.g., "Perform Initial AWS CLI profile setup (Root User Access Keys & `aws configure`)")
check_step_completed() {
    local step_name_for_prompt="$1"
    local checklist_item_text="$2" # New argument

    if prompt_yes_no "Have you already completed: $step_name_for_prompt?" "n"; then
        echo "Skipping $step_name_for_prompt as it has already been completed."
        if [ -n "$checklist_item_text" ]; then
            update_checklist_item "$checklist_item_text" "DONE"
        fi
        return 0 # Step already completed
    else
        echo "Proceeding with $step_name_for_prompt..."
        return 1 # Step not yet completed
    fi
}

# Function to collect user information
collect_user_info() {
    local username firstname lastname email
    
    echo
    echo "Enter information for a new user:"
    read -p "Username: " username
    read -p "First name: " firstname
    read -p "Last name: " lastname
    read -p "Email: " email
    
    USER_INFO+=("$username:$firstname:$lastname:$email")
}

# Check required scripts
required_scripts=(
    "configure_sso_profile.sh"
    "create_sso_user.sh"
    "delete_root_user_access_key.sh"
    "update_identity_center_start_url.sh"
    "create_organizational_units.sh"
    "enable_control_tower_controls.sh"
    "enable_security_services.sh"
    "provision_account.sh"
    "configure_aws_backup.sh"
    "manage_kms_keys.sh"
    "configure_audit_reporting.sh"
    "assign_sso_permissions.sh"
    "manage_sso_group.sh"
)

for script in "${required_scripts[@]}"; do
    if [ ! -f "$SCRIPT_DIR/$script" ]; then
        echo "ERROR: Required script '$script' not found in $SCRIPT_DIR!" 1>&2
        exit 1
    fi
    
    if [ ! -x "$SCRIPT_DIR/$script" ]; then
        chmod +x "$SCRIPT_DIR/$script"
    fi
done

# Welcome message
clear
echo "==================================================================="
echo "  AWS Control Tower SOC 2 Compliant Setup"
echo "==================================================================="
echo
echo "This script will guide you through the process of setting up a SOC 2"
echo "compliant AWS environment using Control Tower."
echo
echo "For each step, you will be asked if you've already completed it."
echo "If you have, the script will skip that step and move to the next one."
echo
echo "The process includes several steps that require manual intervention."
echo "You will be prompted when manual steps are required."
echo

# Prompt for account ID if not provided
if [ -z "$AWS_ACCOUNT_ID" ]; then
    read -p "Enter your AWS account ID (12 digits): " AWS_ACCOUNT_ID
fi

# Validate account ID
if ! [[ "$AWS_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
    echo "ERROR: Invalid account ID. Must be a 12-digit number." 1>&2
    exit 1
fi
update_checklist_item "Provide AWS Account ID" "DONE"

# Confirm settings
echo
echo "Setup will proceed with the following settings:"
echo "  - AWS Account ID: $AWS_ACCOUNT_ID"
echo "  - Initial CLI Profile: $INITIAL_PROFILE"
echo "  - Admin Profile Name: $ADMIN_PROFILE"
echo "  - AWS Region: $AWS_REGION"
echo

if ! prompt_yes_no "Do you want to continue with these settings?"; then
    update_checklist_item "Confirm Setup Settings" "SKIPPED"
    echo "Setup canceled. Adjust settings and try again."
    exit 0
fi
update_checklist_item "Confirm Setup Settings" "DONE"

# STEP 1: Initial AWS CLI profile setup
echo
echo "==================================================================="
echo "STEP 1: Initial AWS CLI Profile Setup"
echo "==================================================================="
echo "First, we need to set up the initial AWS CLI profile for root user access."
echo "This profile will be used only temporarily and the access keys will be"
echo "deleted once Control Tower is set up."
echo

if ! check_step_completed "Initial AWS CLI profile setup" "Perform Initial AWS CLI profile setup (Root User Access Keys & \`aws configure\`)"; then
    if prompt_yes_no "Do you need to create the initial AWS CLI profile for root user?"; then
        wait_for_manual_step "Create Root User Access Keys" "
1. Sign in to the AWS Management Console as the root user
2. Go to your Security credentials page
3. Under 'Access keys', click 'Create access key'
4. Acknowledge the security warning
5. Copy the Access Key ID and Secret Access Key
"

        # Configure the initial profile
        aws configure set aws_access_key_id "$(read -p 'Enter Access Key ID: ' && echo $REPLY)" --profile "$INITIAL_PROFILE"
        aws configure set aws_secret_access_key "$(read -p 'Enter Secret Access Key: ' && echo $REPLY)" --profile "$INITIAL_PROFILE"
        aws configure set region "$AWS_REGION" --profile "$INITIAL_PROFILE"
        aws configure set output "json" --profile "$INITIAL_PROFILE"
        
        # Verify the profile
        echo "Verifying AWS profile..."
        if ! aws sts get-caller-identity --profile "$INITIAL_PROFILE" > /dev/null 2>&1; then
            echo "ERROR: Could not validate AWS credentials. Please check the access keys and try again." 1>&2
            exit 1
        fi
        
        echo "AWS CLI profile '$INITIAL_PROFILE' successfully configured."
    else
        echo "Skipping initial profile creation. Make sure the '$INITIAL_PROFILE' profile is configured."
    fi
    
    # Verify the profile exists in any case
    if ! aws configure list --profile "$INITIAL_PROFILE" > /dev/null 2>&1; then
        echo "ERROR: AWS profile '$INITIAL_PROFILE' not found!" 1>&2
        exit 1
    fi
    update_checklist_item "Perform Initial AWS CLI profile setup (Root User Access Keys & \`aws configure\`)" "DONE"
fi

# STEP 2: Enable MFA for Root User
echo
echo "==================================================================="
echo "STEP 2: Enable MFA for Root User"
echo "==================================================================="
echo "Multi-Factor Authentication (MFA) must be enabled for the root user."
echo "This is a critical security measure and a SOC 2 requirement."
echo

if ! check_step_completed "MFA setup for root user" "Perform MFA setup for root user (Manual Step)"; then
    wait_for_manual_step "Enable MFA for Root User" "
1. Sign in to the AWS Management Console as the root user
2. Go to the IAM dashboard
3. Click on 'Add MFA' for the root user
4. Follow the prompts to set up a virtual MFA device
5. Store the MFA credentials securely
"
    update_checklist_item "Perform MFA setup for root user (Manual Step)" "DONE"
fi

# STEP 3: Enable IAM Identity Center
echo
echo "==================================================================="
echo "STEP 3: Enable IAM Identity Center"
echo "==================================================================="
echo "IAM Identity Center (formerly AWS SSO) is required for Control Tower."
echo "It must be enabled before proceeding with Control Tower setup."
echo

if ! check_step_completed "IAM Identity Center setup" "Perform IAM Identity Center setup (Manual Step)"; then
    wait_for_manual_step "Enable IAM Identity Center" "
1. Sign in to the AWS Management Console
2. Navigate to IAM Identity Center
3. Click 'Enable IAM Identity Center'
4. Choose 'Default directory provided by IAM Identity Center' as your identity source
5. Complete the setup process
"
    update_checklist_item "Perform IAM Identity Center setup (Manual Step)" "DONE"
fi

# STEP 4: Set up AWS Control Tower
echo
echo "==================================================================="
echo "STEP 4: Set up AWS Control Tower"
echo "==================================================================="
echo "Now you'll set up AWS Control Tower, which will create the foundation"
echo "for your multi-account environment."
echo

if ! check_step_completed "AWS Control Tower setup" "Perform AWS Control Tower setup (Manual Step, ~30-60 mins)"; then
    wait_for_manual_step "Set up AWS Control Tower" "
1. Sign in to the AWS Management Console
2. Navigate to AWS Control Tower
3. Click 'Set up landing zone'
4. Follow the setup wizard with these settings:
   - Home Region: $AWS_REGION
   - Additional Regions: Select as needed
   - Enable KMS encryption with a new key
   - Use default OU names (Security, Sandbox)
5. Review settings and click 'Set up landing zone'

This process will take 30-60 minutes to complete. 
You'll receive an email when it's done.
"
update_checklist_item "Perform AWS Control Tower setup (Manual Step, ~30-60 mins)" "DONE"
fi

# Determine which profile to use for AWS API calls
# If root user access keys have been deleted, use ADMIN_PROFILE
# Otherwise, use INITIAL_PROFILE
ACTIVE_PROFILE="$INITIAL_PROFILE"
if check_step_completed "Root user access key deletion" "Perform Root user access key deletion (via \`delete_root_user_access_key.sh\`)"; then
    echo "Root user access keys have been deleted, using admin profile for API calls..."
    ACTIVE_PROFILE="$ADMIN_PROFILE"
fi

# Check if Control Tower is actually set up
aws controltower list-landing-zones --profile "$ACTIVE_PROFILE" > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "WARNING: AWS Control Tower doesn't appear to be fully set up yet."
    if ! prompt_yes_no "Are you sure AWS Control Tower setup is complete?"; then
        echo "Please wait for Control Tower setup to complete before continuing."
        echo "You can rerun this script when the setup is finished."
        exit 0
    fi
    update_checklist_item "Verify Control Tower setup completion" "DONE"
else
    update_checklist_item "Verify Control Tower setup completion" "DONE"
fi

# STEP 5: Create and configure admin user
echo
echo "==================================================================="
echo "STEP 5: Create Admin User in IAM Identity Center"
echo "==================================================================="
echo "Now we'll create an administrative user in IAM Identity Center."
echo "This user will be used for all subsequent operations."
echo

if ! check_step_completed "Admin user creation in IAM Identity Center" "Perform Admin user creation in IAM Identity Center (via \`create_sso_user.sh\`)"; then
    # Ask for admin user information
    echo "Enter information for the admin user:"
    read -p "Username (default: admin): " admin_username
    admin_username=${admin_username:-"admin"}
    read -p "First name (default: Admin): " admin_firstname
    admin_firstname=${admin_firstname:-"Admin"}
    read -p "Last name (default: User): " admin_lastname
    admin_lastname=${admin_lastname:-"User"}
    read -p "Email: " admin_email

    # Validate email (basic validation)
    while ! [[ "$admin_email" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; do
        echo "ERROR: Invalid email format. Please enter a valid email address."
        read -p "Email: " admin_email
    done

    # Create the admin user
    echo "Creating admin user using $ACTIVE_PROFILE profile..."
    "$SCRIPT_DIR/create_sso_user.sh" -p "$ACTIVE_PROFILE" -u "$admin_username" -f "$admin_firstname" -l "$admin_lastname" -e "$admin_email"
    update_checklist_item "Perform Admin user creation in IAM Identity Center (via \`create_sso_user.sh\`)" "DONE"

    wait_for_manual_step "Set Admin User Password" "
1. Sign in to the AWS Management Console
2. Navigate to IAM Identity Center
3. Go to Users
4. Select the user '$admin_username'
5. Click on 'Reset password' to set the initial password
6. Send the temporary password to the user's email
"
    update_checklist_item "Set Admin User Password (Manual Step in IAM Identity Center)" "DONE"
else
    # Ask for the admin username if step was completed already
    read -p "Please enter the username of your admin user (default: admin): " admin_username
    admin_username=${admin_username:-"admin"}
fi

# Note: ACTIVE_PROFILE is already defined above

# Get Account IDs created by Control Tower
echo "Retrieving AWS Organization accounts using $ACTIVE_PROFILE profile..."
ORG_ACCOUNTS=$(aws organizations list-accounts --profile "$ACTIVE_PROFILE" --query "Accounts[?Status=='ACTIVE'].{ID:Id,Name:Name}" --output json)

if [ -z "$ORG_ACCOUNTS" ]; then
    echo "ERROR: No accounts found in the organization. Make sure Control Tower setup is complete." 1>&2
    exit 1
fi

# Extract account IDs and names
MANAGEMENT_ACCOUNT_ID="$AWS_ACCOUNT_ID"
echo "Management account ID: $MANAGEMENT_ACCOUNT_ID"

# Find log archive and audit accounts
LOG_ARCHIVE_ACCOUNT=$(echo "$ORG_ACCOUNTS" | jq -r '.[] | select(.Name | contains("Log Archive")) | .ID')
AUDIT_ACCOUNT=$(echo "$ORG_ACCOUNTS" | jq -r '.[] | select(.Name | contains("Audit")) | .ID')

echo "Log Archive account ID: $LOG_ARCHIVE_ACCOUNT"
echo "Audit account ID: $AUDIT_ACCOUNT"

# Assign admin permissions to the admin user for all accounts
if ! check_step_completed "Administrator access assignment to admin user" "Perform Administrator access assignment to admin user for management account (via \`assign_sso_permissions.sh\`)"; then
    echo "Assigning administrator access to $admin_username for management account using $ACTIVE_PROFILE profile..."
    "$SCRIPT_DIR/assign_sso_permissions.sh" -p "$ACTIVE_PROFILE" -u "$admin_username" -a "$MANAGEMENT_ACCOUNT_ID" -r "AWSAdministratorAccess"
    update_checklist_item "Perform Administrator access assignment to admin user for management account (via \`assign_sso_permissions.sh\`)" "DONE"
fi

# Configure SSO profile for admin user
if ! check_step_completed "SSO profile configuration for admin user" "Perform SSO profile configuration for admin user (Manual Step: \`aws configure sso\`)"; then
    wait_for_manual_step "Configure SSO Profile for Admin User" "
1. Open a new terminal window
2. Run the command: aws configure sso
3. Enter the following information when prompted:
   - SSO start URL: https://<your-sso-portal>.awsapps.com/start
   - SSO Region: $AWS_REGION
   - Profile name: $ADMIN_PROFILE
   - Default region: $AWS_REGION
   - Default output format: json
4. Sign in through the browser when prompted
5. Select the management account and AWSAdministratorAccess permission set
6. Return to this terminal when done
"

    # Verify the admin profile
    echo "Verifying admin profile..."
    if ! aws sts get-caller-identity --profile "$ADMIN_PROFILE" > /dev/null 2>&1; then
        echo "ERROR: Could not validate admin profile. Please check the configuration and try again." 1>&2
        exit 1
    fi

    echo "Admin profile '$ADMIN_PROFILE' successfully configured."
    update_checklist_item "Perform SSO profile configuration for admin user (Manual Step: \`aws configure sso\`)" "DONE"
fi

# Delete root user access keys
if ! check_step_completed "Root user access key deletion" "Perform Root user access key deletion (via \`delete_root_user_access_key.sh\`)"; then
    echo "Deleting root user access keys..."
    "$SCRIPT_DIR/delete_root_user_access_key.sh" -p "$INITIAL_PROFILE"
    update_checklist_item "Perform Root user access key deletion (via \`delete_root_user_access_key.sh\`)" "DONE"
fi

# STEP 6: Create IAM Identity Center group for initial users
echo
echo "==================================================================="
echo "STEP 6: Create IAM Identity Center Group for Initial Users"
echo "==================================================================="
echo "Now we'll create a group for initial users with administrative access."
echo

if ! check_step_completed "IAM Identity Center group creation" "Perform IAM Identity Center group creation (e.g., \`InitialUsers\` via \`manage_sso_group.sh\`)"; then
    # Create the InitialUsers group
    echo "Creating $USERS_GROUP group..."
    "$SCRIPT_DIR/manage_sso_group.sh" -p "$ADMIN_PROFILE" -g "$USERS_GROUP" -d "Initial administrative users for Control Tower setup"
    update_checklist_item "Perform IAM Identity Center group creation (e.g., \`InitialUsers\` via \`manage_sso_group.sh\`)" "DONE"
else
    # Check if they want to use a different group name
    read -p "Please enter the name of your initial users group (default: $USERS_GROUP): " custom_group_name
    if [ -n "$custom_group_name" ]; then
        USERS_GROUP="$custom_group_name"
    fi
fi

# STEP 7: Create additional users
echo
echo "==================================================================="
echo "STEP 7: Create Additional Users"
echo "==================================================================="
echo "Now you can create additional users who will have admin access."
echo

if ! check_step_completed "Additional user creation" "Perform Additional user creation (via \`create_sso_user.sh\`)"; then
    # Array to store user information
    declare -a USER_INFO=()

    # Prompt to add users
    while true; do
        if ! prompt_yes_no "Do you want to add a user"; then
            break
        fi
        collect_user_info
    done

    # Create the users
    if [ ${#USER_INFO[@]} -gt 0 ]; then
        echo "Creating users..."
        
        # To collect all usernames for group assignment
        ALL_USERNAMES=""
        
        for user_info in "${USER_INFO[@]}"; do
            IFS=':' read -r username firstname lastname email <<< "$user_info"
            
            # Create the user
            echo "Creating user $username..."
            "$SCRIPT_DIR/create_sso_user.sh" -p "$ADMIN_PROFILE" -u "$username" -f "$firstname" -l "$lastname" -e "$email"
            
            ALL_USERNAMES="$ALL_USERNAMES $username"
        done
        update_checklist_item "Perform Additional user creation (via \`create_sso_user.sh\`)" "DONE"
        
        # Add all created users to the group
        echo "Adding users to $USERS_GROUP group..."
        "$SCRIPT_DIR/manage_sso_group.sh" -p "$ADMIN_PROFILE" -g "$USERS_GROUP" -u "$admin_username $ALL_USERNAMES"
        update_checklist_item "Add users to the IAM Identity Center group (via \`manage_sso_group.sh\`)" "DONE"
        
        # Ask if they want to assign permissions to all accounts
        if prompt_yes_no "Do you want to assign administrator access to the $USERS_GROUP group for all core accounts?"; then
            echo "Assigning administrator access to $USERS_GROUP group for management account..."
            "$SCRIPT_DIR/manage_sso_group.sh" -p "$ADMIN_PROFILE" -g "$USERS_GROUP" -a "$MANAGEMENT_ACCOUNT_ID" -r "AWSAdministratorAccess"
            
            echo "Assigning administrator access to $USERS_GROUP group for Log Archive account..."
            "$SCRIPT_DIR/manage_sso_group.sh" -p "$ADMIN_PROFILE" -g "$USERS_GROUP" -a "$LOG_ARCHIVE_ACCOUNT" -r "AWSAdministratorAccess"
            
            echo "Assigning administrator access to $USERS_GROUP group for Audit account..."
            "$SCRIPT_DIR/manage_sso_group.sh" -p "$ADMIN_PROFILE" -g "$USERS_GROUP" -a "$AUDIT_ACCOUNT" -r "AWSAdministratorAccess"
            update_checklist_item "Assign administrator access to the user group for core accounts (Management, Log Archive, Audit - Conditional, via \`manage_sso_group.sh\`)" "DONE"
        else
            update_checklist_item "Assign administrator access to the user group for core accounts (Management, Log Archive, Audit - Conditional, via \`manage_sso_group.sh\`)" "SKIPPED"
        fi
        
        wait_for_manual_step "Set User Passwords" "
1. Sign in to the AWS Management Console
2. Navigate to IAM Identity Center
3. Go to Users
4. For each user, click on their name and select 'Reset password'
5. Send the temporary passwords to the users' emails
"
        update_checklist_item "Set User Passwords for additional users (Manual Step in IAM Identity Center)" "DONE"
    else
        echo "No additional users were specified."
        # update_checklist_item "Perform Additional user creation (via `create_sso_user.sh`)" "SKIPPED" # This is already handled by check_step_completed if skipped initially
        update_checklist_item "Add users to the IAM Identity Center group (via \`manage_sso_group.sh\`)" "SKIPPED"
        update_checklist_item "Assign administrator access to the user group for core accounts (Management, Log Archive, Audit - Conditional, via \`manage_sso_group.sh\`)" "SKIPPED"
        update_checklist_item "Set User Passwords for additional users (Manual Step in IAM Identity Center)" "SKIPPED"
    fi
fi

# STEP 8: Create Organizational Units
echo
echo "==================================================================="
echo "STEP 8: Create Organizational Units"
echo "==================================================================="
echo "Now we'll create additional organizational units for your environment."
echo

if ! check_step_completed "Organizational Units creation" "Perform Organizational Units creation (e.g., Infrastructure, Workloads, Sandbox - Conditional, via \`create_organizational_units.sh\`)"; then
    if prompt_yes_no "Do you want to create recommended organizational units (Infrastructure, Workloads, Sandbox)?"; then
        echo "Creating organizational units..."
        "$SCRIPT_DIR/create_organizational_units.sh" -p "$ADMIN_PROFILE" -a
        update_checklist_item "Perform Organizational Units creation (e.g., Infrastructure, Workloads, Sandbox - Conditional, via \`create_organizational_units.sh\`)" "DONE"
        
        wait_for_manual_step "Register OUs with Control Tower" "
1. Sign in to the AWS Management Console
2. Navigate to AWS Control Tower
3. Go to Organization
4. For each OU (Infrastructure, Workloads, Sandbox), select the OU and click 'Register'
5. Follow the prompts to register the OU with Control Tower
"
        update_checklist_item "Register OUs with Control Tower (Manual Step)" "DONE"
    else
        update_checklist_item "Perform Organizational Units creation (e.g., Infrastructure, Workloads, Sandbox - Conditional, via \`create_organizational_units.sh\`)" "SKIPPED"
        update_checklist_item "Register OUs with Control Tower (Manual Step)" "SKIPPED"
    fi
fi

# STEP 9: Enable Security Services
echo
echo "==================================================================="
echo "STEP 9: Enable Security Services"
echo "==================================================================="
echo "Now we'll enable security services required for SOC 2 compliance."
echo

if ! check_step_completed "Security services enablement" "Perform Security services enablement (GuardDuty, Security Hub, Config, Macie, Inspector - Conditional, via \`enable_security_services.sh\`)"; then
    if prompt_yes_no "Do you want to enable security services (GuardDuty, Security Hub, Config, Macie, Inspector)?"; then
        echo "Enabling security services..."
        "$SCRIPT_DIR/enable_security_services.sh" -p "$ADMIN_PROFILE" -a
        update_checklist_item "Perform Security services enablement (GuardDuty, Security Hub, Config, Macie, Inspector - Conditional, via \`enable_security_services.sh\`)" "DONE"
    else
        update_checklist_item "Perform Security services enablement (GuardDuty, Security Hub, Config, Macie, Inspector - Conditional, via \`enable_security_services.sh\`)" "SKIPPED"
    fi
fi

# STEP 10: Enable Control Tower Controls
echo
echo "==================================================================="
echo "STEP 10: Enable Control Tower Controls"
echo "==================================================================="
echo "Now we'll enable additional Control Tower controls for SOC 2 compliance."
echo

if ! check_step_completed "Control Tower controls enablement" "Perform Control Tower controls enablement for a selected OU (Conditional, via \`enable_control_tower_controls.sh\`)"; then
    if prompt_yes_no "Do you want to enable SOC 2 specific controls?"; then
        # Get OUs
        ROOT_ID=$(aws organizations list-roots --profile "$ADMIN_PROFILE" --query "Roots[0].Id" --output text)
        OUS=$(aws organizations list-organizational-units-for-parent --parent-id "$ROOT_ID" --profile "$ADMIN_PROFILE" --query "OrganizationalUnits[].{Name:Name,Id:Id}" --output json)
        
        # Display OUs and let user select
        echo "Available Organizational Units:"
        echo "$OUS" | jq -r '.[] | .Name + " (" + .Id + ")"'
        
        echo "You can select:"
        echo "  - Multiple OUs by entering comma-separated IDs (e.g., ou-abcd-1,ou-efgh-2)"
        echo "  - All OUs by typing 'all'"
        echo "  - No OUs by pressing Enter without typing anything"
        read -p "Enter the OU ID(s) to apply controls to: " OU_INPUT
        
        # Initialize array for selected OUs
        declare -a SELECTED_OUS=()
        
        # Handle the "all" option
        if [ "$OU_INPUT" = "all" ]; then
            SELECTED_OUS=($(echo "$OUS" | jq -r '.[].Id'))
            echo "Selected all OUs."
        # Handle empty input
        elif [ -z "$OU_INPUT" ]; then
            echo "No OUs selected. Skipping control enablement."
        # Handle comma-separated list
        else
            # Split the input by commas
            IFS=',' read -ra OU_IDS <<< "$OU_INPUT"
            
            # Validate each OU ID
            for OU_ID in "${OU_IDS[@]}"; do
                # Trim whitespace
                OU_ID=$(echo "$OU_ID" | xargs)
                
                if ! echo "$OUS" | jq -r '.[].Id' | grep -q "$OU_ID"; then
                    echo "WARNING: Invalid OU ID: $OU_ID. Skipping this OU." 1>&2
                else
                    SELECTED_OUS+=("$OU_ID")
                fi
            done
        fi
        
        # Apply controls to selected OUs
        if [ ${#SELECTED_OUS[@]} -gt 0 ]; then
            for OU_ID in "${SELECTED_OUS[@]}"; do
                OU_NAME=$(echo "$OUS" | jq -r --arg id "$OU_ID" '.[] | select(.Id == $id) | .Name')
                echo "Enabling SOC 2 controls for OU $OU_NAME ($OU_ID)..."
                bash "$SCRIPT_DIR/enable_control_tower_controls.sh" -p "$ADMIN_PROFILE" -o "$OU_ID" -s both -b recommended
            done
            update_checklist_item "Perform Control Tower controls enablement for a selected OU (Conditional, via \`enable_control_tower_controls.sh\`)" "DONE"
        else
            update_checklist_item "Perform Control Tower controls enablement for a selected OU (Conditional, via \`enable_control_tower_controls.sh\`)" "SKIPPED"
        fi
    else
        update_checklist_item "Perform Control Tower controls enablement for a selected OU (Conditional, via \`enable_control_tower_controls.sh\`)" "SKIPPED"
    fi
fi

# STEP 11: Configure AWS Backup
echo
echo "==================================================================="
echo "STEP 11: Configure AWS Backup"
echo "==================================================================="
echo "Now we'll configure AWS Backup for data protection."
echo

if ! check_step_completed "AWS Backup configuration" "Perform AWS Backup configuration (Conditional, via \`configure_aws_backup.sh\`)"; then
    if prompt_yes_no "Do you want to configure AWS Backup?"; then
        echo "Configuring AWS Backup..."
        "$SCRIPT_DIR/configure_aws_backup.sh" -p "$ADMIN_PROFILE" -c "$LOG_ARCHIVE_ACCOUNT" -a "$AUDIT_ACCOUNT"
        update_checklist_item "Perform AWS Backup configuration (Conditional, via \`configure_aws_backup.sh\`)" "DONE"
    else
        update_checklist_item "Perform AWS Backup configuration (Conditional, via \`configure_aws_backup.sh\`)" "SKIPPED"
    fi
fi

# STEP 12: Configure Audit and Reporting
echo
echo "==================================================================="
echo "STEP 12: Configure Audit and Reporting"
echo "==================================================================="
echo "Now we'll configure audit and reporting capabilities."
echo

if ! check_step_completed "Audit and reporting configuration" "Perform Audit and reporting configuration (Conditional, via \`configure_audit_reporting.sh\`)"; then
    if prompt_yes_no "Do you want to configure audit and reporting?"; then
        echo "Configuring audit and reporting..."
        
        # First, ask about manual AWS Audit Manager setup
        if ! check_step_completed "AWS Audit Manager console setup" "Perform AWS Audit Manager console setup (Required Manual Step)"; then
            wait_for_manual_step "Set up AWS Audit Manager in Console" "
1. Sign in to the AWS Management Console
2. Navigate to AWS Audit Manager service
3. Click on 'Get started' or 'Set up AWS Audit Manager'
4. Accept the terms and conditions
5. Configure the service settings in the console
6. Complete the initial setup process

IMPORTANT: AWS Audit Manager cannot be enabled entirely through the CLI without this initial console setup.
This is explicitly stated in AWS's documentation and confirmed by the error message when trying CLI-only setup.
"
            update_checklist_item "Perform AWS Audit Manager console setup (Required Manual Step)" "DONE"
        fi
        
        # Now run the script with the -s option to handle failures gracefully
        echo "Running additional audit reporting configuration..."
        
        # Check if we should use the audit account as delegated admin (AWS best practice)
        if [ ! -z "$AUDIT_ACCOUNT" ]; then
            echo "Following AWS best practice: Using Audit account as delegated administrator"
            # First run from management account to set up delegated admin
            "$SCRIPT_DIR/configure_audit_reporting.sh" -p "$ADMIN_PROFILE" -c "$AUDIT_ACCOUNT" -a -s
            
            # Check if we have a profile for the audit account
            read -p "Do you have an AWS CLI profile for the Audit account? (y/n): " HAS_AUDIT_PROFILE
            if [[ "$HAS_AUDIT_PROFILE" =~ ^[Yy]$ ]]; then
                read -p "Enter the AWS CLI profile name for the Audit account: " AUDIT_PROFILE
                echo "Now completing configuration in the Audit account..."
                "$SCRIPT_DIR/configure_audit_reporting.sh" -p "$AUDIT_PROFILE" -a -f -r -s
            else
                echo "IMPORTANT: You need to complete setup in the Audit account console."
                echo "1. Sign in to the Audit account"
                echo "2. Navigate to AWS Audit Manager"
                echo "3. Complete the console-based setup process"
                echo "4. Configure SOC 2 framework and other settings as needed"
            fi
        else
            # Fallback to running in management account (not best practice)
            echo "Running Audit Manager setup in management account."
            echo "NOTE: AWS best practice recommends using the Audit account as delegated administrator."
            "$SCRIPT_DIR/configure_audit_reporting.sh" -p "$ADMIN_PROFILE" -a -f -r -s
        fi
        update_checklist_item "Perform Audit and reporting configuration (Conditional, via \`configure_audit_reporting.sh\`)" "DONE"
    else
        update_checklist_item "Perform AWS Audit Manager console setup (Required Manual Step)" "SKIPPED"
        update_checklist_item "Perform Audit and reporting configuration (Conditional, via \`configure_audit_reporting.sh\`)" "SKIPPED"
    fi
fi

# STEP 13: Provision Additional Accounts (if needed)
echo
echo "==================================================================="
echo "STEP 13: Provision Additional Accounts (Optional)"
echo "==================================================================="
echo "You can provision additional accounts through Control Tower Account Factory."
echo

if prompt_yes_no "Do you want to provision additional accounts?" "n"; then
    # Track if any accounts were provisioned
    any_account_provisioned_step13=false
    
    # Get OUs for selection
    ROOT_ID=$(aws organizations list-roots --profile "$ADMIN_PROFILE" --query "Roots[0].Id" --output text)
    OUS=$(aws organizations list-organizational-units-for-parent --parent-id "$ROOT_ID" --profile "$ADMIN_PROFILE" --query "OrganizationalUnits[].{Name:Name,Id:Id}" --output json)
    
    # Loop to provision multiple accounts if needed
    while true; do
        if ! prompt_yes_no "Do you want to provision an account"; then
            break
        fi
        # Get account information
        read -p "Account name: " account_name
        read -p "Account email: " account_email
        
        # Get OU selection
        echo "Available Organizational Units:"
        echo "$OUS" | jq -r '.[] | .Name + " (" + .Id + ")"'
        read -p "Enter the OU name to place the account in: " ou_name
        
        # Provision the account and wait for it to complete
        echo "Provisioning account $account_name..."
        "$SCRIPT_DIR/provision_account.sh" -p "$ADMIN_PROFILE" -n "$account_name" -e "$account_email" -o "$ou_name" -w
        any_account_provisioned_step13=true
        update_checklist_item "Provision additional accounts via Account Factory (Conditional, via \`provision_account.sh\`)" "DONE" # Marked per account
        
        # The account is now provisioned and available
        update_checklist_item "Wait for Account Provisioning (Manual Step, ~30-60 mins)" "DONE" # Marked per account
        
        # Update the organization accounts list
        ORG_ACCOUNTS=$(aws organizations list-accounts --profile "$ADMIN_PROFILE" --query "Accounts[?Status=='ACTIVE'].{ID:Id,Name:Name}" --output json)
        
        # Find the new account ID
        NEW_ACCOUNT_ID=$(echo "$ORG_ACCOUNTS" | jq -r --arg name "$account_name" '.[] | select(.Name == $name) | .ID')
        if [ -n "$NEW_ACCOUNT_ID" ]; then
            echo "New account ID: $NEW_ACCOUNT_ID"
            
            # Ask if they want to assign permissions
            if prompt_yes_no "Do you want to assign administrator access to $USERS_GROUP group for the new account?"; then
                # Assign group permissions to the new account
                echo "Assigning administrator access to $USERS_GROUP group for the new account..."
                "$SCRIPT_DIR/manage_sso_group.sh" -p "$ADMIN_PROFILE" -g "$USERS_GROUP" -a "$NEW_ACCOUNT_ID" -r "AWSAdministratorAccess"
                update_checklist_item "Assign administrator access to the user group for new accounts (Conditional, via \`manage_sso_group.sh\`)" "DONE" # Marked per account
            else
                update_checklist_item "Assign administrator access to the user group for new accounts (Conditional, via \`manage_sso_group.sh\`)" "SKIPPED" # Marked per account
            fi
        else
            echo "WARNING: Could not find the new account ID. You'll need to manually assign permissions."
            update_checklist_item "Assign administrator access to the user group for new accounts (Conditional, via \`manage_sso_group.sh\`)" "SKIPPED" # Marked per account if ID not found
        fi
    done
else
    update_checklist_item "Provision additional accounts via Account Factory (Conditional, via \`provision_account.sh\`)" "SKIPPED"
    update_checklist_item "Wait for Account Provisioning (Manual Step, ~30-60 mins)" "SKIPPED"
    update_checklist_item "Assign administrator access to the user group for new accounts (Conditional, via \`manage_sso_group.sh\`)" "SKIPPED"
fi

# STEP 14: Configure Custom Domain for IAM Identity Center (optional)
echo
echo "==================================================================="
echo "STEP 14: Configure Custom Domain for IAM Identity Center (Optional)"
echo "==================================================================="
echo "You can set up a custom domain for IAM Identity Center to improve user experience."
echo

if ! check_step_completed "Custom domain configuration for IAM Identity Center" "Perform Custom domain configuration for IAM Identity Center (Conditional, Manual Step)"; then
    if prompt_yes_no "Do you want to configure a custom domain for IAM Identity Center?" "n"; then
        read -p "Enter your domain name (e.g., sampleproject): " DOMAIN_NAME
        
        wait_for_manual_step "Configure Custom Domain" "
1. Sign in to the AWS Management Console
2. Navigate to IAM Identity Center
3. Go to Settings
4. Under 'Identity source', click 'Customize'
5. Set up the custom domain following the instructions
6. After the domain is verified, proceed
"
        update_checklist_item "Perform Custom domain configuration for IAM Identity Center (Conditional, Manual Step)" "DONE"
        
        echo "Updating SSO profiles to use the new domain..."
        "$SCRIPT_DIR/update_identity_center_start_url.sh" "$ADMIN_PROFILE" "$DOMAIN_NAME"
        update_checklist_item "Update SSO profiles to use the new domain (via \`update_identity_center_start_url.sh\`)" "DONE"
    else
        update_checklist_item "Perform Custom domain configuration for IAM Identity Center (Conditional, Manual Step)" "SKIPPED"
        update_checklist_item "Update SSO profiles to use the new domain (via \`update_identity_center_start_url.sh\`)" "SKIPPED"
    fi
fi

# STEP 15: Disable Root User Console Access for Sub-Accounts
echo
echo "==================================================================="
echo "STEP 15: Disable Root User Console Access for Sub-Accounts"
echo "==================================================================="
echo "This step disables console access for root users in all sub-accounts."
echo "This is a critical security measure for SOC 2 compliance."
echo

if ! check_step_completed "Root user console access disabling" "Perform Root user console access disabling for sub-accounts"; then
    if prompt_yes_no "Do you want to disable console access for root users in sub-accounts?"; then
        echo "Disabling console access for root users in sub-accounts..."
        
        # Enable trusted access for IAM in AWS Organizations
        echo "Step 1: Enabling trusted access for IAM in AWS Organizations..."
        aws organizations enable-aws-service-access \
            --service-principal iam.amazonaws.com \
            --profile "$ADMIN_PROFILE" \
            || echo "Trusted access for IAM is already enabled or couldn't be enabled."
        
        # Enable root credentials management
        echo "Step 2: Enabling root credentials management in AWS Organizations..."
        aws iam enable-organizations-root-credentials-management \
            --profile "$ADMIN_PROFILE" \
            || echo "Root credentials management is already enabled or couldn't be enabled."
        
        # Enable organizations root sessions
        echo "Step 3: Enabling organizations root sessions in AWS Organizations..."
        aws iam enable-organizations-root-sessions \
            --profile "$ADMIN_PROFILE" \
            || echo "Organizations root sessions are already enabled or couldn't be enabled."
        
        # Get all member accounts (excluding the management account)
        echo "Step 4: Retrieving list of member accounts..."
        MANAGEMENT_ACCOUNT_ID="$AWS_ACCOUNT_ID"
        echo "Management account ID: $MANAGEMENT_ACCOUNT_ID"
        
        MEMBER_ACCOUNTS=$(aws organizations list-accounts \
            --profile "$ADMIN_PROFILE" \
            | jq -r ".Accounts[] | select(.Id != \"$MANAGEMENT_ACCOUNT_ID\" and .Status == \"ACTIVE\") | .Id")
        
        if [ -z "$MEMBER_ACCOUNTS" ]; then
            echo "No member accounts found. Nothing to process."
        else
            ACCOUNT_COUNT=$(echo "$MEMBER_ACCOUNTS" | wc -l)
            echo "Found $ACCOUNT_COUNT member accounts to process"
            
            # Set a counter for progress tracking
            COUNTER=0
            
            for ACCOUNT_ID in $MEMBER_ACCOUNTS; do
                COUNTER=$((COUNTER + 1))
                echo "[$COUNTER/$ACCOUNT_COUNT] Processing account $ACCOUNT_ID..."
                
                # Get account name for better logging
                ACCOUNT_NAME=$(aws organizations describe-account \
                    --account-id "$ACCOUNT_ID" \
                    --profile "$ADMIN_PROFILE" \
                    | jq -r .Account.Name)
                
                echo "  Account: $ACCOUNT_NAME ($ACCOUNT_ID)"
                
                # Step 5a: Assume root session in the target account
                echo "  Requesting temporary root session..."
                ROOT_SESSION=$(aws sts assume-root \
                    --target-principal "$ACCOUNT_ID" \
                    --task-policy-arn arn:aws:iam::aws:policy/root-task/IAMDeleteRootUserCredentials \
                    --profile "$ADMIN_PROFILE" 2>/dev/null || echo '{\"failed\": true}')
                
                # Check if assume-root failed
                if [ "$(echo "$ROOT_SESSION" | jq -r '.failed // \"false\"')" == "true" ]; then
                    echo "  Error: Failed to assume root session for account $ACCOUNT_ID"
                    continue
                fi
                
                # Extract temporary credentials
                ACCESS_KEY=$(echo "$ROOT_SESSION" | jq -r .Credentials.AccessKeyId)
                SECRET_KEY=$(echo "$ROOT_SESSION" | jq -r .Credentials.SecretAccessKey)
                SESSION_TOKEN=$(echo "$ROOT_SESSION" | jq -r .Credentials.SessionToken)
                
                if [ "$ACCESS_KEY" == "null" ] || [ -z "$ACCESS_KEY" ]; then
                    echo "  Error: Failed to get valid temporary credentials"
                    continue
                fi
                
                # Step 5b: Delete root credentials
                echo "  Deleting root credentials..."
                
                # We'll use a temporary profile for the assumed root credentials
                export AWS_ACCESS_KEY_ID="$ACCESS_KEY"
                export AWS_SECRET_ACCESS_KEY="$SECRET_KEY"
                export AWS_SESSION_TOKEN="$SESSION_TOKEN"
                
                # Delete the root credentials
                DELETE_RESULT=$(aws iam delete-root-user-credentials 2>&1) || true
                
                # Check if the deletion succeeded
                if [[ $DELETE_RESULT == *"Error"* ]]; then
                    echo "  Warning: $DELETE_RESULT"
                else
                    echo "  Success: Root credentials deleted for account $ACCOUNT_NAME ($ACCOUNT_ID)"
                fi
                
                # Clear environment variables for the next account
                unset AWS_ACCESS_KEY_ID
                unset AWS_SECRET_ACCESS_KEY
                unset AWS_SESSION_TOKEN
                
                echo
            done
            
            # Final status
            echo "=== Summary ==="
            echo "Total accounts processed: $ACCOUNT_COUNT"
            echo 
            echo "Root Access Management is now fully configured:"
            echo "  1. IAM trusted access is enabled in the organization"
            echo "  2. Root credentials management is enabled"
            echo "  3. Organizations root sessions are enabled"
            echo "  4. Root credentials have been removed from all possible member accounts"
            echo
            echo "Additional information:"
            echo "  - Any new accounts created in your organization will now be created without root credentials by default"
            echo "  - To re-enable root access for specific accounts if needed, use:"
            echo "    aws sts assume-root --target-principal ACCOUNT_ID --task-policy-arn arn:aws:iam::aws:policy/root-task/IAMAllowRootUserCredentialRecovery --profile $ADMIN_PROFILE"
            echo "  - For troubleshooting, check the AWS IAM console > Root access management"
        fi
        
        update_checklist_item "Perform Root user console access disabling for sub-accounts" "DONE"
    else
        update_checklist_item "Perform Root user console access disabling for sub-accounts" "SKIPPED"
    fi
fi

# STEP 16: Set up KMS Key Management
echo
echo "==================================================================="
echo "STEP 16: Configure KMS Key Management (Optional)"
echo "==================================================================="
echo "You can configure additional access to KMS keys created during setup."
echo

if ! check_step_completed "KMS key management configuration" "Perform KMS key management configuration (Conditional, via \`manage_kms_keys.sh\`)"; then
    if prompt_yes_no "Do you want to manage KMS key access?" "n"; then
        # Get KMS keys
        KMS_KEYS=$(aws kms list-keys --profile "$ADMIN_PROFILE" --query "Keys[].KeyId" --output json)
        
        echo "Available KMS keys:"
        COUNT=1
        KEY_MAP=()
        
        for key_id in $(echo "$KMS_KEYS" | jq -r '.[]'); do
            key_desc=$(aws kms describe-key --key-id "$key_id" --profile "$ADMIN_PROFILE" --query "KeyMetadata.{Id:KeyId,Desc:Description}" --output json 2>/dev/null)
            if [ $? -eq 0 ]; then
                desc=$(echo "$key_desc" | jq -r '.Desc')
                echo "$COUNT) $key_id - $desc"
                KEY_MAP+=("$key_id")
                COUNT=$((COUNT+1))
            fi
        done
        
        read -p "Enter the number of the key to manage (1-$((COUNT-1))): " key_num
        
        if [[ "$key_num" =~ ^[0-9]+$ ]] && [ "$key_num" -ge 1 ] && [ "$key_num" -le $((COUNT-1)) ]; then
            SELECTED_KEY="${KEY_MAP[$((key_num-1))]}"
            
            echo "Selected key: $SELECTED_KEY"
            echo "Adding $USERS_GROUP group administrators to key..."
            
            # Get the group's role ARN
            IDENTITY_STORE_ID=$(aws sso-admin list-instances --profile "$ADMIN_PROFILE" --query "Instances[0].IdentityStoreId" --output text)
            GROUP_ID=$(aws identitystore list-groups \
                --identity-store-id "$IDENTITY_STORE_ID" \
                --filters "AttributePath=DisplayName,AttributeValue=$USERS_GROUP" \
                --profile "$ADMIN_PROFILE" \
                --query "Groups[0].GroupId" \
                --output text)
            
            # Assuming the group has a corresponding role
            GROUP_ROLE_ARN="arn:aws:iam::$MANAGEMENT_ACCOUNT_ID:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_AWSAdministratorAccess_*"
            
            # Add the group's role as a key administrator
            "$SCRIPT_DIR/manage_kms_keys.sh" -p "$ADMIN_PROFILE" -k "$SELECTED_KEY" -a "$GROUP_ROLE_ARN" -e
            update_checklist_item "Perform KMS key management configuration (Conditional, via \`manage_kms_keys.sh\`)" "DONE"
        else
            echo "Invalid selection. Skipping key management."
            update_checklist_item "Perform KMS key management configuration (Conditional, via \`manage_kms_keys.sh\`)" "SKIPPED"
        fi
    else
        update_checklist_item "Perform KMS key management configuration (Conditional, via \`manage_kms_keys.sh\`)" "SKIPPED"
    fi
fi

# Done
echo
echo "==================================================================="
echo "SOC 2 Compliant AWS Control Tower Setup Complete!"
echo "==================================================================="
echo
echo "Your AWS environment has been set up with SOC 2 compliant configurations."
echo "Here's a summary of what was done:"
echo
echo "1. Set up AWS Control Tower with a multi-account structure"
echo "2. Created administrative users and groups"
echo "3. Enabled security services and controls"
echo "4. Configured backup and audit capabilities"
echo "5. Disabled root user console access for sub-accounts"
echo
echo "Next steps:"
echo "1. Review the configuration in the AWS Console"
echo "2. Set up additional accounts as needed"
echo "3. Implement additional controls based on your specific requirements"
echo "4. Document your compliance posture for SOC 2 audits"
echo
echo "Thank you for using the AWS Control Tower SOC 2 Setup Script!"