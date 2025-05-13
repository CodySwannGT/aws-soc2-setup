#!/bin/bash

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

# Test Step 13
if prompt_yes_no "Do you want to provision additional accounts?" "n"; then
    echo "User wants to provision accounts"
    
    # Loop to provision multiple accounts
    while prompt_yes_no "Do you want to provision an account?"; do
        echo "User wants to provision another account"
    done
fi