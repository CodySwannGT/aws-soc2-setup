# Enterprise Upgrade Implementation Prompt Chain

## Overview
This document provides a structured prompt chain for upgrading the AWS Control Tower SOC 2 Automation Suite to enterprise-grade standards while maintaining the ability to completely rollback all changes for testing purposes.

**CRITICAL**: Each phase builds on the previous one. Always create backups and test in a non-production environment first.

## Prerequisites
- Git repository with clean working tree
- Test AWS account(s) separate from production
- AWS CLI configured with appropriate credentials
- Understanding of current working implementation

---

## Phase 0: Setup Safety Net and Rollback Infrastructure

### Prompt 0.1: Create Backup and Version Control
```
Create a comprehensive backup system for the AWS Control Tower setup:
1. Create a new git branch called 'enterprise-upgrade'
2. Create scripts/backup/backup_current_state.sh that captures:
   - Current AWS Organization structure
   - All enabled services and their configurations
   - IAM Identity Center users and groups
   - Control Tower controls status
   - KMS keys and policies
   - All account configurations
3. Store backups in .backup/[timestamp]/ directory
4. Add .backup to .gitignore
5. Create a backup validation script that verifies backup completeness
```

### Prompt 0.2: Create Complete Teardown Script
```
Create a master teardown script (scripts/teardown/complete_teardown.sh) that can completely remove all AWS resources created by this suite:

1. In REVERSE order of creation:
   - Delete all created AWS accounts (except management)
   - Disable all security services (GuardDuty, Security Hub, etc.)
   - Remove all KMS keys and aliases
   - Delete all backup plans and vaults
   - Remove all IAM Identity Center users and groups
   - Delete all organizational units
   - Deregister OUs from Control Tower
   - Disable Control Tower (if possible)
   - Remove all created IAM roles and policies

2. Include safety features:
   - Require explicit confirmation for each major deletion
   - Create a dry-run mode that shows what would be deleted
   - Log all actions to teardown_[timestamp].log
   - Ability to skip certain components via flags
   - Save state before each deletion for potential recovery

3. Add cost estimation showing potential savings from teardown
4. Include post-teardown validation to ensure clean state
```

### Prompt 0.3: Create Testing Framework Foundation
```
Create a testing framework structure:
1. Create tests/ directory with subdirectories:
   - tests/unit/ (for individual function tests)
   - tests/integration/ (for workflow tests)
   - tests/e2e/ (for end-to-end tests)
   - tests/fixtures/ (for test data)
   - tests/mocks/ (for AWS API mocks)

2. Set up bats (Bash Automated Testing System):
   - Create tests/setup_test_env.sh to install bats
   - Create tests/test_helper.bash with common test functions
   - Add example test for one simple function

3. Create tests/validate_deployment.sh that checks:
   - All expected AWS resources exist
   - Security services are properly configured
   - IAM permissions are correct
   - Compliance controls are enabled

4. Add Makefile with test targets
```

---

## Phase 1: Core Infrastructure Improvements

### Prompt 1.1: Create Shared Library
```
Refactor common functionality into a shared library:

1. Create lib/common.sh with these functions extracted from existing scripts:
   - check_aws_cli()
   - check_jq_installed()
   - verify_aws_credentials()
   - get_account_id()
   - prompt_yes_no()
   - update_checklist()
   - retry_with_backoff() (new function for API retry logic)
   - sanitize_input() (new function for input validation)

2. Create lib/aws_api.sh with AWS-specific helpers:
   - safe_aws_call() (wrapper with retry logic)
   - check_service_enabled()
   - wait_for_operation()
   - get_organization_info()

3. Create lib/logging.sh with logging functions:
   - log_info()
   - log_error()
   - log_debug()
   - setup_log_file()

4. Update all existing scripts to source and use these libraries
5. Add unit tests for each library function
```

### Prompt 1.2: Add Configuration Management
```
Implement configuration file support:

1. Create config/config.yaml.template with all configurable values:
   - AWS regions
   - Profile names
   - Organizational unit names
   - Security service settings
   - Retry limits and delays
   - Email domains
   - Backup retention periods

2. Create lib/config.sh to:
   - Load configuration from YAML
   - Validate configuration values
   - Merge with command-line arguments (CLI takes precedence)
   - Support environment-specific configs (dev, staging, prod)

3. Create scripts/generate_config.sh that:
   - Prompts for all configuration values
   - Validates inputs
   - Generates config.yaml from template

4. Update all scripts to use configuration values
5. Add config validation tests
```

### Prompt 1.3: Implement Error Handling Standards
```
Standardize error handling across all scripts:

1. Create lib/error_handling.sh with:
   - Standard error codes (enum-like constants)
   - Error reporting functions
   - Cleanup handlers for each script
   - Signal trapping (SIGINT, SIGTERM)

2. Update all scripts to:
   - Use 'set -euo pipefail' consistently
   - Implement proper cleanup on exit
   - Use standard error codes
   - Log errors before exiting

3. Add error injection tests to verify handling
4. Create documentation for error codes
```

---

## Phase 2: Testing and Validation

### Prompt 2.1: Implement Unit Tests
```
Create comprehensive unit tests:

1. For each function in lib/*.sh, create corresponding test in tests/unit/
2. Mock AWS CLI calls using function overrides
3. Test edge cases:
   - Invalid inputs
   - API failures
   - Missing dependencies
   - Permission errors

4. Create test data fixtures for common scenarios
5. Aim for 80% code coverage initially
```

### Prompt 2.2: Create Integration Tests
```
Develop integration tests for key workflows:

1. Create tests/integration/ test files for:
   - SSO profile configuration flow
   - Security service enablement
   - Account provisioning
   - Organizational unit creation

2. Use AWS LocalStack or moto for local testing where possible
3. For tests requiring real AWS:
   - Mark as 'requires-aws'
   - Use minimal resources
   - Include automatic cleanup

4. Add test orchestration script
```

### Prompt 2.3: Build Validation Suite
```
Create post-deployment validation:

1. Create scripts/validate/validate_deployment.sh that checks:
   - Control Tower landing zone health
   - All security services status
   - IAM Identity Center configuration
   - Cross-account role assumptions
   - Backup plan execution
   - Compliance control status

2. Generate validation report with:
   - Pass/fail for each check
   - Remediation steps for failures
   - Overall compliance score

3. Add scheduled validation via CloudWatch Events
```

---

## Phase 3: CI/CD and Automation

### Prompt 3.1: GitHub Actions Setup
```
Create CI/CD pipeline:

1. Create .github/workflows/ci.yml with:
   - Linting (shellcheck for bash scripts)
   - Unit test execution
   - Security scanning (checkov, tfsec)
   - Documentation generation

2. Create .github/workflows/integration.yml with:
   - Integration tests on PR
   - Deployment to test account
   - Validation suite execution
   - Automatic rollback on failure

3. Create .github/workflows/release.yml with:
   - Semantic versioning
   - Change log generation
   - GitHub release creation
   - Documentation updates

4. Add branch protection rules
```

### Prompt 3.2: Add Monitoring and Observability
```
Implement comprehensive monitoring:

1. Create lib/monitoring.sh with:
   - CloudWatch Logs integration
   - Custom metric publishing
   - Execution time tracking
   - Error rate monitoring

2. Create cloudformation/monitoring-stack.yaml with:
   - Log groups for script execution
   - SNS topics for alerts
   - CloudWatch dashboards
   - Lambda for alert processing

3. Update all scripts to:
   - Send logs to CloudWatch
   - Publish execution metrics
   - Report errors to SNS

4. Create monitoring setup script
```

### Prompt 3.3: Implement Rate Limiting
```
Add API rate limiting protection:

1. Enhance lib/aws_api.sh with:
   - Rate limit detection
   - Adaptive backoff based on API responses
   - Parallel execution control
   - Request queuing for bulk operations

2. Add configuration for:
   - Max requests per second per API
   - Parallel execution limits
   - Retry strategies per service

3. Create tests for rate limiting behavior
4. Add metrics for API throttling
```

---

## Phase 4: Enterprise Features

### Prompt 4.1: Add Rollback Capabilities
```
Implement rollback functionality:

1. Create lib/state_management.sh for:
   - State capture before changes
   - State comparison
   - Rollback plan generation

2. Create scripts/rollback/rollback_changes.sh that can:
   - Rollback to previous state from backup
   - Selective component rollback
   - Dry-run mode
   - Validation after rollback

3. Integrate with main scripts:
   - Auto-backup before changes
   - Rollback on critical failures
   - Manual rollback triggers

4. Add rollback tests
```

### Prompt 4.2: Enterprise Configuration Templates
```
Create enterprise-ready templates:

1. Create templates/enterprise/ with:
   - Large organization OU structure
   - Advanced security controls
   - Compliance-specific configurations
   - Multi-region setups

2. Create template selection wizard:
   - Interactive questionnaire
   - Recommendation engine
   - Template customization
   - Validation of selections

3. Add template testing
```

### Prompt 4.3: Compliance Reporting
```
Build compliance reporting system:

1. Create scripts/compliance/generate_soc2_report.sh that:
   - Maps all controls to SOC 2 criteria
   - Checks control effectiveness
   - Generates evidence collection
   - Creates audit-ready reports

2. Add automated report scheduling
3. Create compliance dashboard
4. Add report templates
```

---

## Phase 5: Testing and Finalization

### Prompt 5.1: End-to-End Testing
```
Create comprehensive E2E test suite:

1. Create tests/e2e/full_deployment_test.sh that:
   - Runs complete setup in test account
   - Validates all components
   - Tests failure scenarios
   - Measures execution time
   - Runs complete teardown

2. Add test scenarios for:
   - Fresh installation
   - Upgrade from current version
   - Partial completion recovery
   - Multi-region deployment

3. Create test report generator
```

### Prompt 5.2: Performance Optimization
```
Optimize for large-scale deployments:

1. Profile current implementation to find bottlenecks
2. Implement parallel processing where safe:
   - Security service enablement across accounts
   - Control application across OUs
   - Multi-account provisioning

3. Add caching for frequently used API calls
4. Create performance benchmarks
5. Document scaling limits
```

### Prompt 5.3: Documentation and Training
```
Create comprehensive documentation:

1. Generate API documentation from code
2. Create troubleshooting guide with:
   - Common errors and solutions
   - Debug procedures
   - FAQ section

3. Create visual architecture diagrams
4. Write upgrade guide from current version
5. Create training materials:
   - Video walkthrough script
   - Workshop materials
   - Quick start guide
```

---

## Phase 6: Final Testing and Rollback Verification

### Prompt 6.1: Complete System Test
```
Perform final comprehensive testing:

1. Run full deployment in fresh test account
2. Verify all enterprise features work
3. Test all error scenarios
4. Validate monitoring and alerting
5. Run complete teardown
6. Verify account is completely clean
7. Check AWS billing for any remaining resources
8. Document any manual cleanup needed
```

### Prompt 6.2: Production Readiness Checklist
```
Create and execute final checklist:

1. All tests passing
2. Documentation complete
3. Rollback tested successfully
4. Performance benchmarks met
5. Security scan clean
6. Code review completed
7. Change log updated
8. Version tagged
9. Release notes prepared
10. Deployment guide updated
```

---

## Critical Safety Notes

1. **ALWAYS test in non-production first**
2. **Keep current version backup until new version is proven**
3. **Test rollback procedures before making changes**
4. **Monitor AWS costs during testing**
5. **Use CloudTrail to audit all changes**
6. **Document any manual steps required**
7. **Have AWS support contact ready**

## Cost Management During Testing

To minimize costs during testing:
1. Use smallest instance types where applicable
2. Delete resources immediately after testing
3. Set up billing alerts
4. Use AWS Cost Explorer to track spending
5. Consider using AWS credits for testing
6. Run tests during off-peak hours
7. Clean up all resources after each test run

---

This prompt chain ensures that all improvements are made systematically while maintaining the ability to completely rollback changes. Each phase should be completed and tested before moving to the next.