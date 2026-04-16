import sys, re

def fix_links(content, in_impl=False):
    def repl(m):
        text = m.group(1)
        url = m.group(2)
        
        # skip external and anchors
        if url.startswith('http') or url.startswith('mailto:') or url.startswith('#'):
            return m.group(0)
            
        if url.startswith('/web/'):
            return m.group(0)

        # Image / asset paths: rewrite to /web/-rooted public asset URL
        # e.g. `diagrams/entity-graph.png` -> `/web/diagrams/entity-graph.png`
        asset_exts = ('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf')
        if url.lower().endswith(asset_exts):
            clean = re.sub(r'^[\./]+', '', url).lstrip('/')
            return f'[{text}](/web/{clean})'
            
        clean_url = url.replace('.md', '')
        clean_url = re.sub(r'^[\./]+', '', clean_url)
        
        if clean_url.endswith('/'):
            clean_url = clean_url[:-1]
            
        if clean_url in ['00-architecture-overview', '01-entity-graph', '02-vc-data-model', '03-did-methods', '04-trusted-issuer-registry', '06-key-management', '07-state-assembly', '13-reference-implementations', '14-credential-revocation', '15-conformance-testing']:
            return f'[{text}](/web/specs/{clean_url}/)'
            
        if clean_url in ['05-hosted-adapter-services', '12-adapter-access-control']:
            return f'{text} (Coming Soon)'
            
        # impl specs are not published — strip the link
        if clean_url in ['03-did-infrastructure-impl', '04-tir-impl', '06-key-management-impl', '14-credential-revocation-impl']:
            return text
            
        # fallback
        return f'[{text}](/web/specs/{clean_url}/)'
        
    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', repl, content)

if __name__ == "__main__":
    filepath = sys.argv[1]
    in_impl = 'impl' in filepath
    with open(filepath, 'r') as f:
        content = f.read()
    content = fix_links(content, in_impl)
    with open(filepath, 'w') as f:
        f.write(content)
