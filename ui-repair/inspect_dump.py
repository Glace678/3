import struct as S,re
from pathlib import Path
b=Path(r'C:/Users/Glace/AppData/Local/CrashDumps/Main.exe.67152.dmp').read_bytes()
n,d=S.unpack_from('<II',b,8)
streams={}
for i in range(n):
 t,size,rva=S.unpack_from('<III',b,d+i*12);streams[t]=(rva,size)
rva,_=streams[6]; code=S.unpack_from('<I',b,rva+8)[0];addr=S.unpack_from('<Q',b,rva+24)[0];cxsize,cxrva=S.unpack_from('<II',b,rva+160)
print('Exception',hex(code),hex(addr),'Context',cxsize,hex(S.unpack_from('<I',b,cxrva)[0]))
regs={k:S.unpack_from('<I',b,cxrva+o)[0] for k,o in [('EDI',156),('ESI',160),('EBX',164),('EDX',168),('ECX',172),('EAX',176),('EBP',180),('EIP',184),('ESP',196)]};print({k:hex(v) for k,v in regs.items()})
mods=[];rva,_=streams[4];count=S.unpack_from('<I',b,rva)[0]
for i in range(count):
 o=rva+4+i*108;base,size=S.unpack_from('<QI',b,o);nr=S.unpack_from('<I',b,o+20)[0];nl=S.unpack_from('<I',b,nr)[0];name=b[nr+4:nr+4+nl].decode('utf-16-le');mods.append((base,size,name))
main=next(m for m in mods if m[2].endswith('Main.exe'));print('Main',main)
ranges=[]
if 9 in streams:
 o,_=streams[9];count,pos=S.unpack_from('<QQ',b,o)
 for i in range(count):
  va,size=S.unpack_from('<QQ',b,o+16+16*i);ranges.append((va,size,pos));pos+=size
if 5 in streams:
 o,_=streams[5];count=S.unpack_from('<I',b,o)[0]
 for i in range(count):
  va,size,pos=S.unpack_from('<QII',b,o+4+16*i);ranges.append((va,size,pos))
def read(va,size):
 for start,length,pos in ranges:
  if start<=va and va+size<=start+length:return b[pos+va-start:pos+va-start+size]
 return None
sym=[]
for l in next(Path('MuMain/out/build/windows-x86').rglob('Main.map')).read_text(errors='replace').splitlines():
 m=re.match(r'\s*[0-9a-fA-F]{4}:[0-9a-fA-F]+\s+(\S+)\s+([0-9a-fA-F]{8,16})\s',l)
 if m:sym.append((int(m[2],16)-0x400000,m[1]))
sym.sort()
def name(va):
 off=va-main[0]
 for i,(v,n) in enumerate(sym):
  if v>off:
   pv,pn=sym[i-1];return f'{pn}+{off-pv:x}'
print('Fault',name(regs['EIP']))
for k in ('ECX','EAX','ESI','EDI','EBP'):
 data=read(regs[k],64);print(k, None if data is None else data.hex())
data=read(regs['ESP'],1024)
if data:
 for i in range(0,len(data),4):
  val=S.unpack_from('<I',data,i)[0]
  if main[0]<=val<main[0]+main[1]:print(hex(i),hex(val),name(val))

