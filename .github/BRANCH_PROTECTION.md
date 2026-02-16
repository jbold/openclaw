# Branch Protection Rules

This document outlines the branch protection rules for the OpenClaw fork. These rules help maintain code quality and prevent accidental pushes to protected branches.

## Protected Branches

### `main` Branch (Production)

- **Require pull request reviews before merging**: ✅
- **Require status checks to pass before merging**: ✅
  - `Security Scan`
  - `Lint & Format`
  - `Build`
  - `Unit Tests`
  - `All Checks`
- **Require branches to be up to date before merging**: ✅
- **Require conversation resolution before merging**: ✅
- **Restrict pushes that create files over 100 MB**: ✅
- **Do not allow bypassing the above settings**: ✅
- **Allow force pushes**: ❌
- **Allow deletions**: ❌

### `staging` Branch (Staging/Preview)

- **Require pull request reviews before merging**: ✅
- **Require status checks to pass before merging**: ✅
  - `Security Scan`
  - `Lint & Format`
  - `Build`
  - `Unit Tests`
  - `All Checks`
- **Require branches to be up to date before merging**: ✅
- **Require conversation resolution before merging**: ✅
- **Restrict pushes that create files over 100 MB**: ✅
- **Do not allow bypassing the above settings**: ✅
- **Allow force pushes**: ❌
- **Allow deletions**: ❌

## Git Workflow

```
feature/xxx → PR → staging → PR → main
```

1. **Feature Development**: Create feature branches from `main`

   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   ```

2. **Staging Deployment**: PR to `staging` for testing

   ```bash
   # After feature is ready
   gh pr create --base staging --title "feat: your feature description"
   ```

3. **Production Deployment**: PR from `staging` to `main`
   ```bash
   # After staging testing is complete
   gh pr create --base main --head staging --title "deploy: staging to main"
   ```

## Setting Up Branch Protection (Manual)

Since this is a public repository, branch protection rules need to be configured manually by repository administrators:

### Using GitHub CLI

```bash
# Protect main branch
gh api repos/:owner/:repo/branches/main/protection \
  --method PUT \
  --input - <<< '{
    "required_status_checks": {
      "strict": true,
      "contexts": ["Security Scan", "Lint & Format", "Build", "Unit Tests", "All Checks"]
    },
    "enforce_admins": true,
    "required_pull_request_reviews": {
      "required_approving_review_count": 1,
      "dismiss_stale_reviews": true,
      "require_code_owner_reviews": false
    },
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "required_conversation_resolution": true
  }'

# Protect staging branch
gh api repos/:owner/:repo/branches/staging/protection \
  --method PUT \
  --input - <<< '{
    "required_status_checks": {
      "strict": true,
      "contexts": ["Security Scan", "Lint & Format", "Build", "Unit Tests", "All Checks"]
    },
    "enforce_admins": true,
    "required_pull_request_reviews": {
      "required_approving_review_count": 1,
      "dismiss_stale_reviews": true,
      "require_code_owner_reviews": false
    },
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "required_conversation_resolution": true
  }'
```

### Using GitHub Web Interface

1. Go to **Settings** > **Branches**
2. Click **Add rule**
3. Configure the settings as outlined above for each branch

## CI/CD Integration

The CI pipeline must pass all required checks before merging:

- ✅ **Security Scan**: Gitleaks secrets detection
- ✅ **Lint & Format**: oxlint and oxfmt validation
- ✅ **Build**: Successful TypeScript compilation
- ✅ **Unit Tests**: All unit tests pass
- ✅ **E2E Tests**: Run for pushes or when labeled (optional)

## Emergency Procedures

In case of emergency deployments:

1. **Never bypass branch protection** - it exists for good reasons
2. **Create hotfix branch** from `main` if needed:
   ```bash
   git checkout main
   git checkout -b hotfix/critical-fix
   # Make minimal changes
   gh pr create --base main --label "hotfix"
   ```
3. **Fast-track review** but still require CI to pass
4. **Follow up** with proper testing and documentation

## Enforcement

These rules are enforced through:

- ⚙️ **GitHub branch protection** (manual setup required)
- 🤖 **Pre-commit hooks** (`.pre-commit-config.yaml`)
- 🚀 **CI/CD pipeline** (`.github/workflows/ci.yml`)
- 🔄 **Code review process** (required PR reviews)

---

_For questions about branch protection or to request changes to these rules, please open an issue._
