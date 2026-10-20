#!/usr/bin/python3
"""Create a consistent MusicChallenge SQLite backup without copying live WAL files."""
import argparse,datetime,gzip,hashlib,json,os,pathlib,re,sqlite3,subprocess,tempfile,urllib.parse
parser=argparse.ArgumentParser()
parser.add_argument('--kind',choices=('daily','predeploy'),default='daily')
parser.add_argument('--commit',default='')
args=parser.parse_args()
if args.kind=='predeploy' and not re.fullmatch('[0-9a-f]{40}',args.commit):
 parser.error('predeploy requires a full commit SHA')
os.umask(0o077)
volume='rysz8kxvxnm6t5db8yssa1f5-songs-data'
dest=pathlib.Path('/data/coolify/backups/musicchallenge');dest.mkdir(parents=True,exist_ok=True,mode=0o700)
mount=subprocess.check_output(['/usr/bin/docker','volume','inspect',volume,'--format','{{.Mountpoint}}'],text=True).strip()
source=pathlib.Path(mount)/'songs.sqlite'
if not source.is_file():raise SystemExit('MusicChallenge database is missing; no backup made.')
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
name=args.kind+'-'+stamp+('-'+args.commit[:12] if args.kind=='predeploy' else '')
with tempfile.TemporaryDirectory(prefix='.backup-',dir=dest) as tmp:
 raw=pathlib.Path(tmp)/'songs.sqlite'
 with sqlite3.connect('file:'+urllib.parse.quote(str(source))+'?mode=ro',uri=True,timeout=30) as src,sqlite3.connect(raw) as target:
  src.backup(target,pages=256,sleep=.05)
  if target.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Backup integrity check failed.')
  tables=[{'name':n,'count':target.execute('SELECT count(*) FROM "'+n.replace('"','""')+'"').fetchone()[0]} for n, in target.execute("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")]
 data=raw.read_bytes();compressed=gzip.compress(data,compresslevel=6)
 archive=dest/(name+'.sqlite.gz');archive.write_bytes(compressed)
 meta={'createdAt':stamp,'databaseSha256':hashlib.sha256(data).hexdigest(),'archiveSha256':hashlib.sha256(compressed).hexdigest(),'tables':tables,'integrity':'ok','kind':args.kind,'commit':args.commit}
 (dest/(name+'.json')).write_text(json.dumps(meta,indent=2))
for old in sorted(dest.glob(args.kind+'-*.sqlite.gz'),reverse=True)[14:]:
 old.unlink();old.with_name(old.name.removesuffix('.sqlite.gz')+'.json').unlink(missing_ok=True)
print(json.dumps({'backup':str(archive),'integrity':'ok','tables':len(tables),'bytes':len(compressed)}))
