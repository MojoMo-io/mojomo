#!/usr/bin/env python3
"""Minimal but correct markdown -> HTML for the docs pages.

Handles: headings, blockquotes, tables (with separator rows), lists,
inline code, bold, links, hr, and paragraph joining (a paragraph is a run of
consecutive non-blank lines, not one line each).
"""
import re, sys, html

def inline(t):
    # escape first, then re-apply markup so we never double-escape
    t = html.escape(t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
    return t

def is_sep(cells):
    return all(re.fullmatch(r':?-{2,}:?', c.strip()) for c in cells if c.strip() != '') and any(c.strip() for c in cells)

def convert(md):
    out, i = [], 0
    lines = md.split('\n')
    n = len(lines)
    while i < n:
        ln = lines[i]
        s = ln.strip()

        if s == '':
            i += 1
            continue

        # table: header row followed by separator row
        if s.startswith('|') and i + 1 < n and lines[i+1].strip().startswith('|'):
            hdr = [c.strip() for c in s.strip('|').split('|')]
            sep = [c.strip() for c in lines[i+1].strip().strip('|').split('|')]
            if is_sep(sep):
                out.append('<table>')
                out.append('<thead><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in hdr) + '</tr></thead>')
                out.append('<tbody>')
                i += 2
                while i < n and lines[i].strip().startswith('|'):
                    cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                    out.append('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in cells) + '</tr>')
                    i += 1
                out.append('</tbody></table>')
                continue

        if s.startswith('# '):
            out.append(f'<h1>{inline(s[2:])}</h1>'); i += 1; continue
        if s.startswith('## '):
            out.append(f'<h2>{inline(s[3:])}</h2>'); i += 1; continue
        if s.startswith('### '):
            out.append(f'<h3>{inline(s[4:])}</h3>'); i += 1; continue
        if s == '---':
            out.append('<hr>'); i += 1; continue

        # blockquote: gather consecutive '>' lines
        if s.startswith('>'):
            buf = []
            while i < n and lines[i].strip().startswith('>'):
                buf.append(lines[i].strip().lstrip('>').strip())
                i += 1
            out.append('<blockquote>' + inline(' '.join(buf)) + '</blockquote>')
            continue

        # list: gather consecutive '- ' lines
        if s.startswith('- '):
            out.append('<ul>')
            while i < n and lines[i].strip().startswith('- '):
                out.append('<li>' + inline(lines[i].strip()[2:]) + '</li>')
                i += 1
            out.append('</ul>')
            continue

        # numbered list
        if re.match(r'^\d+\.\s', s):
            out.append('<ol>')
            while i < n and re.match(r'^\d+\.\s', lines[i].strip()):
                out.append('<li>' + inline(re.sub(r'^\d+\.\s+', '', lines[i].strip())) + '</li>')
                i += 1
            out.append('</ol>')
            continue

        # paragraph: join consecutive plain lines
        buf = []
        while i < n:
            t = lines[i].strip()
            if t == '' or t.startswith(('#', '>', '|', '- ')) or t == '---' or re.match(r'^\d+\.\s', t):
                break
            buf.append(t)
            i += 1
        out.append('<p>' + inline(' '.join(buf)) + '</p>')

    return '\n'.join(out)

if __name__ == '__main__':
    md = open(sys.argv[1]).read()
    print(convert(md))
