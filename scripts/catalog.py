"""Refresh song metadata only. Never download audio or artwork."""
import json
import urllib.parse
import urllib.request
from pathlib import Path

ARTISTS = [('BLACKPINK','girl'), ('TWICE','girl'), ('aespa','girl'), ('IVE','girl'), ('BTS','boy'), ('Stray Kids','boy'), ('SEVENTEEN','boy'), ('TOMORROW X TOGETHER','boy')]
songs = []
for artist, category in ARTISTS:
    url = 'https://itunes.apple.com/search?' + urllib.parse.urlencode(dict(term=artist, country='TW', entity='song', limit=18))
    data = json.load(urllib.request.urlopen(url, timeout=30))
    selected = []
    names = set()
    for song in data['results']:
        name = song['trackName']
        if song.get('artistName', '').casefold() != artist.casefold() or not song.get('previewUrl'):
            continue
        if any(word in name.lower() for word in ['remix','instrumental','live','japanese','english ver','sped up']):
            continue
        if name.casefold() in names:
            continue
        names.add(name.casefold())
        selected.append(dict(id=song['trackId'], title=name, artist=song['artistName'], album=song['collectionName'], artwork=song.get('artworkUrl100',''), preview=song['previewUrl'], url=song['trackViewUrl'], year=song['releaseDate'][:4], category=category))
        if len(selected) == 5:
            break
    songs.extend(selected)
    print(f'{artist}: {len(selected)} songs')
if len(songs) < 20:
    raise RuntimeError('Insufficient catalog results; preserve previous catalog.')
dest = Path(__file__).resolve().parents[1] / 'seeds' / 'catalog.json'
dest.write_text(json.dumps(songs, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Saved {len(songs)} metadata records, no media downloaded.')
