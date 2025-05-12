# Contributing to AWS Control Tower SOC 2 Automation Suite

First of all, thank you for considering contributing to this project! Your time and expertise help make this automation suite more valuable for everyone building secure AWS environments.

This document provides guidelines and instructions for contributing to this project. By participating, you are expected to uphold this code and help us maintain a welcoming and inclusive environment.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Pull Requests](#pull-requests)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Security Best Practices](#security-best-practices)
- [Documentation](#documentation)
- [Community](#community)

## Code of Conduct

This project and everyone participating in it are governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [conduct@example.com](mailto:conduct@example.com).

## Getting Started

### Environment Setup

1. Ensure you have all [prerequisites](README.md#prerequisites) installed.
2. Fork this repository.
3. Clone your fork: `git clone https://github.com/yourusername/aws-controltower-soc2-automation.git`
4. Add the original repository as an upstream remote: `git remote add upstream https://github.com/originalowner/aws-controltower-soc2-automation.git`

### Development Environment

For consistent development, we recommend:

- VS Code with shellcheck extension
- AWS CLI version 2.x
- A dedicated AWS sandbox environment for testing

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related reports.

Before creating bug reports, please check [this list](https://github.com/yourusername/aws-controltower-soc2-automation/issues) to see if the problem has already been reported. When you are creating a bug report, please include as many details as possible.

**How Do I Submit A (Good) Bug Report?**

Bugs are tracked as [GitHub issues](https://github.com/yourusername/aws-controltower-soc2-automation/issues). Create an issue and provide the following information:

* **Use a clear and descriptive title** for the issue to identify the problem.
* **Describe the exact steps which reproduce the problem** in as many details as possible.
* **Provide specific examples to demonstrate the steps**.
* **Describe the behavior you observed after following the steps** and point out what exactly is the problem with that behavior.
* **Explain which behavior you expected to see instead and why.**
* **Include screenshots** if possible.
* **Include your AWS environment details**: AWS region, AWS CLI version, and any specific AWS service limitations or configurations.
* **If the problem wasn't triggered by a specific action**, describe what you were doing before the problem happened.

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion, including completely new features and minor improvements to existing functionality.

**How Do I Submit A (Good) Enhancement Suggestion?**

Enhancement suggestions are tracked as [GitHub issues](https://github.com/yourusername/aws-controltower-soc2-automation/issues). Create an issue and provide the following information:

* **Use a clear and descriptive title** for the issue to identify the suggestion.
* **Provide a step-by-step description of the suggested enhancement** in as many details as possible.
* **Provide specific examples to demonstrate the steps** or point to similar implementations if applicable.
* **Describe the current behavior** and **explain which behavior you expected to see instead** and why.
* **Explain why this enhancement would be useful** to users of this automation suite.
* **Specify which version of the automation suite you're using.**
* **Specify the AWS services and features relevant to the request**.
* **Include any considerations about how this might impact SOC 2 compliance**.

### Pull Requests

* Fill in the required PR template
* Do not include issue numbers in the PR title
* Include screenshots and animated GIFs in your PR whenever possible
* Follow the [Bash styleguide](#bash-style-guide)
* Include thoughtfully-worded, well-structured tests
* Document new functionality in the README.md
* End all files with a newline
* Place script imports in the following order:
  * Standard Bash functionality
  * Related third-party packages
  * Local modules and imports
* Avoid platform-dependent code

## Development Workflow

1. Create a new branch from `main`: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Test your changes (see [Testing Guidelines](#testing-guidelines))
4. Commit your changes (see [Commit Messages](#commit-messages))
5. Push to your fork: `git push origin feature/your-feature-name`
6. [Submit a pull request](https://github.com/yourusername/aws-controltower-soc2-automation/compare)

### Branch Naming Conventions

* `feature/<feature-name>` - For new features
* `fix/<bug-name>` - For bug fixes
* `docs/<doc-change>` - For documentation updates
* `refactor/<refactor-name>` - For code refactoring
* `test/<test-name>` - For test additions or modifications

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

Types:
* `feat`: A new feature
* `fix`: A bug fix
* `docs`: Documentation only changes
* `style`: Changes that do not affect the meaning of the code
* `refactor`: A code change that neither fixes a bug nor adds a feature
* `perf`: A code change that improves performance
* `test`: Adding missing tests or correcting existing tests
* `chore`: Changes to the build process or auxiliary tools

Example:
```
feat(security): add automatic rotation of IAM access keys

Implements a new feature that automatically rotates IAM access keys 
every 90 days to enhance security posture.

Closes #123
```

## Coding Standards

### Bash Style Guide

1. **Script Header**: All scripts should start with a header:
   ```bash
   #!/bin/bash
   # script_name.sh - Brief description
   #
   # Description:
   #   Detailed description of what the script does
   #
   # Usage:
   #   ./script_name.sh [options]
   #
   # Parameters:
   #   -p PARAM   Description of parameter (required/optional)
   #   -h         Display help message and exit
   ```

2. **Indentation**: Use 4 spaces for indentation, not tabs.

3. **Line Length**: Keep lines to a maximum of 80 characters when possible.

4. **Variable Names**:
   * Use lowercase with underscores for variables: `user_name`, not `userName`
   * Use all uppercase for constants: `MAX_RETRIES`
   * Use descriptive names: `aws_account_id` not `id`

5. **Functions**:
   * Always use function keyword: `function my_function() { ... }`
   * Include descriptive comments above each function
   * Keep functions focused on a single task

6. **Error Handling**:
   * Check return codes after commands: `if ! command; then ...`
   * Use descriptive error messages that include the failed command
   * Direct error messages to stderr: `echo "Error message" >&2`

7. **Command Substitution**:
   * Use `$(command)` instead of backticks

8. **Quote Variables**:
   * Always quote variables: `"$variable"`, not $variable
   * Exception: When you specifically need word splitting

9. **Parameter Validation**:
   * Validate all parameters at the beginning of scripts
   * Provide meaningful error messages for invalid inputs

10. **Comments**:
    * Comment complex operations
    * Avoid unnecessary comments for obvious operations
    * Use `# TODO:` to mark future improvements

### Security Standards

1. Never hardcode credentials in scripts
2. Use the principle of least privilege for IAM roles and policies
3. Always check user input for injection attacks
4. Validate and sanitize all parameters
5. Log security-relevant actions
6. Avoid storing sensitive information in environment variables

## Testing Guidelines

### Manual Testing

Before submitting your PR, manually test your changes in a development AWS environment. Document your testing methodology in the PR.

Recommended test flow:
1. Run each script individually with sample inputs
2. Run the full automation sequence in a test account
3. Verify the resulting AWS environment against SOC 2 requirements

### Automated Testing

For any new functionality:
1. Add appropriate test cases in the `tests/` directory
2. Ensure all existing tests pass with your changes

### Test Account Safety

When testing:
1. Use a dedicated testing AWS account (never production)
2. Be cautious about cost implications of your tests
3. Clean up all resources after testing
4. Document any specific test setup required in your PR

## Security Best Practices

Security is paramount in this project. When contributing, consider:

1. **Least Privilege**: Any IAM roles or policies should follow the principle of least privilege
2. **Secrets Management**: Never commit AWS credentials, secrets, or personal data
3. **Input Validation**: Always validate user inputs to prevent injection attacks
4. **Secure Defaults**: Default configurations should be secure by default
5. **Auditability**: Actions should be logged appropriately for audit purposes
6. **SOC 2 Alignment**: Changes should maintain or enhance SOC 2 compliance

## Documentation

Good documentation is crucial for this project. When contributing:

1. Update the README.md if your changes affect user-facing functionality
2. Add comments to explain complex or non-obvious code sections
3. Create or update wiki pages for architectural or implementation details
4. Add examples if your feature requires specific usage patterns
5. Include relevant AWS documentation links

## Community

### Communication Channels

* GitHub Issues: For bug reports and feature requests

---

Thank you for contributing to the AWS Control Tower SOC 2 Automation Suite! Your efforts help organizations build secure, compliant cloud environments more efficiently.