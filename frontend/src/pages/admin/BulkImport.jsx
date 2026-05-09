// frontend/src/pages/admin/BulkImport.jsx  — NEW PAGE
// Route: /admin/bulk-import
// Allows importing tenants + units from CSV or Excel file

import { useState } from 'react';
import toast from 'react-hot-toast';
import AppLayout from '../../components/layout/AppLayout';
import api from '../../api';

const REQUIRED_COLS = ['full_name','phone'];
const OPTIONAL_COLS = ['email','id_number','unit_number','property_name','rent_amount','deposit','start_date'];

export default function BulkImport() {
  const [step, setStep]           = useState(1); // 1=upload, 2=preview, 3=done
  const [file, setFile]           = useState(null);
  const [preview, setPreview]     = useState([]);
  const [headers, setHeaders]     = useState([]);
  const [importResult, setResult] = useState(null);
  const [busy, setBusy]           = useState(false);

  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    const hdrs  = lines[0].split(',').map(h => h.trim().replace(/"/g,'').toLowerCase());
    const rows  = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/"/g,''));
      return Object.fromEntries(hdrs.map((h,i) => [h, vals[i]||'']));
    }).filter(r => Object.values(r).some(v=>v)); // skip empty rows
    return { headers: hdrs, rows };
  };

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);

    if (f.name.endsWith('.csv')) {
      const text = await f.text();
      const { headers: hdrs, rows } = parseCSV(text);
      setHeaders(hdrs);
      setPreview(rows.slice(0, 10));
      setStep(2);
    } else if (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')) {
      try {
        const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs');
        const buffer = await f.arrayBuffer();
        const wb = XLSX.read(buffer);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header:1 });
        const hdrs = data[0].map(h => String(h).toLowerCase().trim().replace(/\s+/g,'_'));
        const rows = data.slice(1).map(row =>
          Object.fromEntries(hdrs.map((h,i) => [h, row[i]!=null ? String(row[i]).trim() : '']))
        ).filter(r => Object.values(r).some(v=>v));
        setHeaders(hdrs);
        setPreview(rows.slice(0,10));
        setStep(2);
      } catch(e) {
        toast.error('Could not parse Excel file. Try saving as .csv first.');
      }
    } else {
      toast.error('Please upload a .csv or .xlsx file');
    }
  };

  const downloadTemplate = () => {
    api.get('/import/template', { responseType:'blob' }).then(res => {
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href=url; a.download='tenant_import_template.csv'; a.click();
    }).catch(() => {
      // Fallback: generate locally
      const csv = [
        'full_name,phone,email,id_number,unit_number,property_name,rent_amount,deposit,start_date',
        'John Kamau,0712345678,john@email.com,12345678,A1,Westlands Heights,15000,30000,2024-01-01',
      ].join('\n');
      const blob = new Blob([csv], { type:'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download='tenant_import_template.csv'; a.click();
    });
  };

  const [dryRunResult, setDryRunResult] = useState(null);

  const runImport = async (dryRun) => {
    setBusy(true);
    if (dryRun) setDryRunResult(null);
    try {
      let allRows = preview;
      if (file.name.endsWith('.csv')) {
        const text = await file.text();
        const { rows } = parseCSV(text);
        allRows = rows;
      }
      const { data } = await api.post('/import/tenants', { rows: allRows, dry_run: dryRun });
      if (dryRun) {
        setDryRunResult(data);
        if (data.errors?.length === 0) {
          toast.success(`Validation passed — ${data.imported} rows ready to import`);
        } else {
          toast.error(`${data.errors.length} row(s) have errors. Review before importing.`);
        }
      } else {
        setResult(data);
        setStep(3);
        toast.success(`Import complete! ${data.imported} tenants imported.`);
      }
    } catch(e) { toast.error(e.response?.data?.error || 'Import failed'); }
    finally { setBusy(false); }
  };

  const reset = () => { setStep(1); setFile(null); setPreview([]); setHeaders([]); setResult(null); };

  const missingRequired = REQUIRED_COLS.filter(c => !headers.includes(c));

  return (
    <AppLayout title="Bulk Import">
      <div className="max-w-3xl space-y-5">

        {/* Step indicators */}
        <div className="flex items-center gap-2">
          {['Upload file','Preview & validate','Done'].map((label,i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step>i+1?'bg-[--green] text-white':step===i+1?'bg-brand-600 text-white':'bg-[--canvas-200] text-[--text-muted]'}`}>
                {step>i+1?'✓':i+1}
              </div>
              <span className={`text-sm ${step===i+1?'font-medium text-[--text-primary]':'text-[--text-muted]'}`}>{label}</span>
              {i<2 && <span className="text-[--text-muted] mx-1">→</span>}
            </div>
          ))}
        </div>

        {/* Step 1: Upload */}
        {step === 1 && (
          <div className="card card-body space-y-5">
            <div>
              <h2 className="text-base font-semibold text-[--text-primary] mb-1">Import tenants from CSV or Excel</h2>
              <p className="text-sm text-[--text-muted]">Upload a spreadsheet with tenant details. Missing columns will be ignored. Each row creates one tenant account.</p>
            </div>

            {/* Template download */}
            <div className="p-4 bg-[--brand-light] rounded-xl">
              <p className="text-sm font-medium text-[--brand-dark] mb-2">📋 Required columns</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {REQUIRED_COLS.map(c=><span key={c} className="text-xs font-mono bg-red-100 text-red-700 px-2 py-1 rounded">*{c}</span>)}
                {OPTIONAL_COLS.map(c=><span key={c} className="text-xs font-mono bg-[--canvas-200] text-[--text-secondary] px-2 py-1 rounded">{c}</span>)}
              </div>
              <button onClick={downloadTemplate} className="btn-secondary btn-sm">
                ⬇️ Download template (.csv)
              </button>
            </div>

            {/* File upload area */}
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-[--border-strong] rounded-xl py-12 cursor-pointer hover:border-brand-400 transition">
              <span className="text-4xl mb-3">📁</span>
              <p className="font-medium text-[--text-secondary]">Click to upload or drag & drop</p>
              <p className="text-xs text-[--text-muted] mt-1">CSV or Excel (.xlsx) — max 1000 rows</p>
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFile} />
            </label>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 2 && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div className="card card-body">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h2 className="text-base font-semibold text-[--text-primary]">Preview — {file?.name}</h2>
                  <p className="text-xs text-[--text-muted] mt-0.5">Showing first 10 rows. All {preview.length <= 10 ? preview.length : '10+'} rows will be imported.</p>
                </div>
                <button onClick={reset} className="btn-secondary btn-sm text-xs">← Change file</button>
              </div>

              {missingRequired.length > 0 && (
                <div className="mb-3 p-3 bg-[--red-bg] border border-[--red-bg] rounded-xl">
                  <p className="text-xs text-[--red] font-medium">
                    ❌ Missing required columns: {missingRequired.join(', ')}
                  </p>
                  <p className="text-xs text-[--red] mt-1">Please check your file has these column headers.</p>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="bg-[--surface-muted]">
                      {headers.map((h,i) => (
                        <th key={i} className={`text-left px-3 py-2 font-medium ${REQUIRED_COLS.includes(h)?'text-[--brand]':'text-[--text-muted]'}`}>
                          {h}{REQUIRED_COLS.includes(h)&&' *'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row,i) => (
                      <tr key={i} className="border-t">
                        {headers.map((h,j) => (
                          <td key={j} className={`px-3 py-2 ${!row[h]&&REQUIRED_COLS.includes(h)?'text-[--red] font-medium':''}`}>
                            {row[h] || (REQUIRED_COLS.includes(h) ? '⚠️ Missing' : '—')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 bg-[--amber-bg] border border-[--amber-bg] rounded-xl text-xs text-amber-700">
              <p className="font-medium mb-1">ℹ️ What happens on import:</p>
              <p>• New tenant accounts are created (default password = last 4 digits of phone)</p>
              <p>• If a unit_number + property_name match an existing vacant unit, a tenancy is created</p>
              <p>• Duplicate phone numbers are skipped (existing user reused)</p>
              <p>• You can share the tenant portal link and ask them to reset their password on first login</p>
            </div>

            <div className="flex gap-3">
              <button className="btn-secondary" onClick={() => runImport(true)} disabled={busy||missingRequired.length>0}>
                {busy ? 'Validating...' : '🔍 Dry run (preview)'}
              </button>
              <button className="btn-primary" onClick={() => runImport(false)} disabled={busy||missingRequired.length>0}>
                {busy ? 'Importing...' : `⬆️ Import all ${preview.length}+ tenants`}
              </button>
            </div>

            {/* Dry-run results */}
            {dryRunResult && (
              <div style={{ borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: 16, padding: '0.875rem 1rem', background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>✓ {dryRunResult.imported} valid</span>
                  {dryRunResult.skipped > 0 && <span style={{ fontSize: 13, color: 'var(--red)', fontWeight: 700 }}>✗ {dryRunResult.skipped} errors</span>}
                </div>
                {dryRunResult.errors?.length > 0 && (
                  <div style={{ maxHeight: 200, overflowY: 'auto', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Row errors — fix these before importing</p>
                    {dryRunResult.errors.map((e, i) => (
                      <div key={i} style={{ background: 'var(--red-bg)', borderRadius: 7, padding: '0.4rem 0.625rem', fontSize: 12, color: 'var(--red)' }}>
                        <span style={{ fontFamily: 'JetBrains Mono,monospace', fontWeight: 700 }}>Row {e.row}:</span> {e.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Results */}
        {step === 3 && importResult && (
          <div className="card card-body space-y-4">
            <div className="text-center">
              <div className="text-5xl mb-3">🎉</div>
              <h2 className="text-xl font-bold text-[--text-primary]">Import complete!</h2>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-[--green-bg] rounded-xl">
                <p className="text-2xl font-bold text-[--green]">{importResult.imported}</p>
                <p className="text-xs text-[--text-muted] mt-1">Tenants imported</p>
              </div>
              <div className="text-center p-4 bg-[--amber-bg] rounded-xl">
                <p className="text-2xl font-bold text-[--amber]">{importResult.skipped}</p>
                <p className="text-xs text-[--text-muted] mt-1">Skipped (errors)</p>
              </div>
              <div className="text-center p-4 bg-[--brand-light] rounded-xl">
                <p className="text-2xl font-bold text-[--brand]">{importResult.total}</p>
                <p className="text-xs text-[--text-muted] mt-1">Total rows</p>
              </div>
            </div>
            {importResult.errors?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[--red] mb-2">Rows with errors ({importResult.errors.length}):</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {importResult.errors.map((e,i) => (
                    <div key={i} className="text-xs p-2 bg-[--red-bg] rounded text-[--red]">
                      Row {e.row}: {e.error}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <button className="btn-primary" onClick={() => window.location.href='/admin/tenants'}>
                View all tenants →
              </button>
              <button className="btn-secondary" onClick={reset}>Import another file</button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}