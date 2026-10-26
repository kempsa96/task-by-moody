#!/usr/bin/env python3
"""Crea index.html (versione app) da src/app.html (la stessa app usata dentro Claude)."""
import pathlib, datetime
root = pathlib.Path(__file__).resolve().parent.parent
app = (root / 'src' / 'app.html').read_text(encoding='utf-8')
stamp = datetime.datetime.utcnow().strftime('%Y%m%d%H%M')
head = f'''<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="tbm-build" content="{stamp}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Task">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#F2F2F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192-v2.png">
<link rel="apple-touch-icon" href="apple-touch-icon-v2.png">
<script src="supabase.js?v={stamp}"></script>
<script src="tbm-cloud.js?v={stamp}"></script>
</head>
<body>
'''
(root / 'index.html').write_text(head + app + '\n</body>\n</html>\n', encoding='utf-8')
print('index.html', stamp)
