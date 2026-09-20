import ctypes as c
import json
import sys
from pathlib import Path
from ctypes import wintypes as w
sys.path.insert(0, str(Path(__file__).parent / 'python-libs'))

pid, image_base = map(int, sys.argv[1:3])
kernel = c.WinDLL('kernel32', use_last_error=True)
dbg = c.WinDLL('dbghelp', use_last_error=True)
kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
kernel.OpenProcess.restype = w.HANDLE
kernel.ReadProcessMemory.argtypes = [w.HANDLE, c.c_void_p, c.c_void_p, c.c_size_t, c.POINTER(c.c_size_t)]
kernel.CloseHandle.argtypes = [w.HANDLE]
process = kernel.OpenProcess(0x410, False, pid)
if not process:
    raise c.WinError(c.get_last_error())

class Symbol(c.Structure):
    _fields_ = [('SizeOfStruct', w.ULONG), ('TypeIndex', w.ULONG),
                ('Reserved', c.c_ulonglong * 2), ('Index', w.ULONG),
                ('Size', w.ULONG), ('ModBase', c.c_ulonglong),
                ('Flags', w.ULONG), ('Value', c.c_ulonglong),
                ('Address', c.c_ulonglong), ('Register', w.ULONG),
                ('Scope', w.ULONG), ('Tag', w.ULONG),
                ('NameLen', w.ULONG), ('MaxNameLen', w.ULONG), ('Name', c.c_char * 1)]

dbg.SymInitializeW.argtypes = [w.HANDLE, w.LPCWSTR, w.BOOL]
dbg.SymLoadModuleExW.argtypes = [w.HANDLE, w.HANDLE, w.LPCWSTR, w.LPCWSTR, c.c_ulonglong, w.DWORD, c.c_void_p, w.DWORD]
dbg.SymLoadModuleExW.restype = c.c_ulonglong
dbg.SymFromName.argtypes = [w.HANDLE, c.c_char_p, c.POINTER(Symbol)]
dbg.SymCleanup.argtypes = [w.HANDLE]
pdb_dir = r'D:\openmu自用\MuMain\out\build\windows-x86\src\RelWithDebInfo'
if not dbg.SymInitializeW(process, pdb_dir, False):
    raise c.WinError(c.get_last_error())
if not dbg.SymLoadModuleExW(process, None, pdb_dir + '\\Main.exe', 'Main', image_base, 0, None, 0):
    raise c.WinError(c.get_last_error())

def read(address, size):
    data = c.create_string_buffer(size)
    copied = c.c_size_t()
    if not kernel.ReadProcessMemory(process, address, data, size, c.byref(copied)):
        return None
    return bytes(data)

results = {}
for name in ['SelectedHero', 'g_characterSelection', 'SelectedCharacter', 'SceneFlag', 'CurrentProtocolState', 'WindowWidth', 'WindowHeight', 'MouseX', 'MouseY', 'StartGame', 'CCharSelMainWin::UpdateDisplay', 'CCharSelMainWin::UpdateWhileActive', 'CUIMng::Instance', 'CInput::Instance']:
    storage = c.create_string_buffer(c.sizeof(Symbol) + 1024)
    symbol = c.cast(storage, c.POINTER(Symbol))
    symbol.contents.SizeOfStruct = c.sizeof(Symbol)
    symbol.contents.MaxNameLen = 1024
    if not dbg.SymFromName(process, ('Main!' + name).encode(), symbol):
        results[name] = {'error': c.get_last_error()}
        continue
    info = symbol.contents
    data = read(info.Address, 4)
    value = int.from_bytes(data, 'little', signed=True) if data else None
    results[name] = {'address': hex(info.Address), 'size': info.Size, 'value': value}
    if name in ['StartGame', 'CCharSelMainWin::UpdateDisplay', 'CCharSelMainWin::UpdateWhileActive', 'CUIMng::Instance', 'CInput::Instance']:
        import capstone
        code = read(info.Address, min(info.Size, 180))
        results[name]['instructions'] = [f'{i.address:x}: {i.mnemonic} {i.op_str}' for i in capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32).disasm(code, info.Address)]
    if name == 'SelectedHero' and data:
        target = read(int.from_bytes(data, 'little'), 4)
        results[name]['referenced_value'] = int.from_bytes(target, 'little', signed=True) if target else None
print(json.dumps(results, indent=2))
dbg.SymGetTypeFromName.argtypes = [w.HANDLE, c.c_ulonglong, c.c_char_p, c.POINTER(Symbol)]
dbg.SymGetTypeInfo.argtypes = [w.HANDLE, c.c_ulonglong, w.ULONG, c.c_int, c.c_void_p]
for type_name in ['CUIMng', 'CWin', 'CCharSelMainWin', 'CButton', 'CInput']:
    storage = c.create_string_buffer(c.sizeof(Symbol) + 1024)
    symbol = c.cast(storage, c.POINTER(Symbol))
    symbol.contents.SizeOfStruct = c.sizeof(Symbol)
    symbol.contents.MaxNameLen = 1024
    if not dbg.SymGetTypeFromName(process, image_base, type_name.encode(), symbol):
        continue
    type_index = symbol.contents.TypeIndex
    count = w.ULONG()
    dbg.SymGetTypeInfo(process, image_base, type_index, 13, c.byref(count))
    children = (w.ULONG * (count.value + 2))()
    children[0] = count.value
    dbg.SymGetTypeInfo(process, image_base, type_index, 7, children)
    print(type_name, 'members')
    for child in children[2:]:
        name = c.c_wchar_p()
        offset = w.ULONG()
        if dbg.SymGetTypeInfo(process, image_base, child, 1, c.byref(name)) and dbg.SymGetTypeInfo(process, image_base, child, 10, c.byref(offset)):
            print(name.value, hex(offset.value))
callback_type = c.WINFUNCTYPE(w.BOOL, c.POINTER(Symbol), w.ULONG, c.c_void_p)
def found(symbol, size, context):
    info = symbol.contents
    name = c.string_at(c.addressof(info) + Symbol.Name.offset, info.NameLen).decode(errors='replace')
    if 'CUIMng' in name or 'CInput' in name:
        print(name, hex(info.Address), info.Size, info.TypeIndex)
    return True
callback = callback_type(found)
dbg.SymEnumSymbols.argtypes = [w.HANDLE, c.c_ulonglong, c.c_char_p, callback_type, c.c_void_p]
dbg.SymEnumSymbols(process, image_base, b'*Instance*', callback, None)
dbg.SymCleanup(process)
kernel.CloseHandle(process)
