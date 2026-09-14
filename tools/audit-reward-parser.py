"""Pin narrow reward/selection observations to the already APK-verified native binary."""
import hashlib
import json
import pathlib
import sys
import io

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL = ROOT/'work/apk-analysis'
OUT = ROOT/'reference/tt2/8.2.0'
sys.path.insert(0, str(LOCAL/'python-libs'))
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from elftools.elf.elffile import ELFFile

def main():
    binary = (LOCAL/'libil2cpp.so').read_bytes()
    pinned = json.loads((OUT/'enhancement-parser-evidence.json').read_text())
    if hashlib.sha256(binary).hexdigest() != pinned['binarySha256']:
        raise ValueError('binary differs from APK-verified evidence')
    script_bytes = (LOCAL/'dump/script.json').read_bytes()
    if hashlib.sha256(script_bytes).hexdigest() != pinned['scriptSha256']:
        raise ValueError('method metadata changed')
    script = json.loads(script_bytes)
    symbols = {m['Address']:m['Name'] for m in script['ScriptMethod']}
    strings = {s['Address']:s['Value'] for s in script['ScriptString']}
    elf = ELFFile(io.BytesIO(binary))
    relocs = {r['r_offset']:r['r_addend'] for r in elf.get_section_by_name('.rela.dyn').iter_relocations()}
    def code(address, size):
        seg = next(s for s in elf.iter_segments() if s['p_type']=='PT_LOAD' and s['p_vaddr']<=address and address+size<=s['p_vaddr']+s['p_filesz'])
        offset = address-seg['p_vaddr']+seg['p_offset']
        return binary[offset:offset+size]
    checks = [(0x2433480,'mov','w9, #0x3b'), (0x2433490,'mov','w8, #0x2c'),
        (0x2433560,'mov','w1, #0x3a'), (0x24335d0,'mov','w1, #0x3a'),
        (0x2433bbc,'bl','#0x3e3b794'), (0x2433bc4,'bl','#0x2433c80'),
        (0x2433b6c,'str','x26, [x8, x25, lsl #3]'),
        (0x24e7b74,'bl','#0x3e4cba8'), (0x24e7bb8,'bl','#0x243335c'),
        (0x24f2e30,'mov','w0, #-1'), (0x24f2f54,'mov','w26, #-1'),
        (0x24f2fd8,'bl','#0x390319c')]
    for address, mnemonic, operands in checks:
        i = next(Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(code(address,4), address))
        if (i.mnemonic,i.op_str)!=(mnemonic,operands):
            raise ValueError(f'native instruction mismatch: {address:x}')
    for got, value in {0x4c07878:',', 0x4c07818:'', 0x4c30138:'SelectionSlotContents{0}'}.items():
        if strings.get(relocs.get(got)) != value:
            raise ValueError(f'native string mismatch: {got:x}')
    methods = {0x243335c:('RewardClass$$.ctor',0x924),
        0x24e6fe4:('ParsedShopBundleInfo$$TryParse',0xccc),
        0x24f2da8:('ShopModel$$GetSelectionIndexForBundleIdSlot',0x98),
        0x24f2e40:('ShopModel$$SetSelectionIndexForBundleId',0x210)}
    evidence_methods=[]
    for address,(name,size) in methods.items():
        if symbols.get(address)!=name: raise ValueError(f'method mismatch: {name}')
        evidence_methods.append(dict(name=name,rva=hex(address),bytes=size,sha256=hashlib.sha256(code(address,size)).hexdigest()))
    result=dict(version='8.2.0',packageSha256=pinned['packageSha256'],binarySha256=pinned['binarySha256'],
        scriptSha256=pinned['scriptSha256'],methods=evidence_methods,
        checkedInstructionAddresses=[hex(a) for a,_,_ in checks],
        rules=dict(rewardSeparators=[',',';'],selectionCandidateSeparator=',',
            selectedIndicesPerSlot=1,unselectedIndex=-1,
            equipmentQualifier='concatenate type and qualifier before RewardID lookup',
            twoFieldValue='preserve substring after first colon; no inferred default quantity'),
        limitations=['Valid bundled dialect only; strict validation intentionally rejects malformed input',
            'Single stored selection index is confirmed; purchase, grant and server validation remain unimplemented',
            'No live delivery schedule or inferred equipment-set quantity'])
    (OUT/'reward-parser-evidence.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8',newline='\n')
    print('Verified reward and selection parsing: 12 instruction checks and 3 string references')

if __name__=='__main__': main()
