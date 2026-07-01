/**
 * ntdStore.js — NTD Mechanical Unified Data Layer
 * Version: 1.0.0
 *
 * ABSTRACTION CONTRACT:
 * All tool code calls ONLY the functions exported from this module.
 * Internals (localStorage today, Supabase tomorrow) are swapped here
 * without touching any tool file.
 *
 * USAGE (in any tool HTML file):
 *   <script src="ntdStore.js"></script>
 *   const fac = await ntdStore.facilities.get('fac_abc123');
 */

(function (global) {
  'use strict';

  // ─── SCHEMA VERSION ───────────────────────────────────────────────────────
  var SCHEMA_VERSION = 1;

  // ─── localStorage KEY NAMESPACE ───────────────────────────────────────────
  var NS = 'ntd_';
  var KEYS = {
    facilities:       NS + 'facilities',
    equipment:        NS + 'equipment',
    jobs:             NS + 'jobs',
    job_units:        NS + 'job_units',
    startup_records:  NS + 'startup_records',
    pm_records:       NS + 'pm_records',
    pm_unit_results:  NS + 'pm_unit_results',
    pm_quotes:        NS + 'pm_quotes',
    service_quotes:   NS + 'service_quotes',
    settings:         NS + 'settings',
    _meta:            NS + '_meta'
  };

  // ─── INTERNAL HELPERS ─────────────────────────────────────────────────────

  /** Generate a short unique ID: prefix + timestamp + random */
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /** ISO timestamp string */
  function now() {
    return new Date().toISOString();
  }

  /** Read a full collection from localStorage. Returns {} if missing/corrupt. */
  function readCollection(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn('[ntdStore] Could not parse collection:', key, e);
      return {};
    }
  }

  /** Write a full collection to localStorage. */
  function writeCollection(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('[ntdStore] Write failed (storage full?):', key, e);
      return false;
    }
  }

  /**
   * Generic CRUD factory.
   * Returns { list, get, upsert, delete } operating on a named localStorage collection.
   * Each record automatically gets: id, created_at, updated_at.
   */
  function makeStore(collectionKey) {
    return {
      /**
       * List all records, optionally filtered.
       * @param {Function} [filterFn] - optional predicate (record) => bool
       * @returns {Promise<Array>}
       */
      list: function (filterFn) {
        return Promise.resolve().then(function () {
          var col = readCollection(collectionKey);
          var records = Object.values(col);
          return filterFn ? records.filter(filterFn) : records;
        });
      },

      /**
       * Get a single record by ID.
       * @param {string} id
       * @returns {Promise<Object|null>}
       */
      get: function (id) {
        return Promise.resolve().then(function () {
          var col = readCollection(collectionKey);
          return col[id] || null;
        });
      },

      /**
       * Insert or update a record.
       * Supplying an object without an id creates a new record.
       * Supplying an id that exists performs a merge update.
       * @param {Object} record
       * @returns {Promise<Object>} the saved record
       */
      upsert: function (record) {
        return Promise.resolve().then(function () {
          var col = readCollection(collectionKey);
          var isNew = !record.id || !col[record.id];
          var existing = isNew ? {} : col[record.id];
          var saved = Object.assign({}, existing, record, {
            id:         record.id || uid(collectionKey.replace(NS, '').slice(0, 4)),
            updated_at: now()
          });
          if (isNew) saved.created_at = saved.created_at || now();
          col[saved.id] = saved;
          writeCollection(collectionKey, col);
          return saved;
        });
      },

      /**
       * Delete a record by ID.
       * @param {string} id
       * @returns {Promise<boolean>}
       */
      delete: function (id) {
        return Promise.resolve().then(function () {
          var col = readCollection(collectionKey);
          if (!col[id]) return false;
          delete col[id];
          writeCollection(collectionKey, col);
          return true;
        });
      }
    };
  }

  // ─── CORE STORES ──────────────────────────────────────────────────────────

  /**
   * FACILITIES
   * One record per customer / building.
   * Schema:
   *   id            string  — auto: 'faci_...'
   *   name          string  — customer / company name
   *   address       string  — street address
   *   city          string
   *   state         string  — default 'TX'
   *   contact_name  string
   *   contact_phone string
   *   contact_email string
   *   fuel_type     string  — 'Gas' | 'Electric' | 'Both'
   *   fence         string  — 'Yes' | 'No'
   *   notes         string
   *   created_at    ISO string
   *   updated_at    ISO string
   */
  var facilities = makeStore(KEYS.facilities);

  /**
   * EQUIPMENT
   * One record per physical unit. Linked to a facility.
   * Schema:
   *   id              string  — auto: 'equi_...'
   *   facility_id     string  — FK → facilities.id
   *   tag             string  — e.g. 'RTU-1'
   *   type            string  — 'RTU' | 'Split' | 'AHU' | 'Chiller' | 'Boiler' | 'Exhaust Fan'
   *   model           string  — primary model #
   *   serial          string  — primary serial #
   *   model2          string  — secondary model # (if applicable)
   *   serial2         string  — secondary serial #
   *   tonnage         string  — e.g. '5T'
   *   btu             string
   *   kw              string
   *   refrigerant     string  — e.g. 'R-410A'
   *   voltage         string  — e.g. '208/3'
   *   heat_type       string  — 'Gas' | 'Electric' | 'Heat Pump'
   *   manufacturer    string
   *   cfm             string | number
   *   mca             string | number  — Minimum Circuit Ampacity
   *   mop             string | number  — Max Overcurrent Protection
   *   heat_mbh        string | number
   *   filter_size     string
   *   belt_size       string
   *   install_date    string  — date installed (if known)
   *   location        string  — roof zone, suite, etc.
   *   notes           string
   *   survey_id       string  — FK → jobs.id of the survey job that created this
   *   created_at      ISO string
   *   updated_at      ISO string
   */
  var equipment = makeStore(KEYS.equipment);

  /**
   * JOBS
   * One record per job / work order.
   * Schema:
   *   id              string  — auto: 'job_...'
   *   facility_id     string  — FK → facilities.id
   *   type            string  — 'survey' | 'install' | 'startup' | 'pm' | 'service'
   *   wo_number       string  — work order / job number
   *   project_number  string
   *   date            string  — MM/DD/YYYY or ISO
   *   tech            string  — technician name
   *   status          string  — 'draft' | 'in_progress' | 'complete'
   *   notes           string
   *   slug            string  — URL-safe identifier (from job-prep)
   *   gh_published    boolean — whether published to GitHub Pages
   *   created_at      ISO string
   *   updated_at      ISO string
   */
  var jobs = makeStore(KEYS.jobs);

  /**
   * JOB_UNITS
   * Join table: which equipment records are involved in a job.
   * Schema:
   *   id              string  — auto
   *   job_id          string  — FK → jobs.id
   *   equipment_id    string  — FK → equipment.id
   *   sort_order      number
   *   created_at      ISO string
   *   updated_at      ISO string
   */
  var job_units = makeStore(KEYS.job_units);

  /**
   * STARTUP_RECORDS
   * One per unit per startup job.
   * Schema:
   *   id              string  — auto: 'strt_...'
   *   job_id          string  — FK → jobs.id
   *   equipment_id    string  — FK → equipment.id (null if not yet linked)
   *   unit_num        string  — label / tag at time of startup
   *   eq_type         string  — equipment type key
   *   snapshot        object  — full form snapshot (fields, yns, mfnas)
   *   notes           string
   *   followup        string
   *   photos          array   — [{caption, data}]
   *   sig_name        string
   *   sig_date        string
   *   created_at      ISO string
   *   updated_at      ISO string
   */
  var startup_records = makeStore(KEYS.startup_records);

  /**
   * PM_RECORDS
   * Header for one PM visit.
   * Schema:
   *   id              string  — auto: 'pmrec_...'
   *   job_id          string  — FK → jobs.id
   *   facility_id     string  — FK → facilities.id
   *   visit_label     string  — e.g. 'Q2 2026'
   *   date            string
   *   tech            string
   *   sig_tech        string
   *   sig_cust        string
   *   notes           string
   *   created_at      ISO string
   *   updated_at      ISO string
   */
  var pm_records = makeStore(KEYS.pm_records);

  /**
   * PM_UNIT_RESULTS
   * One per unit per PM visit.
   * Schema:
   *   id              string  — auto: 'pmur_...'
   *   pm_record_id    string  — FK → pm_records.id
   *   equipment_id    string  — FK → equipment.id
   *   snapshot        object  — all Y/N and reading fields
   *   notes           string
   *   created_at      ISO string
   *   updated_at      ISO string
   */
  var pm_unit_results = makeStore(KEYS.pm_unit_results);

  /**
   * PM_QUOTES
   * Proposed PM agreements.
   * Schema:
   *   id              string  — auto: 'pmq_...'
   *   facility_id     string  — FK → facilities.id
   *   agreement_number string
   *   agreement_date  string
   *   renewal_date    string
   *   attention       string
   *   frequency       string  — 'Monthly' | 'Quarterly' | 'Semi-Annual' | 'Annual'
   *   visits_per_year number
   *   selected_plans  array   — plan names
   *   annual_price    number
   *   quarterly_price number
   *   cost_filter     number
   *   cost_belt       number
   *   cost_coil       number
   *   equipment_rows  array   — [{equipment_id, tag, type, tons, plan, annual}]
   *   status          string  — 'draft' | 'sent' | 'accepted' | 'declined'
   *   notes           string
   *   created_at      ISO string
   *   updated_at      ISO string
   */
  var pm_quotes = makeStore(KEYS.pm_quotes);

  /**
   * SERVICE_QUOTES
   * One-time service proposals.
   * Schema:
   *   id              string  — auto: 'svq_...'
   *   facility_id     string  — FK → facilities.id
   *   date            string
   *   attention       string
   *   line_items      array   — [{description, qty, unit_price, total}]
   *   subtotal        number
   *   tax_rate        number
   *   tax_amount      number
   *   total           number
   *   notes           string
   *   status          string  — 'draft' | 'sent' | 'accepted' | 'declined'
   *   created_at      ISO string
   *   updated_at      ISO string
   */
  var service_quotes = makeStore(KEYS.service_quotes);

  /**
   * SETTINGS
   * App-level key/value config. Not a keyed collection — single object.
   * Keys: gh_token, anthropic_api_key, default_tech, default_state, etc.
   */
  var settings = {
    get: function (key) {
      return Promise.resolve().then(function () {
        var s = readCollection(KEYS.settings);
        return key ? (s[key] !== undefined ? s[key] : null) : s;
      });
    },
    set: function (key, value) {
      return Promise.resolve().then(function () {
        var s = readCollection(KEYS.settings);
        s[key] = value;
        s.updated_at = now();
        writeCollection(KEYS.settings, s);
        return true;
      });
    },
    remove: function (key) {
      return Promise.resolve().then(function () {
        var s = readCollection(KEYS.settings);
        delete s[key];
        writeCollection(KEYS.settings, s);
        return true;
      });
    }
  };

  // ─── CONVENIENCE QUERIES ──────────────────────────────────────────────────

  var queries = {
    /**
     * Get all equipment for a facility.
     * @param {string} facilityId
     * @returns {Promise<Array>}
     */
    equipmentByFacility: function (facilityId) {
      return equipment.list(function (e) { return e.facility_id === facilityId; });
    },

    /**
     * Get all jobs for a facility, optionally filtered by type.
     * @param {string} facilityId
     * @param {string} [type]  — 'survey' | 'startup' | 'pm' | 'service'
     * @returns {Promise<Array>}
     */
    jobsByFacility: function (facilityId, type) {
      return jobs.list(function (j) {
        return j.facility_id === facilityId && (!type || j.type === type);
      });
    },

    /**
     * Get all startup records for a job.
     * @param {string} jobId
     * @returns {Promise<Array>}
     */
    startupsByJob: function (jobId) {
      return startup_records.list(function (s) { return s.job_id === jobId; });
    },

    /**
     * Get all PM unit results for a PM record.
     * @param {string} pmRecordId
     * @returns {Promise<Array>}
     */
    pmResultsByRecord: function (pmRecordId) {
      return pm_unit_results.list(function (r) { return r.pm_record_id === pmRecordId; });
    },

    /**
     * Get all PM records for a facility, sorted newest first.
     * @param {string} facilityId
     * @returns {Promise<Array>}
     */
    pmHistoryByFacility: function (facilityId) {
      return pm_records.list(function (r) { return r.facility_id === facilityId; }).then(function (rows) {
        return rows.sort(function (a, b) { return (b.date || '') > (a.date || '') ? 1 : -1; });
      });
    },

    /**
     * Search facilities by name (case-insensitive substring).
     * @param {string} query
     * @returns {Promise<Array>}
     */
    searchFacilities: function (query) {
      var q = (query || '').toLowerCase();
      return facilities.list(function (f) {
        return (f.name || '').toLowerCase().indexOf(q) !== -1 ||
               (f.address || '').toLowerCase().indexOf(q) !== -1;
      });
    },

    /**
     * Get equipment records linked to a job via job_units.
     * @param {string} jobId
     * @returns {Promise<Array>} equipment records, in sort_order
     */
    equipmentByJob: function (jobId) {
      return job_units.list(function (ju) { return ju.job_id === jobId; }).then(function (links) {
        links.sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
        return Promise.all(links.map(function (ju) { return equipment.get(ju.equipment_id); }))
          .then(function (records) { return records.filter(Boolean); });
      });
    }
  };

  // ─── MIGRATION / IMPORT HELPERS ───────────────────────────────────────────

  var migrate = {
    /**
     * Import an equipment-survey.html JSON save file into the store.
     * Creates or updates a facility, equipment records, and a survey job.
     * @param {Object} surveyJson — parsed JSON from doSave() in equipment-survey.html
     * @returns {Promise<{facility, job, equipment: Array}>}
     */
    fromEquipmentSurvey: function (surveyJson) {
      var site = surveyJson.site || {};

      // 1. Upsert facility
      return facilities.upsert({
        name:    site['j-cust']  || '',
        address: site['j-addr']  || '',
        fuel_type: site['j-fuel'] || '',
        fence:   site['j-fence'] || '',
        notes:   site['j-notes'] || ''
      }).then(function (fac) {

        // 2. Upsert survey job
        return jobs.upsert({
          facility_id:    fac.id,
          type:           'survey',
          wo_number:      site['j-wo']   || '',
          date:           site['j-date'] || '',
          tech:           site['j-tech'] || '',
          status:         'complete',
          notes:          site['i-notes'] || ''
        }).then(function (job) {
          return { fac: fac, job: job };
        });

      }).then(function (ctx) {
        // 3. Build equipment records from uid counter
        // Note: the survey JSON v2 does NOT store unit data in site{} —
        // unit data lives only in DOM. This helper handles v2 JSON (site/uid only).
        // For full unit import, pass units array separately (see fromEquipmentSurveyWithUnits).
        return { facility: ctx.fac, job: ctx.job, equipment: [] };
      });
    },

    /**
     * Import equipment-survey data including units array.
     * Pass site object and units array extracted from the form.
     * @param {Object} site   — field map from equipment-survey DOM
     * @param {Array}  units  — array of unit field objects
     * @returns {Promise<{facility, job, equipment: Array}>}
     */
    fromEquipmentSurveyWithUnits: function (site, units) {
      return facilities.upsert({
        name:      site['j-cust']  || '',
        address:   site['j-addr']  || '',
        fuel_type: site['j-fuel']  || '',
        fence:     site['j-fence'] || '',
        notes:     site['j-notes'] || ''
      }).then(function (fac) {
        return jobs.upsert({
          facility_id: fac.id,
          type:        'survey',
          wo_number:   site['j-wo']   || '',
          date:        site['j-date'] || '',
          tech:        site['j-tech'] || '',
          status:      'complete'
        }).then(function (job) {

          var eqPromises = (units || []).map(function (u, idx) {
            return equipment.upsert({
              facility_id:  fac.id,
              survey_id:    job.id,
              tag:          u.tag       || ('Unit ' + (idx + 1)),
              type:         u.type      || '',
              model:        u.model1    || u.model || '',
              serial:       u.serial1   || u.serial || '',
              model2:       u.model2    || '',
              serial2:      u.serial2   || '',
              tonnage:      u.tonnage   || '',
              btu:          u.btu       || '',
              kw:           u.kw        || '',
              refrigerant:  u.refrigerant || '',
              voltage:      u.voltage   || '',
              heat_type:    u.heat_type || '',
              notes:        u.notes     || ''
            }).then(function (eq) {
              return job_units.upsert({
                job_id:       job.id,
                equipment_id: eq.id,
                sort_order:   idx
              }).then(function () { return eq; });
            });
          });

          return Promise.all(eqPromises).then(function (eqs) {
            return { facility: fac, job: job, equipment: eqs };
          });
        });
      });
    },

    /**
     * Import a job-prep.html job object into the store.
     * @param {Object} jobPrepObj — the JSON object published by job-prep.html
     * @returns {Promise<{facility, job, equipment: Array}>}
     */
    fromJobPrep: function (jobPrepObj) {
      return facilities.upsert({
        name:         jobPrepObj.job_name     || '',
        address:      jobPrepObj.address      || '',
        notes:        jobPrepObj.notes        || ''
      }).then(function (fac) {
        return jobs.upsert({
          facility_id:     fac.id,
          type:            'install',
          project_number:  jobPrepObj.project_number || '',
          slug:            jobPrepObj.job_slug        || '',
          status:          'draft',
          notes:           jobPrepObj.notes           || ''
        }).then(function (job) {

          var eqPromises = (jobPrepObj.units || []).map(function (u, idx) {
            return equipment.upsert({
              facility_id:  fac.id,
              tag:          u.tag        || '',
              type:         u.type       || jobPrepObj.equipment_type || '',
              model:        u.model      || '',
              tonnage:      u.tons ? u.tons + 'T' : '',
              voltage:      jobPrepObj.voltage     || '',
              refrigerant:  jobPrepObj.refrigerant || '',
              manufacturer: jobPrepObj.manufacturer || '',
              filter_size:  u.filter_size  || jobPrepObj.filter_type || '',
              belt_size:    u.belt_size    || '',
              mca:          u.mca          || '',
              mop:          u.mop          || '',
              heat_mbh:     u.heat_mbh     || '',
              cfm:          u.cfm          || ''
            }).then(function (eq) {
              return job_units.upsert({
                job_id:       job.id,
                equipment_id: eq.id,
                sort_order:   idx
              }).then(function () { return eq; });
            });
          });

          return Promise.all(eqPromises).then(function (eqs) {
            return { facility: fac, job: job, equipment: eqs };
          });
        });
      });
    }
  };

  // ─── EXPORT / IMPORT ──────────────────────────────────────────────────────

  var io = {
    /**
     * Export the entire store as a JSON blob (for backup).
     * @returns {Promise<Object>}
     */
    exportAll: function () {
      return Promise.resolve().then(function () {
        var out = { _schema_version: SCHEMA_VERSION, _exported_at: now() };
        Object.keys(KEYS).forEach(function (k) {
          out[k] = readCollection(KEYS[k]);
        });
        return out;
      });
    },

    /**
     * Import a backup JSON blob. Merges into existing data (upsert by id).
     * @param {Object} blob — output of exportAll()
     * @returns {Promise<boolean>}
     */
    importAll: function (blob) {
      return Promise.resolve().then(function () {
        if (!blob || typeof blob !== 'object') {
          throw new Error('Invalid export file.');
        }
        // Warn on schema mismatch but don't block — merge what we can
        if (blob._schema_version && blob._schema_version !== SCHEMA_VERSION) {
          console.warn('[NTD] Schema version mismatch — importing anyway. Export:', blob._schema_version, 'Current:', SCHEMA_VERSION);
        }
        Object.keys(KEYS).forEach(function (k) {
          if (blob[k] && typeof blob[k] === 'object') {
            var existing = readCollection(KEYS[k]);
            var merged = Object.assign({}, existing, blob[k]);
            writeCollection(KEYS[k], merged);
          }
        });
        return true;
      });
    },

    /**
     * Clear ALL ntdStore data from localStorage.
     * Use with caution — irreversible without a backup.
     * @returns {Promise<boolean>}
     */
    clearAll: function () {
      return Promise.resolve().then(function () {
        Object.values(KEYS).forEach(function (key) {
          localStorage.removeItem(key);
        });
        return true;
      });
    }
  };

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  var ntdStore = {
    // Version info
    version: SCHEMA_VERSION,

    // Core stores (CRUD)
    facilities:      facilities,
    equipment:       equipment,
    jobs:            jobs,
    job_units:       job_units,
    startup_records: startup_records,
    pm_records:      pm_records,
    pm_unit_results: pm_unit_results,
    pm_quotes:       pm_quotes,
    service_quotes:  service_quotes,
    settings:        settings,

    // Convenience queries
    queries: queries,

    // Migration helpers
    migrate: migrate,

    // Backup/restore
    io: io,

    // Utility (available to tools if needed)
    uid: uid,
    now: now
  };

  // Expose globally
  global.ntdStore = ntdStore;

}(typeof window !== 'undefined' ? window : this));
