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

  return {
    // Get all rows, optional filter string e.g. 'facility_id=eq.abc'
    list: function(table, filter) {
      var params = 'order=ts.desc.nullslast';
      if (filter) params += '&' + filter;
      return req('GET', table, params);
    },
    // Get single row by id
    get: function(table, id) {
      return req('GET', table, 'id=eq.' + encodeURIComponent(id)).then(function(rows) {
        return rows && rows.length ? rows[0] : null;
      });
    },
    // Upsert a record (insert or update by id)
    upsert: function(table, record) {
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
    },
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
            return _sb.upsert('equipment', {
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
    var facName = (jobData.job_name || '').trim();
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
                  'pm_records','pm_unit_results','pm_quotes','service_quotes','documents','team_calendar'];
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
                  'pm_records','pm_unit_results','pm_quotes','service_quotes','documents','team_calendar'];
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
  notifications:  _makeStore('notifications'),
  migrate:        _migrate,
  matchFacility:  ntdFacilityMatch,
  exportAll:      _exportImport.exportAll,
  importAll:      _exportImport.importAll,
  clearAll:       _exportImport.clearAll,
  files:          ntdFiles,

  // ── PDF UPLOAD HELPER ────────────────────────────────────────────────────
  // Call this after generating a PDF blob to upload it and save a document record
  // params: { blob, facilityId, formType, description, date, tech, unitCount }
  uploadPDF: function(params) {
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
    var fType = params.formType || 'document';
    var path  = 'pdfs/' + params.facilityId + '/' + fType + '_' + ts + '.pdf';

    return ntdFiles.upload(path, params.blob, 'application/pdf')
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
  }
};

// ── BACKWARDS COMPATIBILITY ───────────────────────────────────────────────────
// The old localStorage store used collection-based filtering
// This patch ensures filterFn still works on list() calls
(function() {
  var stores = ['facilities','equipment','jobs','job_units','startup_records',
                'pm_records','pm_unit_results','pm_quotes','service_quotes','documents','team_calendar','notifications'];
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
