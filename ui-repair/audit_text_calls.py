from pathlib import Path
import re,json,collections
root=Path('MuMain/src/source')
rows=[]
for p in root.rglob('*.cpp'):
 text=p.read_text(encoding='utf-8',errors='replace')
 for m in re.finditer(r'g_pRenderText\s*->\s*RenderText\s*\(',text):
  start=m.end();i=start;depth=1;quote=None;escape=False;args=[];part=start
  while i<len(text) and depth:
   c=text[i]
   if quote:
    if escape:escape=False
    elif c=='\\':escape=True
    elif c==quote:quote=None
   elif c in '\"\'':quote=c
   elif c=='(':depth+=1
   elif c==')':
    depth-=1
    if depth==0:args.append(text[part:i].strip())
   elif c==',' and depth==1:args.append(text[part:i].strip());part=i+1
   i+=1
  height=args[4] if len(args)>4 else '0'
  width=args[3] if len(args)>3 else '0'
  kind='explicit_box_height' if height not in ('0','0.f','0.0f') else ('width_only' if width not in ('0','0.f','0.0f') else 'unbounded_label')
  rows.append({'file':p.relative_to(Path('MuMain')).as_posix(),'line':text.count('\n',0,m.start())+1,'category':kind,'arguments':args})
counts=dict(collections.Counter(r['category'] for r in rows))
result={'note':'Inventory of direct text-render calls; missing bounds are not automatically defects. Owning controls and runtime states require visual review.','files':len({r['file'] for r in rows}),'direct_calls':len(rows),'categories':counts,'calls':rows}
Path('ui-repair/text-call-inventory.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='calls'},ensure_ascii=False))
