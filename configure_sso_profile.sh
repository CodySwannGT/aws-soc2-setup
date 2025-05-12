#!/bin/bash
# Configure AWS CLI profile for IAM Identity Center (SSO) access using AWS CLI v2

# Run the interactive SSO configuration
# It will prompt you for:
# 1. SSO start URL
# 2. SSO Region 
# 3. The profile name you want to use (e.g., thehobbyhome-admin)
# 4. Default CLI Region
# 5. Default output format
aws configure sso

echo "SSO profile configured successfully."
echo "To use your new profile, run: aws sso login --profile <your-profile-name>"
echo "Then verify with: aws sts get-caller-identity --profile <your-profile-name>"