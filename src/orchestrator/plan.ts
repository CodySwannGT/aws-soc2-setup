/** Whether a setup step is automated by this CLI or must be done by hand. */
export type StepKind = "automated" | "manual";

/** A single step in the Control Tower / SOC 2 setup sequence. */
export interface SetupStep {
  number: number;
  title: string;
  kind: StepKind;
  detail: string;
}

/**
 * The ordered setup plan for `aws-soc2-setup setup`. Console-only steps are
 * `manual`; the rest map to this CLI's domain commands.
 */
export const SETUP_PLAN: SetupStep[] = [
  {
    number: 1,
    title: "Initial AWS CLI profile setup",
    kind: "manual",
    detail:
      "Run `aws-soc2-setup sso configure-profile` (interactive `aws configure sso`).",
  },
  {
    number: 2,
    title: "Enable MFA for the root user",
    kind: "manual",
    detail: "Enable an MFA device on the root user in the AWS console.",
  },
  {
    number: 3,
    title: "Create AWS Organizations",
    kind: "automated",
    detail: "controltower create-organization",
  },
  {
    number: 4,
    title: "Enable IAM Identity Center",
    kind: "manual",
    detail: "Enable IAM Identity Center in the AWS console.",
  },
  {
    number: 5,
    title: "Set up AWS Control Tower",
    kind: "manual",
    detail: "Set up the Control Tower landing zone in the console.",
  },
  {
    number: 6,
    title: "Create the admin user",
    kind: "manual",
    detail: "Run `sso create-user`, `sso assign`, then `root delete-keys`.",
  },
  {
    number: 7,
    title: "Create the initial users group",
    kind: "manual",
    detail: "Run `sso group -g InitialUsers`.",
  },
  {
    number: 8,
    title: "Create additional users",
    kind: "manual",
    detail: "Run `sso create-user` per user and add them with `sso group`.",
  },
  {
    number: 9,
    title: "Create organizational units",
    kind: "automated",
    detail: "controltower create-ous --all",
  },
  {
    number: 10,
    title: "Register OUs with Control Tower",
    kind: "automated",
    detail: "controltower register-ou -o <ou>",
  },
  {
    number: 11,
    title: "Enable security services",
    kind: "automated",
    detail: "security enable --all",
  },
  {
    number: 12,
    title: "Enable Control Tower controls",
    kind: "automated",
    detail: "controltower enable-controls -o <ou>",
  },
  {
    number: 13,
    title: "Configure AWS Backup",
    kind: "automated",
    detail: "backup -c <central> -a <admin>",
  },
  {
    number: 14,
    title: "Configure audit and reporting",
    kind: "automated",
    detail: "security audit --audit-account <id> --aggregator",
  },
  {
    number: 15,
    title: "Deploy Config Conformance Packs",
    kind: "automated",
    detail: "security conformance-packs --preset recommended",
  },
  {
    number: 16,
    title: "Provision additional accounts",
    kind: "manual",
    detail: "Run `controltower provision-account` per account.",
  },
  {
    number: 17,
    title: "Configure a custom Identity Center domain",
    kind: "manual",
    detail: "Run `sso set-start-url -p <profile> -d <domain>`.",
  },
  {
    number: 18,
    title: "Disable root access for sub-accounts",
    kind: "manual",
    detail: "Run `root remove-access --yes`.",
  },
  {
    number: 19,
    title: "Configure KMS key management",
    kind: "manual",
    detail: "Run `kms -k <keyId>` for backup keys.",
  },
  {
    number: 20,
    title: "Block long-lived IAM credentials",
    kind: "manual",
    detail:
      "Run `scp deny-iam-users --yes` once no workload depends on IAM users.",
  },
  {
    number: 21,
    title: "Alert on IAM credential creation in the management account",
    kind: "manual",
    detail:
      "Run `scp alert-management -e <email> --yes` in us-east-1 (SCPs cannot bind the management account).",
  },
];
