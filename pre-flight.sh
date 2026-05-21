#!/bin/bash
# pre-flight.sh — Automated validation before packaging
# Run this before every release

set -e  # Exit on first error

echo "======================================"
echo "EM Dashboard — Pre-Flight Validation"
echo "======================================"
echo ""

ERRORS=0

# 1. Syntax check all JS files
echo "1. Checking JS syntax..."
for file in popup.js settings.js background.js src/*.js tests/*.js; do
  if [ -f "$file" ]; then
    if node --check "$file" 2>&1; then
      echo "   ✓ $file"
    else
      echo "   ✗ $file FAILED"
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

# 1c. Run unit tests
echo ""
echo "1c. Running unit tests..."
if node tests/parsers.test.js > /tmp/test-output.txt 2>&1; then
  SUMMARY=$(grep -E "passed.*failed" /tmp/test-output.txt | tail -1)
  echo "   ✓ parsers: $SUMMARY"
else
  echo "   ✗ Parser tests failed:"
  cat /tmp/test-output.txt | tail -10 | sed 's/^/      /'
  ERRORS=$((ERRORS + 1))
fi

if node tests/integration.test.js > /tmp/test-output.txt 2>&1; then
  SUMMARY=$(grep -E "passed.*failed" /tmp/test-output.txt | tail -1)
  echo "   ✓ integration: $SUMMARY"
else
  echo "   ✗ Integration tests failed:"
  cat /tmp/test-output.txt | tail -10 | sed 's/^/      /'
  ERRORS=$((ERRORS + 1))
fi

if node tests/burndown.test.js > /tmp/test-output.txt 2>&1; then
  SUMMARY=$(grep -E "passed.*failed" /tmp/test-output.txt | tail -1)
  echo "   ✓ burndown: $SUMMARY"
else
  echo "   ✗ Burndown tests failed:"
  cat /tmp/test-output.txt | tail -10 | sed 's/^/      /'
  ERRORS=$((ERRORS + 1))
fi

if node tests/timesheet.test.js > /tmp/test-output.txt 2>&1; then
  SUMMARY=$(grep -E "passed.*failed" /tmp/test-output.txt | tail -1)
  echo "   ✓ timesheet: $SUMMARY"
else
  echo "   ✗ Timesheet tests failed:"
  cat /tmp/test-output.txt | tail -10 | sed 's/^/      /'
  ERRORS=$((ERRORS + 1))
fi

# Extra: brace balance check (catches missing closing braces that node --check misses in ES modules)
echo ""
echo "1b. Checking brace balance..."
for file in popup.js settings.js background.js src/*.js; do
  if [ -f "$file" ]; then
    python3 -c "
code = open('$file').read()
diff = code.count('{') - code.count('}')
if diff != 0:
    print(f'   ✗ $file — unbalanced braces (diff={diff})')
    exit(1)
else:
    print(f'   ✓ $file')
" 2>&1
    if [ $? -ne 0 ]; then ERRORS=$((ERRORS + 1)); fi
  fi
done
echo ""

# 2. Element audit (check for missing getElementById refs)
echo "2. Running element audit..."
python3 - <<'EOF'
import re
import sys

try:
    with open('popup.js') as f:
        js = f.read()
    with open('popup.html') as f:
        html = f.read()
    
    all_ids = re.findall(r"getElementById\('([^']+)'\)", js)
    
    # Skip elements that are dynamically created (have a createElement nearby)
    # or are accessed with null-check pattern
    dynamic_elements = set()
    # Elements set via .id assignment
    for elem_id in set(all_ids):
        if re.search(rf"\.id\s*=\s*['\"]{re.escape(elem_id)}['\"]", js):
            dynamic_elements.add(elem_id)
    # Elements created via innerHTML templates (contain id= in a template literal)
    template_ids = re.findall(r'id=["\']([^"\']+)["\']', js)
    for tid in template_ids:
        dynamic_elements.add(tid)
    
    missing = [e for e in sorted(set(all_ids)) 
               if f'id="{e}"' not in html and e not in dynamic_elements]
    
    if missing:
        print(f"   ✗ Missing elements: {missing}")
        sys.exit(1)
    else:
        print("   ✓ All getElementById references valid")
        if dynamic_elements:
            print(f"   ℹ Dynamically created (OK): {sorted(dynamic_elements)}")
except Exception as e:
    print(f"   ✗ Element audit failed: {e}")
    sys.exit(1)
EOF

if [ $? -ne 0 ]; then
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 3. CSP compliance check (no inline scripts or handlers)
echo "3. Checking CSP compliance..."
CSP_VIOLATIONS=0

# Check for inline scripts in HTML files
for file in *.html; do
  if [ -f "$file" ]; then
    if grep -q '<script>' "$file" 2>/dev/null; then
      # Allow <script src="..."></script> but not <script>code</script>
      if grep -E '<script[^>]*>[^<]+</script>' "$file" >/dev/null 2>&1; then
        echo "   ✗ $file contains inline script"
        CSP_VIOLATIONS=$((CSP_VIOLATIONS + 1))
      fi
    fi
    
    # Check for inline event handlers
    if grep -E 'on(click|load|change|submit|keyup|keydown)=' "$file" >/dev/null 2>&1; then
      echo "   ✗ $file contains inline event handler"
      CSP_VIOLATIONS=$((CSP_VIOLATIONS + 1))
    fi
  fi
done

if [ $CSP_VIOLATIONS -eq 0 ]; then
  echo "   ✓ No CSP violations found"
else
  echo "   ✗ $CSP_VIOLATIONS CSP violations"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 4. Validate manifest.json
echo "4. Validating manifest.json..."
if python3 -m json.tool manifest.json > /dev/null 2>&1; then
  echo "   ✓ manifest.json is valid JSON"
else
  echo "   ✗ manifest.json is invalid"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 5. Check required files exist
echo "5. Checking required files..."
REQUIRED_FILES=(
  "manifest.json"
  "background.js"
  "popup.html"
  "popup.js"
  "settings.html"
  "settings.js"
  "styles.css"
  "theme-loader.js"
  "docs.html"
  "changelog.html"
  "privacy.html"
  "src/jira-api.js"
  "src/sentry-api.js"
  "src/metrics.js"
  "src/alerts.js"
  "src/privacy-mode.js"
)

MISSING=0
for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "   ✗ Missing: $file"
    MISSING=$((MISSING + 1))
  fi
done

if [ $MISSING -eq 0 ]; then
  echo "   ✓ All required files present"
else
  echo "   ✗ $MISSING files missing"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 6. Check icons
echo "6. Checking icons..."
ICON_MISSING=0
for size in 16 32 48 128; do
  if [ ! -f "icons/icon${size}.png" ]; then
    echo "   ✗ Missing: icons/icon${size}.png"
    ICON_MISSING=$((ICON_MISSING + 1))
  fi
done

if [ $ICON_MISSING -eq 0 ]; then
  echo "   ✓ All icons present"
else
  echo "   ✗ $ICON_MISSING icons missing"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 7. Version consistency check
echo "7. Checking version consistency..."
MANIFEST_VERSION=$(grep '"version"' manifest.json | sed -E 's/.*"version": "([^"]+)".*/\1/')
if grep -q "v${MANIFEST_VERSION}" changelog.html; then
  echo "   ✓ Version ${MANIFEST_VERSION} in changelog"
else
  echo "   ✗ Version ${MANIFEST_VERSION} missing from changelog"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Final report
echo "======================================"
if [ $ERRORS -eq 0 ]; then
  echo "✓ PRE-FLIGHT PASSED — Ready to package"
  echo "======================================"
  exit 0
else
  echo "✗ PRE-FLIGHT FAILED — $ERRORS error(s)"
  echo "Fix errors before packaging"
  echo "======================================"
  exit 1
fi
