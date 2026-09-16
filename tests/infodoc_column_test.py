"""Regression tests for the repeated-column import policy; no APK or external packages."""
import csv
import importlib.util
import io
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

class RepeatedColumnTests(unittest.TestCase):
    def test_only_tables_with_verified_evidence_may_repeat_a_column(self):
        self.assertEqual(importer.DUPLICATE_COLUMN_TABLES, {'RaidTicketBoostInfo', 'RaidResearchInfo'})
        published = {name for name in importer.TABLES if 'columnResolution' in read(name)}
        self.assertEqual(published, importer.DUPLICATE_COLUMN_TABLES)

    def test_the_last_source_column_is_the_published_one(self):
        # csv.DictReader keeps the last duplicate the same way the native column dictionary does.
        text = 'A,B,A\n1,2,3\n'
        rows = list(csv.DictReader(io.StringIO(text)))
        self.assertEqual(rows[0]['A'], '3')
        for table in sorted(importer.DUPLICATE_COLUMN_TABLES):
            data = read(table)
            resolution = data['columnResolution']
            self.assertEqual(resolution['policy'], 'last-header-index-wins')
            for column in resolution['repeated']:
                self.assertEqual(column['effectiveIndex'], max(column['sourceIndexes']))
                self.assertIn(column['column'], data['schema'])

    def test_shadowed_cells_are_published_so_no_source_value_is_lost(self):
        data = read('RaidResearchInfo')
        [total_levels] = data['columnResolution']['repeated']
        self.assertEqual(total_levels['column'], 'Total Levels')
        self.assertEqual(len(total_levels['shadowed']), 1)
        shadow = total_levels['shadowed'][0]
        self.assertEqual(len(shadow['values']), len(data['records']))
        self.assertNotEqual(shadow['values'][0], data['records'][0]['values']['Total Levels'])

    def test_retained_columns_are_deduplicated_without_reordering(self):
        self.assertEqual(list(dict.fromkeys(['A', 'B', 'A', 'C'])), ['A', 'B', 'C'])
        data = read('RaidTicketBoostInfo')
        self.assertEqual(len(set(data['schema'])), len(data['schema']))
        for record in data['records']:
            self.assertEqual(list(record['values']), list(data['schema']))

class InfoDocEvidenceTests(unittest.TestCase):
    def test_column_policy_evidence_is_published_with_its_source_hashes(self):
        evidence = json.loads((REFERENCE / 'infodoc-parser-evidence.json').read_text(encoding='utf-8'))
        self.assertEqual(evidence['columnPolicy'], 'last-header-index-wins')
        self.assertEqual(evidence['evidence']['assignmentTarget'], 'Dictionary<string, int>.set_Item')
        self.assertTrue(evidence['evidence']['checkedInstructionAddresses'])
        for key in ('packageSha256', 'binarySha256', 'metadataSha256', 'scriptSha256', 'parserBytesSha256'):
            self.assertRegex(evidence[key], r'^[0-9a-f]{64}$')

if __name__ == '__main__':
    unittest.main()
