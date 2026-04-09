#!/bin/bash
# Download optional libraries for PDF and Word resume parsing.
# Run once after cloning: bash setup-libs.sh

set -e
LIB_DIR="src/lib"
mkdir -p "$LIB_DIR"

echo "Downloading pdf.js..."
curl -fsSL "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" \
  -o "$LIB_DIR/pdf.min.js"
curl -fsSL "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js" \
  -o "$LIB_DIR/pdf.worker.min.js"

echo "Downloading mammoth.js (Word parser)..."
curl -fsSL "https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js" \
  -o "$LIB_DIR/mammoth.browser.min.js"

echo ""
echo "✓ Libraries downloaded to $LIB_DIR/"
echo "  Reload the extension in chrome://extensions"
