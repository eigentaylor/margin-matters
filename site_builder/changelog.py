"""Changelog builder module for compiling daily changelog entries into a single page."""

import re
from pathlib import Path
from datetime import datetime

from .config import OUT_DIR, LAST_UPDATED
from .io_utils import write_text


def simple_markdown_to_html(text):
    """Simple markdown to HTML converter for basic formatting.
    
    Handles:
    - Headings (## and ###)
    - Bullet lists (- or *)
    - Bold (**text**)
    - Italic (*text*)
    - Links ([text](url))
    - Code blocks (```...```)
    """
    lines = text.split('\n')
    html_lines = []
    in_list = False
    in_code_block = False
    code_lines = []
    
    for line in lines:
        # Handle code blocks
        if line.strip().startswith('```'):
            if in_code_block:
                # End code block
                code_content = '\n'.join(code_lines)
                html_lines.append(f"<pre><code>{code_content}</code></pre>")
                code_lines = []
                in_code_block = False
            else:
                # Start code block
                in_code_block = True
            continue
        
        if in_code_block:
            code_lines.append(line)
            continue
        
        # Handle headings
        if line.startswith('### '):
            if in_list:
                html_lines.append('</ul>')
                in_list = False
            html_lines.append(f"<h3>{line[4:].strip()}</h3>")
            continue
        elif line.startswith('## '):
            if in_list:
                html_lines.append('</ul>')
                in_list = False
            html_lines.append(f"<h2>{line[3:].strip()}</h2>")
            continue
        
        # Handle bullet lists
        if line.strip().startswith('- ') or line.strip().startswith('* '):
            if not in_list:
                html_lines.append('<ul>')
                in_list = True
            content = line.strip()[2:].strip()
            # Process inline formatting
            content = process_inline_formatting(content)
            html_lines.append(f"<li>{content}</li>")
            continue
        
        # End list if we have a non-list line
        if in_list and line.strip():
            html_lines.append('</ul>')
            in_list = False
        
        # Handle paragraphs
        if line.strip():
            content = process_inline_formatting(line.strip())
            html_lines.append(f"<p>{content}</p>")
        elif html_lines and not in_list:
            html_lines.append('<br/>')
    
    # Close any open list
    if in_list:
        html_lines.append('</ul>')
    
    return '\n'.join(html_lines)

def get_today_date_str():
    """Get today's date as a string in YYYY-MM-DD format."""
    return datetime.now().strftime("%Y-%m-%d")

def process_inline_formatting(text):
    """Process inline markdown formatting like bold, italic, links."""
    # Links: [text](url)
    text = re.sub(r'\[([^\]]+)\]\(([^\)]+)\)', r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>', text)
    
    # Bold: **text**
    text = re.sub(r'\*\*([^\*]+)\*\*', r'<strong>\1</strong>', text)
    
    # Italic: *text* (but not already in bold)
    text = re.sub(r'(?<!\*)\*([^\*]+)\*(?!\*)', r'<em>\1</em>', text)
    
    # Inline code: `code`
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    
    return text


def compile_changelog():
    """Compile all daily changelog entries into a single HTML page.
    
    Reads all YYYY-MM-DD.md files from the changelog directory,
    deletes empty ones, and generates a changelog.html page in docs/
    with entries in reverse chronological order (newest first).
    """
    changelog_dir = Path("changelog")
    
    # Check if changelog directory exists
    if not changelog_dir.exists():
        print("No changelog directory found, skipping changelog generation")
        return
    
    # Pattern to match YYYY-MM-DD.md files
    date_pattern = re.compile(r"^(\d{4}-\d{2}-\d{2})\.md$")
    
    entries = []
    files_to_delete = []
    
    todays_found = False
    
    # Collect all valid changelog entries
    for entry_file in sorted(changelog_dir.iterdir()):
        if not entry_file.is_file():
            continue
            
        match = date_pattern.match(entry_file.name)
        if not match:
            continue
        
        todays_found = (match.group(1) == get_today_date_str())

        date_str = match.group(1)
        content = entry_file.read_text(encoding="utf-8").strip()
        
        # Mark empty files for deletion
        if not content:
            files_to_delete.append(entry_file)
            continue
        
        # Parse date for sorting and display
        try:
            entry_date = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            print(f"Warning: Invalid date format in filename: {entry_file.name}")
            continue
        
        entries.append({
            "date": entry_date,
            "date_str": date_str,
            "content": content,
            "file": entry_file
        })
    
    # Delete empty changelog files
    for empty_file in files_to_delete:
        try:
            empty_file.unlink()
            print(f"Deleted empty changelog file: {empty_file.name}")
        except Exception as e:
            print(f"Warning: Could not delete {empty_file.name}: {e}")
        
    # If today's entry is missing, create a placeholder
    if not todays_found:
        print(f'No changelog entry found for today ({get_today_date_str()}), adding placeholder file.')
        placeholder_file = changelog_dir / f"{get_today_date_str()}.md"
        # create blank placeholder file
        placeholder_file.write_text("", encoding="utf-8")
    else:
        print(f'Changelog entry found for today ({get_today_date_str()}).')
    
    # Sort entries by date (newest first)
    entries.sort(key=lambda x: x["date"], reverse=True)
    
    # Build HTML content
    if not entries:
        changelog_html = "<p class='legend'>No changelog entries yet. Check back soon!</p>"
    else:
        changelog_items = []
        for entry in entries:
            # Format date nicely
            formatted_date = entry["date"].strftime("%B %d, %Y")
            
            # Convert markdown to HTML using simple converter
            content_html = simple_markdown_to_html(entry["content"])
            
            # Wrap entry in a styled container
            entry_html = f"""
                <div class='changelog-entry' style='margin-bottom: 24px; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: #111;'>
                    <div class='changelog-date' style='font-weight: bold; color: var(--accent); margin-bottom: 12px; font-size: 1.1em;'>
                        {formatted_date}
                    </div>
                    <div class='changelog-content'>
                        {content_html}
                    </div>
                </div>
            """
            changelog_items.append(entry_html)
        
        changelog_html = "\n".join(changelog_items)
    
    # Build the full HTML page
    full_html = f"""<!doctype html>
<html lang='en'>

<head>
    <meta charset='utf-8' />
    <meta name='viewport' content='width=device-width,initial-scale=1' />
    <title>Changelog • Margin Matters</title>
    <link rel='stylesheet' href='styles.css' />
    <link rel="icon" href="favicon.svg" />
    <script src="maintenance-check.js"></script>
</head>

<body>
    <div class='container'>
        <div id="header-placeholder"></div>
        <div id="back-to-map-placeholder"></div>
        <div class='card'>
            <h1 style='margin-top:0'>Changelog</h1>
            <p class='legend'>A record of changes, updates, and improvements to this site.</p>
            <hr style="margin:16px 0" />
            {changelog_html}
        </div>
        <div id="footer-placeholder"></div>
    </div>
    <script src="header.js"></script>
    <script src="footer.js"></script>
    <script src="back-to-map.js"></script>
    <script src="last-updated.js"></script>
</body>

</html>
"""
    
    # Write the changelog page
    output_path = OUT_DIR / "changelog.html"
    write_text(output_path, full_html)
    
    print(f"Generated changelog page with {len(entries)} entries")


if __name__ == "__main__":
    compile_changelog()
