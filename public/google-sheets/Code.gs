// Titan Echo: paste this complete file into the Sheet's Apps Script Code.gs.
const SPREADSHEET_ID = '1yRfoKfkWn4hQtUrrzBimIA2df4nTlzoblnH9UwpvWQ8';
const TAB_NAME = 'TitanEcho_Saves_v1';
const HEADERS = ['key_hash', 'revision', 'updated_ms', 'snapshot_json', 'request_id'];

function setup() {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  let tab = book.getSheetByName(TAB_NAME);
  if (!tab) {
    tab = book.insertSheet(TAB_NAME);
    tab.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    tab.setFrozenRows(1);
  }
  checkHeaders_(tab);
  return 'Titan Echo storage ready';
}
function checkHeaders_(tab) {
  if (JSON.stringify(tab.getRange(1, 1, 1, HEADERS.length).getValues()[0]) !== JSON.stringify(HEADERS))
    throw Error('SCHEMA_MISMATCH');
}
function doGet() { return json_({ok:true, service:'Titan Echo', protocol:1}); }
function doPost(e) {
  try {
    if (!e || !e.postData || e.postData.contents.length > 45000) throw Error('INVALID_REQUEST');
    return json_(handle_(JSON.parse(e.postData.contents)));
  } catch (error) {
    const known = ['INVALID_REQUEST','INVALID_KEY','INVALID_SAVE','NOT_FOUND','CONFLICT','BUSY','NOT_READY','SCHEMA_MISMATCH','CAPACITY'];
    return json_({ok:false,error:known.includes(error.message)?error.message:'SERVER_ERROR'});
  }
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function snapshot_(s) {
  if (!s || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 24 || !s.state || s.state.version !== 2) throw Error('INVALID_SAVE');
  const st = s.state;
  for (const k of ['stage','best','level','gold','last','prestiges'])
    if (typeof st[k] !== 'number' || !Number.isFinite(st[k]) || st[k] < 0) throw Error('INVALID_SAVE');
  if (st.stage < 1 || !Array.isArray(st.heroes) || st.heroes.length !== 33 || !Array.isArray(st.artifacts) || st.artifacts.length !== 30) throw Error('INVALID_SAVE');
  const text = JSON.stringify({name:s.name.trim(),state:st});
  if (text.length > 40000) throw Error('INVALID_SAVE');
  return text;
}
function handle_(b) {
  if (!b || !['create','load','save'].includes(b.op)) throw Error('INVALID_REQUEST');
  // The 256-bit recovery key is a bearer credential. Only its digest is stored.
  if (typeof b.key !== 'string' || !/^[a-f0-9]{64}$/.test(b.key)) throw Error('INVALID_KEY');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,b.key,Utilities.Charset.UTF_8)
    .map(x => ('0'+((x+256)%256).toString(16)).slice(-2)).join('');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw Error('BUSY');
  try {
    const tab = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(TAB_NAME);
    if (!tab) throw Error('NOT_READY');
    checkHeaders_(tab);
    const count = tab.getLastRow()-1;
    const rows = count ? tab.getRange(2,1,count,HEADERS.length).getValues() : [];
    const index = rows.findIndex(row => row[0] === digest);
    const row = index < 0 ? null : rows[index];
    if (b.op === 'load') {
      if (!row) throw Error('NOT_FOUND');
      return {ok:true,revision:Number(row[1]),updated:Number(row[2]),snapshot:JSON.parse(row[3])};
    }
    if (typeof b.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(b.requestId)) throw Error('INVALID_REQUEST');
    // A response lost in transit can be retried without writing twice.
    if (row && row[4] === b.requestId) return {ok:true,revision:Number(row[1]),updated:Number(row[2])};
    if (b.op === 'create' && row) throw Error('CONFLICT');
    if (b.op === 'save' && !row) throw Error('NOT_FOUND');
    if (row && (!Number.isSafeInteger(b.revision) || b.revision !== Number(row[1]))) throw Error('CONFLICT');
    if (!row && count >= 100) throw Error('CAPACITY');
    const text = snapshot_(b.snapshot);
    const revision = row ? Number(row[1])+1 : 1;
    const updated = Date.now();
    tab.getRange(row ? index+2 : count+2,1,1,HEADERS.length).setValues([[digest,revision,updated,text,b.requestId]]);
    SpreadsheetApp.flush();
    return {ok:true,revision,updated};
  } finally { lock.releaseLock(); }
}
