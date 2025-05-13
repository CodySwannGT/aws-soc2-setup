# 🏗️ AWS Control Tower SOC 2 Automation Suite

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![SOC 2 Compliant](https://img.shields.io/badge/SOC%202-Compliant-green)](https://www.aicpa.org/interestareas/frc/assuranceadvisoryservices/soc2relevantguidance.html)
[![AWS Control Tower](https://img.shields.io/badge/AWS-Control%20Tower-orange)](https://aws.amazon.com/controltower/)

> Streamlined automation for SOC 2 compliant AWS Control Tower environments

A comprehensive automation suite that guides you through setting up a fully SOC 2 compliant AWS environment using Control Tower with minimal manual intervention.

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Why Use This Suite](#-why-use-this-suite)
- [AI Coding Assistant Integration](#-ai-coding-assistant-integration)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Usage](#-usage)
- [Setup Process Details](#-setup-process-details)
- [Advanced Configuration](#-advanced-configuration)
- [Security Considerations](#-security-considerations)
- [Contributing](#-contributing)
- [License](#-license)
- [Acknowledgements](#-acknowledgements)

## 🔍 Overview

The AWS Control Tower SOC 2 Automation Suite is a collection of interconnected scripts designed to automate and guide the creation of a secure, compliant, multi-account AWS environment. It reduces the complex, error-prone manual process of implementing SOC 2 requirements within AWS Control Tower into a streamlined, repeatable workflow.

This suite bridges the gap between AWS Control Tower's built-in capabilities and the specific requirements needed for SOC 2 compliance, handling everything from initial account setup to ongoing security controls.

## ✨ Features

- **Guided Setup**: Step-by-step interactive process with clear instructions
- **Skip-Friendly**: Already completed some steps? No problem – the suite can start from any point
- **Multi-Account Architecture**: Properly configure management, audit, log archive, and workload accounts
- **IAM Identity Center Integration**: Automated user and permission management
- **SOC 2 Security Controls**: Automatic enablement of required security services
- **Organizational Structure**: Create and register the proper OUs for your compliance needs
- **Root Account Protection**: Ensure proper MFA and access key management

## 🎯 Why Use This Suite

### Save Time and Reduce Errors

Manually setting up a SOC 2 compliant AWS environment typically takes 8-16 hours of work with numerous opportunities for configuration errors. This suite reduces that time by up to 75% and ensures consistency.

### Ensure Compliance from Day One

SOC 2 audits examine your environment's historical compliance. Starting with a compliant foundation means no retroactive fixes or explanations needed.

### Simplify Multi-Account Management

AWS recommends a multi-account strategy for security isolation, but configuring this properly is complex. This suite handles the intricacies of account relationships, permissions, and security service configurations automatically.

### Enhanced Security for Root Accounts

The suite automatically disables console access for root users in sub-accounts, following AWS best practices for security. This critical protection helps prevent unauthorized access to your most privileged accounts and satisfies SOC 2 requirements for privileged access management.

### Reduce Cloud Security Expertise Requirements

Not everyone on your team may be an AWS security expert. This suite codifies best practices and provides clear, actionable guidance throughout the process.

## 🤖 AI Coding Assistant Integration

This repository is configured to seamlessly integrate with AI Coding Assistants, leveraging the framework provided by [AI Coding Assistants Setup](https://github.com/codySwannGT/ai-coding-assistants-setup). This integration enhances the development experience by:

- **Accelerating Development:** AI assistants can help generate boilerplate code, suggest solutions, and automate repetitive tasks.
- **Improving Code Quality:** Assistants can provide real-time feedback on code style, identify potential bugs, and suggest best practices.
- **Facilitating Complex Tasks:** AI can assist in understanding complex codebases, refactoring, and implementing new features more efficiently.
- **Streamlining Workflows:** The setup enables a more interactive and intelligent development environment, allowing developers to focus on higher-level problem-solving.

By incorporating AI-powered tools, this project aims to boost productivity and maintain high standards of code quality and innovation.

## 📋 Prerequisites

- AWS root account with administrator access
- AWS CLI installed and configured
- `jq` command-line tool installed
- Bash shell environment
- Basic understanding of AWS services

## 🚀 Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/aws-controltower-soc2-automation.git
   cd aws-controltower-soc2-automation
   ```

2. Ensure all scripts have execution permissions:
   ```bash
   chmod +x *.sh
   ```

3. Install required dependencies:
   ```bash
   # For Debian/Ubuntu
   sudo apt-get update && sudo apt-get install -y jq awscli
   
   # For macOS
   brew install jq awscli
   ```

## 🛠️ Usage

Run the master script with optional parameters:

```bash
./master_control_tower_setup.sh [-a ACCOUNT_ID] [-p PROFILE] [-d ADMIN_PROFILE] [-r REGION] [-h]
```

**Parameters:**
- `-a ACCOUNT_ID`: Your 12-digit AWS account ID
- `-p PROFILE`: Initial AWS CLI profile name (default: sampleproject)
- `-d ADMIN_PROFILE`: Admin AWS CLI profile name (default: thehobbyhome-management)
- `-r REGION`: AWS region (default: us-east-1)
- `-h`: Display help message

**Example:**
```bash
./master_control_tower_setup.sh -a 123456789012 -d my-admin-profile -r us-west-2
```

## 📊 Setup Process Details

The setup process follows these key steps, each designed to implement specific SOC 2 requirements:

### 1. Initial AWS CLI Profile Setup
**What it does:** Creates a temporary profile with root credentials to bootstrap the environment.  
**Why it matters:** Provides necessary initial access while ensuring we can remove these credentials later for security.

### 2. Enable MFA for Root User
**What it does:** Guides you through setting up Multi-Factor Authentication for the root account.  
**Why it matters:** Required for SOC 2 compliance and protects your most privileged account from unauthorized access.

### 3. Enable IAM Identity Center
**What it does:** Activates AWS IAM Identity Center (formerly AWS SSO).  
**Why it matters:** Provides centralized access management with fine-grained permissions required for proper segregation of duties.

### 4. Set up AWS Control Tower
**What it does:** Deploys the Control Tower landing zone with appropriate configurations.  
**Why it matters:** Creates the foundation of your multi-account architecture with built-in guardrails and compliance controls.

### 5. Create and Configure Admin User
**What it does:** Creates an administrative user in IAM Identity Center with appropriate permissions.  
**Why it matters:** Establishes a secure administrative account for ongoing management, moving away from root account usage.

### 6. Create IAM Identity Center Group
**What it does:** Creates a group for administrative users.  
**Why it matters:** Enables role-based access control and simplifies permission management.

### 7. Create Additional Users
**What it does:** Adds users to IAM Identity Center and assigns them to groups.  
**Why it matters:** Ensures proper identity management and access controls.

### 8. Create Organizational Units
**What it does:** Establishes recommended OUs (Infrastructure, Workloads, Sandbox) and registers them with Control Tower.  
**Why it matters:** Provides proper organizational structure for workload isolation and security boundary enforcement.

### 9. Enable Security Services
**What it does:** Activates essential security services like GuardDuty, Security Hub, Config, Macie, and Inspector.  
**Why it matters:** Implements required security monitoring, detection, and compliance validation services.

### 10. Provision Additional Accounts
**What it does:** Creates and configures additional AWS accounts through Control Tower Account Factory with automated enrollment completion tracking.  
**Why it matters:** Simplifies the account creation process and ensures all accounts are properly configured and monitored.

### 11. Disable Root User Console Access
**What it does:** Removes root user credentials from all sub-accounts and configures the organization to create new accounts without root credentials by default.  
**Why it matters:** Critical security measure that prevents unauthorized access to the most privileged account in each sub-account, satisfying SOC 2 privileged access requirements.

## 🔧 Advanced Configuration

### Customizing Organizational Units
For organizations with specific structural needs, modify `create_organizational_units.sh` to add or change OUs:

```bash
# Example: Add a custom OU
./create_organizational_units.sh -p your-admin-profile -n "CustomOU" -d "Custom organizational unit for specific workloads"
```

### Adding Custom Security Controls
Additional security controls can be added by modifying `enable_security_services.sh`.

### Implementing Custom Guardrails
For organizations requiring additional preventative or detective guardrails:

```bash
# Enable specific Control Tower controls
./enable_control_tower_controls.sh -p your-admin-profile -c "CT.IAM.PR.1" -o "Infrastructure"
```

## 🔒 Security Considerations

### Root Access Keys
Root user access keys are temporarily created and deleted as part of the setup process. If the process is interrupted, ensure these are manually deleted.

### Root Console Access in Sub-accounts
The suite automatically disables console access for root users in all sub-accounts, following AWS security best practices. This ensures that your most privileged accounts can't be compromised, even if credentials are leaked.

### Security Services for New Accounts
When provisioning new accounts via Account Factory, be aware that security services (GuardDuty, Security Hub, Config, etc.) are not automatically enabled on these accounts. After creating new accounts, you should re-run the security service enablement script for each new account to ensure comprehensive security coverage.

### Audit Logs
Control Tower automatically enables CloudTrail in the Audit account. Consider additional configurations for log retention and analysis.

### Cross-Account Access
The automation creates appropriate cross-account roles. Review these regularly to maintain the principle of least privilege.

## 👥 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please make sure your code follows our [coding standards](CONTRIBUTING.md).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgements

- AWS Control Tower documentation and best practices
- SOC 2 compliance framework
- [AWS Organizations Best Practices](https://aws.amazon.com/organizations/getting-started/best-practices/)
- Contributors and early adopters who provided valuable feedback

---

## 📞 Support

For questions, issues, or feature requests, please open an issue in this repository.

If you find this project useful, please consider giving it a star on GitHub! ⭐️

---

**Disclaimer:** This suite helps implement technical controls relevant to SOC 2 compliance but does not guarantee a successful audit. Organizations should work with qualified auditors to ensure their specific compliance requirements are met.