// ntdStore.js — Supabase backend
// Replace the two values below with your Supabase project credentials
// DO NOT share these values publicly

var SUPABASE_URL = 'https://mngilvenfclopyfzaghq.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZ2lsdmVuZmNsb3B5ZnphZ2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MjU0NzgsImV4cCI6MjA5ODUwMTQ3OH0.9crgKglgt9Dh2Gr3NMsqF8rmS_bKB9Zv3-xatGpzy9c';

// ── SUPABASE CLIENT ──────────────────────────────────────────────────────────
var _sb = (function() {
  function headers() {
    return {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Prefer': 'return=representation'
    };
  }

  function url(table, params) {
    var u = SUPABASE_URL + '/rest/v1/' + table;
    if (params) u += '?' + params;
    return u;
  }

  function req(method, table, params, body) {
    return fetch(url(table, params), {
      method: method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined
    }).then(function(r) {
      if (!r.ok) return r.text().then(function(t) { throw new Error(t); });
      var ct = r.headers.get('content-type') || '';
      if (ct.indexOf('json') > -1) return r.json();
      return r.text().then(function(t) { return t ? JSON.parse(t) : []; });
    });
  }

  // Original insert-then-update-on-conflict logic, with no offline handling —
  // used directly by the offline queue's flush() so a replay attempt that
  // fails again (still no connection) just rejects cleanly instead of
  // re-enqueuing a duplicate copy of the same record.
  function rawUpsert(table, record) {
    var now = Date.now();
    record.ts = record.ts || now;
    record.updated_at = new Date().toISOString();
    if (!record.id) {
      record.id = _uid(table.slice(0,4));
      record.created_at = record.updated_at;
    }
    return req('POST', table, undefined, record)
      .then(function(rows) { return rows && rows.length ? rows[0] : record; })
      .catch(function() {
        // If insert fails try update
        return req('PATCH', table, 'id=eq.' + encodeURIComponent(record.id), record)
          .then(function(rows) { return rows && rows.length ? rows[0] : record; });
      });
  }

  return {
    // Get all rows, optional filter string e.g. 'facility_id=eq.abc'
    // Paginates internally in pages of 1000 (PostgREST's default row cap) so
    // callers never get a silently-truncated result once a table grows past
    // that — the `documents` table (which now holds every photo) is the one
    // most likely to hit this over time.
    list: function(table, filter) {
      var pageSize = 1000;
      function fetchPage(offset) {
        var params = 'order=ts.desc.nullslast&limit=' + pageSize + '&offset=' + offset;
        if (filter) params += '&' + filter;
        return req('GET', table, params).then(function(rows) {
          rows = rows || [];
          if (rows.length === pageSize) {
            return fetchPage(offset + pageSize).then(function(rest) { return rows.concat(rest); });
          }
          return rows;
        });
      }
      return fetchPage(0);
    },
    // Get single row by id
    get: function(table, id) {
      return req('GET', table, 'id=eq.' + encodeURIComponent(id)).then(function(rows) {
        return rows && rows.length ? rows[0] : null;
      });
    },
    // Upsert a record (insert or update by id). Falls back to queuing the
    // write locally (see OFFLINE QUEUE below) if the failure looks like a
    // connectivity problem rather than a real server-side error, so a tech's
    // work is never silently lost in a dead-signal mechanical room.
    upsert: function(table, record) {
      return rawUpsert(table, record).catch(function(err) {
        if (_ntdLooksOffline(err)) {
          return _ntdQueue.enqueue(table, record).then(function() {
            return Object.assign({}, record, { _queued: true });
          });
        }
        throw err;
      });
    },
    // Insert-or-update with NO offline fallback — used internally by the
    // offline queue when replaying a queued write.
    _rawUpsert: rawUpsert,
    // Delete a record by id
    delete: function(table, id) {
      return req('DELETE', table, 'id=eq.' + encodeURIComponent(id))
        .then(function(rows) {
          // With Prefer: return=representation, a successful delete returns
          // the deleted row(s). An empty array means RLS silently blocked
          // the delete (no DELETE policy for the anon key) — 0 rows removed.
          if (Array.isArray(rows) && rows.length === 0) {
            throw new Error('Nothing was deleted — this table\'s Row Level Security blocks DELETE via the public key. Delete this record from the Supabase Table Editor instead.');
          }
          return true;
        });
    },
    // Raw request for custom queries
    raw: function(method, table, params, body) {
      return req(method, table, params, body);
    }
  };
})();

// ── OFFLINE QUEUE ─────────────────────────────────────────────────────────
// Field tools run on iPads in mechanical rooms/basements with spotty signal.
// When a write (facility/equipment/startup/PM/quote/etc.) fails because the
// device looks offline — not because Supabase rejected it — the record is
// stashed in IndexedDB instead of losing the tech's work. It's replayed
// automatically once the connection comes back (or the app is reopened).
// Only genuine connectivity failures are queued; a real server-side error
// (bad data, RLS, etc.) still surfaces immediately so it isn't hidden.
//
// Scope note: this covers data-record writes only (the ntdStore.*.upsert
// path). PDF/photo file uploads to Supabase Storage go through a separate,
// unqueued path and will still fail immediately if offline — a much bigger
// lift to make replayable (blobs, signed URLs) and not part of this pass.
function _ntdLooksOffline(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  // A network-level fetch failure (no response at all) throws a TypeError
  // in every major browser, including Safari's "Load failed". A real
  // server-side error instead throws a plain Error built from a response
  // body in _sb's req(), so checking the error's constructor cleanly tells
  // the two apart without guessing at message text.
  return !!(err && err.name === 'TypeError');
}

var _ntdQueueDBName = 'ntd_offline_queue';
var _ntdQueueListeners = [];

function _ntdQueueOpenDB() {
  return new Promise(function(resolve, reject) {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    var openReq = indexedDB.open(_ntdQueueDBName, 1);
    openReq.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('ops')) db.createObjectStore('ops', { keyPath: 'qid' });
    };
    openReq.onsuccess = function(e) { resolve(e.target.result); };
    openReq.onerror = function(e) { reject((e.target && e.target.error) || new Error('IndexedDB open failed')); };
  });
}

function _ntdQueueNotify() {
  _ntdQueue.count().then(function(n) {
    _ntdQueueListeners.forEach(function(cb) { try { cb(n); } catch(e) {} });
  }).catch(function() {});
}

var _ntdQueue = {
  // Stash a failed write. Always resolves (never rejects) so the calling
  // ntdStore.*.upsert() can still resolve "successfully" with a _queued flag
  // rather than throwing and losing the submission.
  enqueue: function(table, record) {
    return _ntdQueueOpenDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction('ops', 'readwrite');
        tx.objectStore('ops').add({ qid: _uid('q'), table: table, record: record, ts: Date.now() });
        tx.oncomplete = function() { _ntdQueueNotify(); resolve(); };
        tx.onerror = function() { reject(tx.error); };
      });
    }).catch(function(err) {
      console.warn('[NTD] Offline queue unavailable, write may be lost:', err);
    });
  },
  _all: function() {
    return _ntdQueueOpenDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var store = db.transaction('ops', 'readonly').objectStore('ops');
        if (store.getAll) {
          var r = store.getAll();
          r.onsuccess = function() { resolve(r.result || []); };
          r.onerror = function() { reject(r.error); };
        } else {
          var items = [];
          var cur = store.openCursor();
          cur.onsuccess = function(e) {
            var c = e.target.result;
            if (c) { items.push(c.value); c.continue(); } else resolve(items);
          };
          cur.onerror = function() { reject(cur.error); };
        }
      });
    });
  },
  count: function() {
    return _ntdQueue._all().then(function(items) { return items.length; }).catch(function() { return 0; });
  },
  remove: function(qid) {
    return _ntdQueueOpenDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction('ops', 'readwrite');
        tx.objectStore('ops').delete(qid);
        tx.oncomplete = resolve;
        tx.onerror = function() { reject(tx.error); };
      });
    });
  },
  // Register a callback fired with the current queue count whenever it changes.
  onChange: function(cb) { _ntdQueueListeners.push(cb); },
  // Replay queued writes in the order they were made (oldest first — matters
  // when a later write depends on an earlier one, e.g. equipment referencing
  // a facility_id that was only just created locally). Stops at the first
  // item that still fails, leaving the rest queued for the next attempt.
  flush: function() {
    if (_ntdQueue._flushing) return _ntdQueue._flushing;
    var p = _ntdQueue._all().then(function(items) {
      items.sort(function(a, b) { return (a.ts || 0) - (b.ts || 0); });
      return items.reduce(function(chain, item) {
        return chain.then(function() {
          return _sb._rawUpsert(item.table, item.record).then(function() {
            return _ntdQueue.remove(item.qid);
          });
        });
      }, Promise.resolve());
    }).then(function() {
      _ntdQueueNotify();
    }).catch(function() {
      _ntdQueueNotify(); // still update the visible count even on a partial flush
    });
    _ntdQueue._flushing = p.then(function() { _ntdQueue._flushing = null; });
    return p;
  }
};
window.ntdQueue = _ntdQueue;

if (typeof window !== 'undefined') {
  window.addEventListener('online', function() { _ntdQueue.flush(); });
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') _ntdQueue.flush();
  });
  setTimeout(function() { _ntdQueue.flush(); }, 1500);
  setInterval(function() { if (navigator.onLine) _ntdQueue.flush(); }, 30000);
}
window.NTD_FILTER_SIZES = [
  '--- 1" Filters ---',
  '10x20x1','12x12x1','12x24x1','14x14x1','14x20x1','14x24x1','14x25x1',
  '16x16x1','16x20x1','16x24x1','16x25x1','18x18x1','18x24x1',
  '20x20x1','20x24x1','20x25x1','24x24x1','24x30x1','25x25x1',
  '--- 2" Filters ---',
  '10x20x2','12x12x2','14x20x2','14x24x2','14x25x2',
  '16x20x2','16x24x2','16x25x2','18x18x2','18x24x2',
  '20x20x2','20x24x2','20x25x2','24x24x2','24x30x2','25x25x2',
  '--- 4" Filters ---',
  '12x24x4','14x24x4','14x25x4','16x20x4','16x24x4','16x25x4',
  '20x20x4','20x24x4','20x25x4','24x24x4','24x30x4','25x25x4',
  '--- Specialty ---',
  'Washable','HEPA','Bag Filter'
];

// ── FACILITY MATCHING ──────────────────────────────────────────────────────
// Single source of truth for "which facility is this?" — used by every tool
// instead of each one rolling its own match logic. Normalizes common naming
// noise (LLC/Inc/Corp suffixes, punctuation, spacing) so "ABC Warehouse",
// "ABC Warehouse LLC", and "ABC Warehouse, LLC." all resolve to the same
// facility_id instead of silently creating duplicates.
function _normalizeFacName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[.,'"]/g, '')
    .replace(/\b(llc|inc|incorporated|corp|corporation|co|ltd|company)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

var ntdFacilityMatch = {
  // Read-only lookup. Returns { exact: facility|null, candidates: [facility,...] }
  // candidates = other facilities that partially match but aren't an exact
  // normalized match — useful for a human-confirm picker (e.g. Site History),
  // never auto-selected on a write path.
  find: function(name) {
    var norm = _normalizeFacName(name);
    if (!norm) return Promise.resolve({ exact: null, candidates: [] });
    return _sb.list('facilities').then(function(facs) {
      facs = facs || [];
      var exact = null, candidates = [];
      facs.forEach(function(f) {
        var fn = _normalizeFacName(f.name);
        if (!fn) return;
        if (fn === norm) { exact = f; }
        else if (fn.indexOf(norm) > -1 || norm.indexOf(fn) > -1) { candidates.push(f); }
      });
      return { exact: exact, candidates: candidates };
    });
  },
  // Write-path helper: resolve to an existing facility via EXACT normalized
  // match only, or create a new one. Deliberately never auto-attaches to a
  // fuzzy candidate — that's the one thing that could silently merge two
  // different sites' data together, so a write only ever matches exactly or
  // creates fresh. `extra` (e.g. {address:...}) is only applied when creating.
  resolveOrCreate: function(name, extra) {
    var cleanName = (name || '').trim();
    return this.find(cleanName).then(function(result) {
      if (result.exact) return result.exact;
      var rec = Object.assign({ name: cleanName }, extra || {});
      return _sb.upsert('facilities', rec);
    });
  }
};

// ── UID GENERATOR ─────────────────────────────────────────────────────────────
function _uid(prefix) {
  return (prefix || 'rec') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── STORE FACTORY ─────────────────────────────────────────────────────────────
// Each store wraps a Supabase table with the same API as the old localStorage store
function _makeStore(table) {
  return {
    list: function(filterFn) {
      return _sb.list(table).then(function(rows) {
        if (!filterFn) return rows;
        return rows.filter(filterFn);
      });
    },
    get: function(id) {
      return _sb.get(table, id);
    },
    upsert: function(record) {
      return _sb.upsert(table, Object.assign({}, record));
    },
    delete: function(id) {
      return _sb.delete(table, id);
    }
  };
}

// ── FILE STORAGE ──────────────────────────────────────────────────────────────
var ntdFiles = {
  // Upload a file (blob or base64 string) — returns public URL
  upload: function(path, blob, contentType) {
    return fetch(SUPABASE_URL + '/storage/v1/object/ntd-files/' + path, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': contentType || 'application/octet-stream',
        'x-upsert': 'true'
      },
      body: blob
    }).then(function(r) {
      if (!r.ok) return r.text().then(function(t) { throw new Error(t); });
      return SUPABASE_URL + '/storage/v1/object/sign/ntd-files/' + path;
    });
  },

  // Get a signed URL for a file (valid 1 hour)
  getUrl: function(path) {
    return fetch(SUPABASE_URL + '/storage/v1/object/sign/ntd-files/' + path, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expiresIn: 3600 })
    }).then(function(r) { return r.json(); })
      .then(function(d) { return SUPABASE_URL + '/storage/v1' + d.signedURL; });
  },

  // Delete a file
  delete: function(path) {
    return fetch(SUPABASE_URL + '/storage/v1/object/ntd-files/' + path, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      }
    }).then(function() { return true; });
  }
};

// ── MIGRATION HELPERS ─────────────────────────────────────────────────────────
// Same API as the old ntdStore.migrate — tools call these unchanged
var _migrate = {
  // Called when Equipment Survey submits
  fromEquipmentSurveyWithUnits: function(site, units) {
    var facName = (site.customer || site.facility || '').trim();
    if (!facName) return Promise.reject(new Error('No facility name'));

    return ntdFacilityMatch.resolveOrCreate(facName, {
        address: site.address || '',
        city: site.city || '',
        notes: site.notes || ''
      })
      .then(function(fac) {
        var jobData = {
          facility_id: fac.id,
          type: 'survey',
          date: site.date || '',
          tech: site.tech || '',
          wo_number: site.wo || ''
        };
        return _sb.upsert('jobs', jobData).then(function(job) {
          var saves = (units || []).map(function(u) {
            var notesParts = [u.notes || ''];
            if (u.model2 || u.serial2) notesParts.push('2nd component: ' + [u.model2, u.serial2].filter(Boolean).join(' / '));
            if (u.btu) notesParts.push('BTU: ' + u.btu);
            if (u.kw) notesParts.push('KW: ' + u.kw);
            if (u.voltage) notesParts.push('Voltage: ' + u.voltage);
            if (u.heat_type) notesParts.push('Heat: ' + u.heat_type);
            return ntdUpsertEquipment({
              facility_id: fac.id,
              job_id: job.id,
              tag: u.tag || u.unit_num || '',
              type: u.type || '',
              condition: u.condition || '',
              install_year: u.install_year || u.yr || '',
              manufacturer: u.manufacturer || '',
              model: u.model1 || u.model || '',
              serial: u.serial1 || u.serial || '',
              tonnage: u.tonnage || '',
              filter_size: u.filter_size || '',
              belt_size: u.belt_size || '',
              refrigerant: u.refrigerant || '',
              notes: notesParts.filter(Boolean).join(' | ')
            });
          });
          return Promise.all(saves).then(function() {
            return { facility: fac, job: job };
          });
        });
      });
  },

  // Called when Job Prep job is loaded in Startup Checklist
  fromJobPrep: function(jobData) {
    var facName = (jobData.job_name || jobData.name || '').trim();
    if (!facName) return Promise.reject(new Error('No job name'));

    return ntdFacilityMatch.resolveOrCreate(facName, { address: jobData.address || '' })
      .then(function(fac) {
        var jobRecord = {
          facility_id: fac.id,
          type: 'startup_job',
          name: facName,
          project_number: jobData.project_number || '',
          address: jobData.address || '',
          equipment_type: jobData.equipment_type || '',
          manufacturer: jobData.manufacturer || '',
          units: jobData.units || []
        };
        return _sb.upsert('jobs', jobRecord).then(function(job) {
          return { facility: fac, job: job };
        });
      });
  }
};

// ── EXPORT / IMPORT ───────────────────────────────────────────────────────────
var _exportImport = {
  exportAll: function() {
    var tables = ['facilities','equipment','jobs','job_units','startup_records',
                  'pm_records','pm_unit_results','pm_quotes','service_quotes','documents','team_calendar','service_tickets'];
    var promises = tables.map(function(t) { return _sb.list(t); });
    return Promise.all(promises).then(function(results) {
      var blob = { _schema_version: 2, _exported_at: new Date().toISOString() };
      tables.forEach(function(t, i) { blob[t] = results[i]; });
      return blob;
    });
  },

  importAll: function(blob) {
    if (!blob || typeof blob !== 'object') throw new Error('Invalid export file.');
    var tables = ['facilities','equipment','jobs','job_units','startup_records',
                  'pm_records','pm_unit_results','pm_quotes','service_quotes','documents','team_calendar','service_tickets'];
    var promises = [];
    tables.forEach(function(t) {
      if (!Array.isArray(blob[t])) return;
      blob[t].forEach(function(record) {
        promises.push(_sb.upsert(t, record));
      });
    });
    return Promise.all(promises).then(function() { return true; });
  },

  clearAll: function() {
    // Clears all data — use with caution
    var tables = ['job_units','pm_unit_results','startup_records','pm_records',
                  'pm_quotes','service_quotes','equipment','jobs','facilities'];
    return tables.reduce(function(chain, t) {
      return chain.then(function() {
        return _sb.raw('DELETE', t, 'id=neq.___none___');
      });
    }, Promise.resolve());
  }
};

// ── PHOTO HUB ────────────────────────────────────────────────────────────────
// Shared by the three field-survey tools (which back up photos to Storage the
// instant they're taken, independent of form submission — see ntdBackupPhoto
// in each tool) AND the central Photo Hub page in ntd-hub.html. Both paths
// funnel through here so every photo gets a `documents` row and is browsable
// by facility, without changing how/when the underlying file gets uploaded.
var NTD_PHOTO_FORM_TYPES = ['facility_photo','unit_photo','data_plate_photo','site_photo'];

function _photoSignedUrl(path) {
  return fetch(SUPABASE_URL + '/storage/v1/object/sign/ntd-files/' + path, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expiresIn: 31536000 }) // 1 year, matches uploadFile()
  }).then(function(r){ return r.json(); })
    .then(function(d){ return SUPABASE_URL + '/storage/v1' + d.signedURL; });
}

function _photoDateStr() {
  var d = new Date();
  function _pad(n){ return n < 10 ? '0'+n : ''+n; }
  return _pad(d.getMonth()+1) + '/' + _pad(d.getDate()) + '/' + d.getFullYear();
}

var ntdPhotos = {
  // Log a photo file that's ALREADY been uploaded to Storage (used by
  // ntdBackupPhoto in equipment-survey / hvac-asset-survey / pm-checklist,
  // right after their existing raw upload succeeds — that upload itself is
  // unchanged). Facility is resolved by EXACT name match only and is never
  // auto-created from a photo caption; no match logs facility_id: null,
  // which the Photo Hub shows as "Unassigned".
  log: function(params) {
    if (!params || !params.path) return Promise.reject(new Error('path is required'));
    var facName = (params.facilityName || '').trim();
    var resolveFacility = facName ? ntdFacilityMatch.find(facName) : Promise.resolve({ exact: null });
    return resolveFacility.then(function(result) {
      return _photoSignedUrl(params.path).then(function(signedUrl) {
        return _sb.upsert('documents', {
          facility_id: result.exact ? result.exact.id : null,
          job_id:      null,
          form_type:   params.formType || 'unit_photo',
          description: params.description || params.formType || 'Photo',
          file_path:   params.path,
          file_url:    signedUrl,
          date:        _photoDateStr(),
          tech:        params.tech || '',
          unit_count:  0,
          ts:          Date.now()
        });
      });
    }).catch(function(err) {
      console.warn('[NTD] Photo log failed (raw backup already succeeded, safe to ignore for form flow):', err);
    });
  },

  // Manual upload from the Photo Hub's "+ Add Photo" flow. facilityId is
  // optional — omit it for an "Unassigned" photo the user can tag later.
  upload: function(params) {
    if (!params || !params.blob) return Promise.reject(new Error('blob is required'));
    var slug = (params.facilityName || 'unassigned')
      .replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 40) || 'unassigned';
    var path = 'photo-backups/' + slug + '/hub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.jpg';
    return ntdFiles.upload(path, params.blob, params.mimeType || 'image/jpeg').then(function() {
      return _photoSignedUrl(path).then(function(signedUrl) {
        return _sb.upsert('documents', {
          facility_id: params.facilityId || null,
          job_id:      null,
          equipment_id: params.equipmentId || null,
          form_type:   params.formType || 'facility_photo',
          description: params.description || 'Photo',
          file_path:   path,
          file_url:    signedUrl,
          date:        _photoDateStr(),
          tech:        params.tech || '',
          unit_count:  0,
          ts:          Date.now()
        });
      });
    });
  },

  // Browse photos across every facility, or filtered to one. Excludes PDFs
  // and other document types by only matching known photo form_types.
  list: function(opts) {
    opts = opts || {};
    return _sb.list('documents').then(function(rows) {
      return (rows || []).filter(function(d) {
        if (NTD_PHOTO_FORM_TYPES.indexOf(d.form_type) === -1) return false;
        if (opts.facilityId === 'unassigned' && d.facility_id) return false;
        if (opts.facilityId && opts.facilityId !== 'unassigned' && d.facility_id !== opts.facilityId) return false;
        if (opts.formType && opts.formType !== 'all' && d.form_type !== opts.formType) return false;
        return true;
      }).sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
    });
  }
};

// ── EQUIPMENT DEDUPLICATION ────────────────────────────────────────────────
// Matches an incoming equipment record against what's already on file for the
// same facility, so the same physical unit doesn't accumulate a separate row
// every time a different tool touches it. Serial number is checked first —
// it's the one identifier that's actually permanent and unique to the unit —
// falling back to tag only when no serial is available on either side (some
// tools, like PM Checklist, don't collect serial at all; some techs skip the
// tag). On a match, only fields present in the incoming record overwrite the
// existing row, so a thinner submission never blanks out richer data another
// source already captured.
function _normalizeEqKey(s) {
  return (s || '').toString().trim().toLowerCase();
}

function ntdUpsertEquipment(record) {
  if (!record.facility_id) return _sb.upsert('equipment', record);
  return _sb.list('equipment').then(function(all) {
    var existing = (all || []).filter(function(e) { return e.facility_id === record.facility_id; });
    var match = null;

    var serialKey = _normalizeEqKey(record.serial);
    if (serialKey) {
      match = existing.find(function(e) { return _normalizeEqKey(e.serial) === serialKey; });
    }
    if (!match) {
      var tagKey = _normalizeEqKey(record.tag);
      if (tagKey) {
        match = existing.find(function(e) { return _normalizeEqKey(e.tag) === tagKey; });
      }
    }

    if (match) {
      var merged = { id: match.id };
      Object.keys(record).forEach(function(key) {
        var v = record[key];
        if (v !== undefined && v !== null && v !== '') merged[key] = v;
      });
      return _sb.upsert('equipment', merged);
    }
    return _sb.upsert('equipment', record);
  });
}

// ── NTDSTORE PUBLIC API ───────────────────────────────────────────────────────
// Same interface as the localStorage version — no tool code changes needed
var ntdStore = {
  facilities:     _makeStore('facilities'),
  equipment:      _makeStore('equipment'),
  jobs:           _makeStore('jobs'),
  job_units:      _makeStore('job_units'),
  startup_records:_makeStore('startup_records'),
  pm_records:     _makeStore('pm_records'),
  pm_unit_results:_makeStore('pm_unit_results'),
  pm_quotes:      _makeStore('pm_quotes'),
  service_quotes: _makeStore('service_quotes'),
  settings:       _makeStore('facilities'), // settings not needed with Supabase
  documents:      _makeStore('documents'),
  team_calendar:  _makeStore('team_calendar'),
  service_tickets:_makeStore('service_tickets'),
  notifications:  _makeStore('notifications'),
  migrate:        _migrate,
  matchFacility:  ntdFacilityMatch,
  upsertEquipment:ntdUpsertEquipment,
  exportAll:      _exportImport.exportAll,
  importAll:      _exportImport.importAll,
  clearAll:       _exportImport.clearAll,
  files:          ntdFiles,
  photos:         ntdPhotos,

  // ── PDF UPLOAD HELPER ────────────────────────────────────────────────────
  // Call this after generating a PDF blob to upload it and save a document record
  // params: { blob, facilityId, formType, description, date, tech, unitCount }
  uploadFile: function(params) {
    if (!params.blob || !params.facilityId) {
      return Promise.reject(new Error('blob and facilityId are required'));
    }
    var ts    = Date.now();
    // Normalize date to MM/DD/YYYY with leading zeros for consistent matching
    function _pad(n){ return n < 10 ? '0'+n : ''+n; }
    var _rawDate = params.date || '';
    var _dateObj = _rawDate ? new Date(_rawDate.replace(/-/g,'/')) : new Date();
    var date = isNaN(_dateObj.getTime())
      ? _rawDate
      : _pad(_dateObj.getMonth()+1) + '/' + _pad(_dateObj.getDate()) + '/' + _dateObj.getFullYear();
    var fType    = params.formType || 'document';
    var mimeType = params.mimeType || 'application/pdf';
    var ext      = params.ext || 'pdf';
    var path     = 'pdfs/' + params.facilityId + '/' + fType + '_' + ts + '.' + ext;

    return ntdFiles.upload(path, params.blob, mimeType)
      .then(function() {
        // Get a signed URL valid for 1 year (31536000 seconds)
        return fetch(SUPABASE_URL + '/storage/v1/object/sign/ntd-files/' + path, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ expiresIn: 31536000 })
        }).then(function(r){ return r.json(); })
          .then(function(d){
            var signedUrl = SUPABASE_URL + '/storage/v1' + d.signedURL;
            return _sb.upsert('documents', {
              facility_id:  params.facilityId,
              job_id:       params.jobId || null,
              form_type:    fType,
              description:  params.description || fType,
              file_path:    path,
              file_url:     signedUrl,
              date:         date,
              tech:         params.tech || '',
              unit_count:   params.unitCount || 0,
              ts:           ts
            });
          });
      });
  },
  uploadPDF: function(params) {
    return this.uploadFile(Object.assign({}, params, { mimeType: 'application/pdf', ext: 'pdf' }));
  }
};

// ── BACKWARDS COMPATIBILITY ───────────────────────────────────────────────────
// The old localStorage store used collection-based filtering
// This patch ensures filterFn still works on list() calls
(function() {
  var stores = ['facilities','equipment','jobs','job_units','startup_records',
                'pm_records','pm_unit_results','pm_quotes','service_quotes','documents','team_calendar','notifications','service_tickets'];
  stores.forEach(function(name) {
    var original = ntdStore[name].list;
    ntdStore[name].list = function(filterFn) {
      return _sb.list(name).then(function(rows) {
        if (typeof filterFn === 'function') return rows.filter(filterFn);
        return rows;
      });
    };
  });
})();

console.log('[NTD] ntdStore connected to Supabase:', SUPABASE_URL);
