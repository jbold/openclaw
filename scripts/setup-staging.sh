#!/bin/bash
set -euo pipefail

# OpenClaw Staging Profile Setup Script
# Creates and configures a staging profile for testing config changes and skills

STAGING_PROFILE="staging"
DEFAULT_PROFILE="default"
OPENCLAW_CONFIG_DIR="${HOME}/.openclaw"
STAGING_CONFIG_DIR="${OPENCLAW_CONFIG_DIR}/profiles/${STAGING_PROFILE}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if OpenClaw is installed
if ! command -v openclaw &> /dev/null; then
    log_error "OpenClaw CLI not found. Please install OpenClaw first."
    exit 1
fi

log_info "Setting up OpenClaw staging profile..."

# Create staging profile directory
if [[ -d "$STAGING_CONFIG_DIR" ]]; then
    log_warning "Staging profile already exists at $STAGING_CONFIG_DIR"
    read -p "Do you want to recreate it? (y/N): " -r
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Keeping existing staging profile"
        exit 0
    fi
    log_info "Removing existing staging profile..."
    rm -rf "$STAGING_CONFIG_DIR"
fi

log_info "Creating staging profile directory..."
mkdir -p "$STAGING_CONFIG_DIR"

# Copy default profile as base (if it exists)
DEFAULT_CONFIG_DIR="${OPENCLAW_CONFIG_DIR}/profiles/${DEFAULT_PROFILE}"
if [[ -d "$DEFAULT_CONFIG_DIR" ]]; then
    log_info "Copying default profile as base..."
    cp -r "$DEFAULT_CONFIG_DIR"/* "$STAGING_CONFIG_DIR/"
    log_success "Default profile copied to staging"
else
    log_warning "No default profile found. Creating staging profile from scratch..."
    mkdir -p "${STAGING_CONFIG_DIR}/skills"
    mkdir -p "${STAGING_CONFIG_DIR}/memory"
    mkdir -p "${STAGING_CONFIG_DIR}/cache"
fi

# Create staging-specific config adjustments
log_info "Creating staging configuration..."

# Create staging config template
cat > "${STAGING_CONFIG_DIR}/config.json" << 'EOF'
{
  "gateway": {
    "port": 3001,
    "host": "localhost"
  },
  "api": {
    "port": 3002
  },
  "browser": {
    "port": 3003
  },
  "ui": {
    "port": 3004
  },
  "profile": "staging",
  "environment": "staging",
  "debug": true,
  "logging": {
    "level": "debug",
    "file": "staging.log"
  }
}
EOF

# Create staging-specific environment variables
cat > "${STAGING_CONFIG_DIR}/.env.staging" << 'EOF'
# OpenClaw Staging Environment
OPENCLAW_PROFILE=staging
OPENCLAW_PORT=3001
OPENCLAW_API_PORT=3002
OPENCLAW_BROWSER_PORT=3003
OPENCLAW_UI_PORT=3004
OPENCLAW_LOG_LEVEL=debug
OPENCLAW_DEBUG=true

# Staging-specific settings
NODE_ENV=staging
EOF

# Create staging skills directory with a test skill
log_info "Setting up staging skills..."
mkdir -p "${STAGING_CONFIG_DIR}/skills/test-staging"

cat > "${STAGING_CONFIG_DIR}/skills/test-staging/SKILL.md" << 'EOF'
# Test Staging Skill

This is a test skill for the staging environment.

## Purpose
- Test skill loading in staging
- Verify configuration changes
- Debug skill development

## Commands
- `test-staging` - Run staging test
EOF

cat > "${STAGING_CONFIG_DIR}/skills/test-staging/skill.js" << 'EOF'
// Test staging skill
export default {
  name: 'test-staging',
  description: 'Test skill for staging environment',
  
  async execute(context, args) {
    return {
      success: true,
      message: 'Staging environment is working!',
      environment: process.env.OPENCLAW_PROFILE || 'default',
      timestamp: new Date().toISOString()
    };
  }
};
EOF

# Create staging memory directory with initial notes
mkdir -p "${STAGING_CONFIG_DIR}/memory"
cat > "${STAGING_CONFIG_DIR}/memory/README.md" << 'EOF'
# Staging Memory

This directory contains memory files for the staging profile.

## Purpose
- Test memory persistence
- Debug memory loading
- Validate configuration changes

## Notes
- Memory files are profile-specific
- Changes here don't affect production
- Use for testing new features safely
EOF

# Create staging startup script
cat > "${STAGING_CONFIG_DIR}/start-staging.sh" << 'EOF'
#!/bin/bash
# Quick start script for staging profile

echo "🚀 Starting OpenClaw in staging mode..."
echo "Profile: staging"
echo "Ports: Gateway(3001), API(3002), Browser(3003), UI(3004)"
echo "Debug: enabled"
echo ""

# Load staging environment
if [[ -f ~/.openclaw/profiles/staging/.env.staging ]]; then
    source ~/.openclaw/profiles/staging/.env.staging
fi

# Start OpenClaw with staging profile
openclaw --profile staging "$@"
EOF

chmod +x "${STAGING_CONFIG_DIR}/start-staging.sh"

log_success "Staging profile created successfully!"

# Summary
echo ""
log_info "Staging Profile Summary:"
echo "  📁 Profile Directory: $STAGING_CONFIG_DIR"
echo "  🌐 Gateway Port: 3001 (production: 3000)"
echo "  🔌 API Port: 3002"
echo "  🌐 Browser Port: 3003"
echo "  🖥️  UI Port: 3004"
echo "  📝 Log Level: debug"
echo ""

log_info "How to use:"
echo "  # Start with staging profile"
echo "  openclaw --profile staging"
echo ""
echo "  # Or use the convenience script"
echo "  $STAGING_CONFIG_DIR/start-staging.sh"
echo ""
echo "  # Run specific commands"
echo "  openclaw --profile staging gateway start"
echo "  openclaw --profile staging tui"
echo ""

log_info "Testing configuration changes:"
echo "  1. Edit configs in: $STAGING_CONFIG_DIR"
echo "  2. Test skills in: $STAGING_CONFIG_DIR/skills/"
echo "  3. Check logs in: $STAGING_CONFIG_DIR/staging.log"
echo "  4. Compare with production behavior"
echo ""

log_info "Staging URLs:"
echo "  Gateway: http://localhost:3001"
echo "  API: http://localhost:3002"
echo "  Browser: http://localhost:3003" 
echo "  UI: http://localhost:3004"
echo ""

log_warning "Remember:"
echo "  • Staging uses different ports to avoid conflicts"
echo "  • Changes here don't affect production"
echo "  • Always test skills in staging before production"
echo "  • Debug logs are more verbose in staging"

log_success "Staging profile setup complete! 🎉"