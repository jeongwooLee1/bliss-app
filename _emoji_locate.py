import re, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
emoji_pattern = re.compile(r'[\U0001F000-\U0001FFFF☀-➿]')
target_files = [
    'src/components/Timeline/ReservationModal.jsx',
    'src/components/Timeline/SaleForm.jsx',
    'src/components/Messages/MessagesPage.jsx',
    'src/components/Timeline/TimelinePage.jsx',
]
for path in target_files:
    if not os.path.exists(path): continue
    with open(path, encoding='utf-8') as fp:
        for i, line in enumerate(fp, 1):
            if emoji_pattern.search(line):
                emos = ''.join(emoji_pattern.findall(line))
                preview = line.strip()
                if len(preview) > 130: preview = preview[:130] + '...'
                print(f'{path}:{i} [{emos}] {preview}')
