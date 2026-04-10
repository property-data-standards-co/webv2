#!/usr/bin/env bash
# Sync specs from the spec repo into the website content directory.
# Called by CI or manually before build.
set -euo pipefail

SPEC_REPO="https://github.com/property-data-standards-co/spec.git"
SPEC_DIR="$(mktemp -d)"
CONTENT_DIR="$(dirname "$0")/../src/content/docs/specs"

echo "📥 Cloning spec repo..."
git clone --depth 1 "$SPEC_REPO" "$SPEC_DIR"

# Function to add frontmatter to a spec file
add_frontmatter() {
  local src="$1"
  local dest="$2"
  local filename
  filename="$(basename "$src" .md)"

  # Extract the first heading for the title
  local heading
  heading=$(grep -m1 '^# ' "$src" | sed 's/^# //')

  # Extract description from first paragraph after the metadata block
  local description="PDTF 2.0 specification document."

  # Write frontmatter + original content (excluding the first H1 heading)
  {
    echo "---"
    echo "title: \"${heading}\""
    echo "description: \"${description}\""
    echo "---"
    echo ""
    # Remove the first occurrence of an H1
    awk '
      BEGIN { h1_removed = 0 }
      /^# / {
        if (!h1_removed) {
          h1_removed = 1
          next
        }
      }
      { print }
    ' "$src"
  } > "$dest"
}

# Sync protocol specs
echo "📄 Syncing protocol specs..."
for spec in "$SPEC_DIR"/*.md; do
  filename="$(basename "$spec")"
  # Skip README and LICENSE
  [[ "$filename" == "README.md" || "$filename" == "LICENSE" ]] && continue
  add_frontmatter "$spec" "$CONTENT_DIR/$filename"
  python3 "$(dirname "$0")/fix-links.py" "$CONTENT_DIR/$filename"
  echo "  ✓ $filename"
done

# NOTE: impl specs are deliberately excluded from the published site.
# They are internal implementation docs, not for public consumption.

# Sync diagrams
if [ -d "$SPEC_DIR/diagrams" ]; then
  echo "📊 Syncing diagrams..."
  mkdir -p "$CONTENT_DIR/diagrams"
  cp -r "$SPEC_DIR/diagrams/"* "$CONTENT_DIR/diagrams/" 2>/dev/null || true
fi

# Regenerate llms-full.txt
echo "📝 Regenerating llms-full.txt..."
LLMS_FULL="$(dirname "$0")/../public/llms-full.txt"
{
  cat "$(dirname "$0")/../public/llms.txt"
  echo ""
  echo "---"
  echo ""
  echo "# Full Specification Text"
  echo ""
  for spec in "$SPEC_DIR"/00-*.md "$SPEC_DIR"/01-*.md "$SPEC_DIR"/02-*.md "$SPEC_DIR"/03-*.md "$SPEC_DIR"/04-*.md "$SPEC_DIR"/06-*.md "$SPEC_DIR"/07-*.md "$SPEC_DIR"/13-*.md "$SPEC_DIR"/14-*.md; do
    [ -f "$spec" ] || continue
    echo "---"
    echo ""
    cat "$spec"
    echo ""
  done
  # NOTE: impl specs excluded from public llms-full.txt (internal only)
} > "$LLMS_FULL"
echo "  ✓ llms-full.txt ($(wc -c < "$LLMS_FULL") bytes)"

# Cleanup
rm -rf "$SPEC_DIR"

echo "✅ Spec sync complete."
