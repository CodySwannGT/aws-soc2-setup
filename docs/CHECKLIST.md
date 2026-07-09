# AWS Control Tower Setup Checklist

Track progress while setting up a SOC 2–aligned AWS Control Tower environment with the `aws-soc2-setup` CLI.

**Status key:**

- PENDING — not started
- DONE — completed
- SKIPPED — intentionally skipped

Useful commands while working through this list:

```bash
aws-soc2-setup whoami -p <profile>
aws-soc2-setup status -p <profile>
aws-soc2-setup setup --dry-run -p <profile>
```

---

## Initial configuration

- [ ] Confirm AWS account ID and admin profile
- [ ] Confirm target region

## Step 1 — Initial AWS CLI / SSO profile setup (manual)

- [ ] Run `aws-soc2-setup sso configure-profile` (or `aws configure sso`)

## Step 2 — Enable MFA for root user (manual)

- [ ] Enable an MFA device on the root user in the AWS console

## Step 3 — Enable IAM Identity Center (manual)

- [ ] Enable IAM Identity Center in the AWS console
- [ ] Confirm with `aws-soc2-setup status` (Identity Center check)

## Step 4 — Set up AWS Control Tower (manual)

- [ ] Create the Control Tower landing zone in the console (~30–60 min)
- [ ] Confirm Organizations is available (`aws-soc2-setup status`)

## Step 5 — Create admin user and configure access (manual)

- [ ] `aws-soc2-setup sso create-user ...`
- [ ] Set the admin user password in Identity Center
- [ ] `aws-soc2-setup sso assign ...` for the management account
- [ ] Configure a local SSO profile for the admin user
- [ ] `aws-soc2-setup root delete-keys --yes` (after admin access works)

## Step 6 — Create the initial users group (manual)

- [ ] `aws-soc2-setup sso group -g InitialUsers ...`

## Step 7 — Create additional users (manual)

- [ ] Create users with `sso create-user`
- [ ] Add them with `sso group`
- [ ] Assign access to core accounts as needed
- [ ] Set passwords in Identity Center

## Step 8 — Create organizational units (automated)

- [ ] `aws-soc2-setup controltower create-ous --all`
- [ ] Register OUs with Control Tower in the console if required

## Step 9 — Enable security services (automated)

- [ ] `aws-soc2-setup security enable --all`

## Step 10 — Enable Control Tower controls (automated)

- [ ] `aws-soc2-setup controltower enable-controls -o <ouId> ...`

## Step 11 — Configure AWS Backup (automated)

- [ ] `aws-soc2-setup backup -c <centralAccount> -a <adminAccount> ...`

## Step 12 — Configure audit and reporting (automated)

- [ ] Complete any required Audit Manager console setup
- [ ] `aws-soc2-setup security audit --audit-account <id> ...`

## Step 13 — Provision additional accounts (optional / manual)

- [ ] `aws-soc2-setup controltower provision-account ...` (use `--wait` as needed)
- [ ] Re-run `security enable` for new accounts
- [ ] Assign group access to new accounts

## Step 14 — Custom Identity Center domain (optional / manual)

- [ ] Configure the custom domain in the console
- [ ] `aws-soc2-setup sso set-start-url -p <profile> -d <domain>`

## Step 15 — Disable root access for sub-accounts (manual / destructive)

- [ ] Review member accounts (`aws-soc2-setup status`)
- [ ] `aws-soc2-setup root remove-access --yes`

## Step 16 — Configure KMS key management (optional / manual)

- [ ] `aws-soc2-setup kms -k <keyId> ...`

---

## Setup completion

When required steps are DONE or SKIPPED, re-check with:

```bash
aws-soc2-setup status -p <profile>
```

This checklist helps implement technical controls relevant to SOC 2; it does not guarantee a successful audit.
