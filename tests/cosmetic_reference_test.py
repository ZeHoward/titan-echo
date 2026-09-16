"""Regression tests for the cosmetic support import policy; no APK or external packages."""
import importlib.util
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REFERENCE = ROOT / 'reference/tt2/8.2.0'
sys.path.insert(0, str(ROOT / 'tools'))
MODULE = importlib.util.spec_from_file_location('import_reference', ROOT / 'tools/import-reference-v8.py')
importer = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(importer)

def read(name):
    return json.loads((REFERENCE / f'{name}.json').read_text(encoding='utf-8'))

DUMP = '\n'.join([
    'public enum ProfileBackgroundType // TypeDefIndex: 1555',
    '{',
    '\tpublic const ProfileBackgroundType None = 0;',
    '\tpublic const ProfileBackgroundType Player = 1;',
    '}',
    'public class ProfileBackgroundModel // TypeDefIndex: 2521',
    '{',
    '\t// RVA: 0x2409C4C Offset: 0x2405C4C VA: 0x2409C4C',
    '\tprivate void ParseProfileBackgroundInfo() { }',
    '}',
])

class NativeCosmeticEvidenceTests(unittest.TestCase):
    def test_enum_members_keep_their_exact_source_values(self):
        self.assertEqual(importer.enum_values(DUMP, 'ProfileBackgroundType'), {'None': '0', 'Player': '1'})

    def test_absent_or_duplicated_enum_members_stop_the_import(self):
        with self.assertRaises(ValueError):
            importer.enum_values(DUMP, 'AvatarParticleID')
        with self.assertRaises(ValueError):
            importer.enum_values(DUMP + '\n\tpublic const ProfileBackgroundType Player = 2;', 'ProfileBackgroundType')

    def test_method_evidence_requires_exactly_one_native_match(self):
        self.assertEqual(importer.native_rva(DUMP, 'private void ParseProfileBackgroundInfo()'), '0x2409C4C')
        with self.assertRaises(ValueError):
            importer.native_rva(DUMP, 'private void ParseAvatarParticleInfo()')
        with self.assertRaises(ValueError):
            importer.native_rva(DUMP + '\n' + DUMP, 'private void ParseProfileBackgroundInfo()')

class CosmeticCatalogTests(unittest.TestCase):
    def test_native_column_typing_matches_every_published_cosmetic_row(self):
        native = json.loads((REFERENCE / 'native-cosmetic-types.json').read_text(encoding='utf-8'))
        checked = 0
        for table, typing in native['tableTypes'].items():
            data = read(table)
            for role in ('idColumn', 'unlockColumn', 'categoryColumn'):
                column = typing.get(role)
                enum = native['types'].get(typing.get(role.replace('Column', 'Type')))
                if column is None:
                    continue
                self.assertIn(column, data['schema'], f'{table}.{column}')
                if enum is None:
                    continue
                for record in data['records']:
                    self.assertIn(record['values'][column], enum, f'{table}/{record["id"]}.{column}')
                    checked += 1
        self.assertEqual(checked, 1650)

    def test_support_tables_keep_their_source_shape_and_version_difference(self):
        particles = read('AvatarParticleInfo')
        self.assertEqual(particles['keys'], ['AvatarParticleID'])
        self.assertEqual(len(particles['records']), 22)
        # No 7.5 snapshot exists for this table, so no comparison may be claimed.
        self.assertIsNone(particles['differenceFrom75'])
        backgrounds = read('ProfileBackgroundInfo')
        self.assertEqual(len(backgrounds['records']), 47)
        self.assertEqual(backgrounds['differenceFrom75'],
                         dict(added=[], removed=[], changed=[], addedColumns=[], removedColumns=[]))
        for data in (particles, backgrounds):
            self.assertEqual(data['omittedColumns'], [])
            self.assertTrue(all(r['activation'] == 'unverified' and r['verification'] == 'pending'
                                for r in data['records']))

    def test_cosmetic_tables_still_reject_duplicate_ids(self):
        rows = [{'AvatarParticleID': 'AvatarParticleAbyss1'}, {'AvatarParticleID': 'AvatarParticleAbyss1'}]
        with self.assertRaisesRegex(ValueError, 'duplicate stable ID'):
            importer.index(rows, ['AvatarParticleID'])

if __name__ == '__main__':
    unittest.main()
