# AWS Control Tower Setup Checklist 🚀

This checklist helps you track the progress of setting up your SOC 2 Compliant AWS Control Tower environment using the `master_control_tower_setup.sh` script.

**Status Key:**
*   ⏳ PENDING - Step has not been started or completed.
*   ✅ DONE - Step has been successfully completed.
*   ⏭️ SKIPPED - Step was intentionally skipped.

---

## 📝 Initial Configuration

*   [x] ✅ Provide AWS Account ID
*   [x] ✅ Confirm Setup Settings

## 1️⃣ STEP 1: Initial AWS CLI Profile Setup

*   [x] ⏳ Perform Initial AWS CLI profile setup (Root User Access Keys & `aws configure`)

## 2️⃣ STEP 2: Enable MFA for Root User

*   [x] ⏳ Perform MFA setup for root user (Manual Step)

## 3️⃣ STEP 3: Enable IAM Identity Center

*   [x] ⏳ Perform IAM Identity Center setup (Manual Step)

## 4️⃣ STEP 4: Set up AWS Control Tower

*   [x] ⏳ Perform AWS Control Tower setup (Manual Step, ~30-60 mins)
*   [x] ✅ Verify Control Tower setup completion

## 5️⃣ STEP 5: Create Admin User & Configure Access

*   [x] ⏳ Perform Admin user creation in IAM Identity Center (via `create_sso_user.sh`)
*   [x] ⏳ Set Admin User Password (Manual Step in IAM Identity Center)
*   [x] ⏳ Perform Administrator access assignment to admin user for management account (via `assign_sso_permissions.sh`)
*   [x] ⏳ Perform SSO profile configuration for admin user (Manual Step: `aws configure sso`)
*   [ ] ⏳ Perform Root user access key deletion (via `delete_root_user_access_key.sh`)

## 6️⃣ STEP 6: Create IAM Identity Center Group for Initial Users

*   [ ] ⏳ Perform IAM Identity Center group creation (e.g., `InitialUsers` via `manage_sso_group.sh`)

## 7️⃣ STEP 7: Create Additional Users

*   [ ] ⏳ Perform Additional user creation (via `create_sso_user.sh`)
*   [ ] ⏳ Add users to the IAM Identity Center group (via `manage_sso_group.sh`)
*   [ ] ⏳ Assign administrator access to the user group for core accounts (Management, Log Archive, Audit - Conditional, via `manage_sso_group.sh`)
*   [ ] ⏳ Set User Passwords for additional users (Manual Step in IAM Identity Center)

## 8️⃣ STEP 8: Create Organizational Units (OUs)

*   [ ] ⏳ Perform Organizational Units creation (e.g., Infrastructure, Workloads, Sandbox - Conditional, via `create_organizational_units.sh`)
*   [ ] ⏳ Register OUs with Control Tower (Manual Step)

## 9️⃣ STEP 9: Enable Security Services

*   [ ] ⏳ Perform Security services enablement (GuardDuty, Security Hub, Config, Macie, Inspector - Conditional, via `enable_security_services.sh`)

## 🔟 STEP 10: Enable Control Tower Controls

*   [ ] ⏳ Perform Control Tower controls enablement for a selected OU (Conditional, via `enable_control_tower_controls.sh`)

## ⏸️ STEP 11: Configure AWS Backup

*   [ ] ⏳ Perform AWS Backup configuration (Conditional, via `configure_aws_backup.sh`)

## ⑫ STEP 12: Configure Audit and Reporting

*   [ ] ⏳ Perform Audit and reporting configuration (Conditional, via `configure_audit_reporting.sh`)

## ⑬ STEP 13: Provision Additional Accounts (Optional)

*   [ ] ⏳ Provision additional accounts via Account Factory (Conditional, via `provision_account.sh`)
*   [ ] ⏳ Wait for Account Provisioning (Manual Step, ~30-60 mins)
*   [ ] ⏳ Assign administrator access to the user group for new accounts (Conditional, via `manage_sso_group.sh`)

## ⑭ STEP 14: Configure Custom Domain for IAM Identity Center (Optional)

*   [ ] ⏳ Perform Custom domain configuration for IAM Identity Center (Conditional, Manual Step)
*   [ ] ⏳ Update SSO profiles to use the new domain (via `update_identity_center_start_url.sh`)

## ⑮ STEP 15: Configure KMS Key Management (Optional)

*   [ ] ⏳ Perform KMS key management configuration (Conditional, via `manage_kms_keys.sh`)

---

🎉 **Setup Completion**

Once all necessary steps are ✅ DONE or ⏭️ SKIPPED, your AWS Control Tower environment should be configured!
Remember to review the "Next steps" outlined in the main script.