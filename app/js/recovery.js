/* =========================================================================
   recovery.js — بازیابی خودکار داده‌ها و ایمنی داده (۳٫۳۶)
   -------------------------------------------------------------------------
   چرا این ماژول وجود دارد؟
     داده‌های برنامه در IndexedDB مرورگر (پایگاه‌دادهٔ «RollMonitorDB»)
     ذخیره می‌شود — نه در فایل‌های پروژه. مرورگر داده‌ها را به «مبدأ»
     (Protocol + Host + Port — و در حالت آفلاین file:// به همین پوشهٔ
     فایل) و همان مرورگر گره می‌زند. جابه‌جایی فایل‌های پروژه (پوشهٔ
     app/ و…) هرگز داده‌ها را پاک نمی‌کند؛ اما اگر نسخهٔ جدید در پوشه/
     مرورگر/نشانیِ متفاوتی باز شود، برنامه به انبارِ دادهٔ دیگری نگاه
     می‌کند و «خالی» دیده می‌شود. این ماژول آن وضعیت را خودکار تشخیص،
     گزارش و تا جای ممکن اصلاح می‌کند.

   سه لایهٔ ایمنی (به‌ترتیب اجرا در شروع برنامه وقتی برنامه خالی است):
     ۱) پشتیبان خودکار (Autosave Mirror):
        پس از هر تغییر داده، یک نسخهٔ فشردهٔ کامل (بدون سطر خام اکسل)
        در localStorage (کلید rm-autobackup-v1) آینه می‌شود. اگر
        IndexedDB خالی/موقتاً از دست رفته ولی آینه سالم باشد →
        بازیابی خودکار + پیام.
     ۲) اسکن پایگاه‌داده‌های قدیمی:
        با indexedDB.databases() همهٔ پایگاه‌داده‌های همین مبدأ فهرست
        می‌شوند؛ هر پایگاه‌دادهٔ غیرجاری که «شکل رکورد رول» معتبر داشته
        باشد (و متعلق به برنامهٔ خواهر eva-roll-monitor نباشد) با
        اعتبارسنجی و نرمال‌سازی به پایگاه‌دادهٔ جاری ایمپورت می‌شود —
        بدون دست‌بردن به منبع.
     ۳) پنل بازیابی:
        اگر هیچ منبعی یافت نشد، پنل راهنما بالای برنامه ظاهر می‌شود:
        توضیح علت (مبدأ/پوشه/مرورگر)، نشانی فعلی، دکمهٔ «بازیابی از
        فایل پشتیبان» و «اسکن مجدد» — و در حالت آفلاین (file://)
        راهنمای گام‌به‌گام اتصال مجدد به پوشهٔ قبلی.

   نکات:
     · پشتیبان خودکار «فشرده» است: فیلد raw (سطر خام اکسل) حذف می‌شود
       تا داده‌های حجیم (تا ~۵ مگابایت) در سهمیهٔ localStorage جا شود؛
       محاسبات، چارت‌ها و گزارش‌ها به raw نیازی ندارند.
     · «پاک‌سازی کامل برنامه» (تنظیمات) آینه و پرچم‌ها را هم پاک
       می‌کند تا دادهٔ عمداً حذف‌شده دوباره برنگردد.
     · همهٔ مسیرها Idempotent و Fail-Safe اند (خطا هر لایه، لایهٔ بعد
       را مسدود نمی‌کند).
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;

  const AUTOSAVE_KEY = 'rm-autobackup-v1';
  const DISMISS_KEY = 'rm-recovery-dismissed';

  const Recovery = {};

  /* ================================================================
     ۱) تشخیص خالی بودن برنامه
     ================================================================ */

  /** آیا برنامه هیچ داده‌ای ندارد؟ (همهٔ جدول‌های اصلی) */
  Recovery.isEmpty = async function () {
    const db = RM.db.db;
    const counts = await Promise.all([
      db.rolls.count(),
      db.archivedRolls.count(),
      db.setupRolls.count(),
      db.standardLengthRules.count(),
      db.pallets.count(),
      db.importMetadata.count(),
    ]);
    return counts.every((c) => c === 0);
  };

  /* ================================================================
     ۲) پشتیبان خودکار (Autosave Mirror در localStorage)
     ================================================================ */

  /** ساخت نسخهٔ فشردهٔ پشتیبان — raw سطرهای اکسل حذف می‌شود */
  function compactPayload(payload) {
    const stripRaw = (rows) =>
      rows.map((r) => {
        if (!r || typeof r !== 'object') return r;
        const c = { ...r };
        delete c.raw;
        delete c.data;
        return c;
      });

    const d = payload.data;
    const out = {
      ...payload,
      autosave: true,
      compact: true,
      data: { ...d },
    };
    for (const t of ['rolls', 'archivedRolls', 'pallets']) {
      if (Array.isArray(d[t])) out.data[t] = stripRaw(d[t]);
    }
    return out;
  }

  /** نوشتن آینهٔ پشتیبان (با محافظ سهمیهٔ localStorage) */
  Recovery.writeAutosave = async function () {
    try {
      const payload = compactPayload(await RM.backupEngine.build());
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
        return { ok: true, compact: true };
      } catch {
        /* سهمیه پر است — فقط نشانگر کوچک ذخیره می‌شود */
        try {
          localStorage.setItem(
            AUTOSAVE_KEY,
            JSON.stringify({
              autosave: true,
              tooBig: true,
              at: Date.now(),
              counts: payload.counts,
            })
          );
        } catch { /* حالت خصوصی/سهمیهٔ کامل — بی‌صدا */ }
        return { ok: false, reason: 'quota' };
      }
    } catch {
      return { ok: false, reason: 'build' };
    }
  };

  let autosaveTimer = null;

  /** زمان‌بندی نوشتن آینه (Debounced — پس از هر refreshAll) */
  Recovery.scheduleAutosave = function () {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      autosaveTimer = null;
      try {
        if (!(await Recovery.isEmpty())) await Recovery.writeAutosave();
      } catch { /* بی‌صدا */ }
    }, 2000);
  };

  /** خواندن آینه — خروجی: { payload } | { tooBig } | null */
  Recovery.readAutosave = function () {
    let raw = null;
    try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch { return null; }
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return null;
      if (p.tooBig) return { tooBig: true, at: p.at, counts: p.counts };
      if (!p.data) return null;
      return { payload: p };
    } catch { return null; }
  };

  /** بازیابی از آینهٔ پشتیبان خودکار */
  Recovery.restoreFromAutosave = async function () {
    const mirror = Recovery.readAutosave();
    if (!mirror || !mirror.payload) return { ok: false };
    const check = RM.backupEngine.validate(mirror.payload);
    if (!check.ok) return { ok: false };
    try {
      const res = await RM.backupEngine.restore(mirror.payload);
      return res.ok ? { ok: true, counts: res.counts } : { ok: false };
    } catch {
      return { ok: false };
    }
  };

  /* ================================================================
     ۳) اسکن و ایمپورت پایگاه‌داده‌های قدیمی (همین مبدأ مرورگر)
     ================================================================ */

  /** بازکردن پایگاه‌دادهٔ موجود با IndexedDB خام (بدون Dexie) */
  function openRaw(name) {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(name); } catch (e) { reject(e); return; }
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  }

  /** خواندن کامل یک ObjectStore (null اگر موجود نیست) */
  function readAll(idb, store) {
    return new Promise((resolve, reject) => {
      if (!idb.objectStoreNames.contains(store)) { resolve(null); return; }
      let rq;
      try { rq = idb.transaction(store, 'readonly').objectStore(store).getAll(); }
      catch (e) { reject(e); return; }
      rq.onsuccess = () => resolve(rq.result || []);
      rq.onerror = () => reject(rq.error);
    });
  }

  /** آیا رکوردهای رول شکل معتبر دارند؟ (v1: data خام · v2+: rollNumber) */
  function looksLikeRollRecords(rows) {
    if (!rows.length) return false;
    let ok = 0;
    for (const r of rows) {
      if (!r || typeof r !== 'object') return false;
      if (typeof r.rollNumber === 'string' || typeof r.rollNumber === 'number') ok++;
      else if (r.data && typeof r.data === 'object') ok++;
    }
    return ok >= Math.ceil(rows.length * 0.8);
  }

  /**
   * تبدیل رکوردهای یک پایگاه‌دادهٔ خارجی به مدل جاری.
   * رکوردهای v1 (دادهٔ خام در فیلد data) مثل مهاجرت رسمی v1→v2 دوباره
   * نرمال می‌شوند؛ رکوردهای v2+ دست‌نخورده (فقط id حذف) عبور می‌کنند.
   */
  Recovery.convertForeign = async function (src) {
    const N = RM.normalize;
    const out = {
      rolls: [], archivedRolls: [], setupRolls: [], standardLengthRules: [],
      importMetadata: [], appSettings: [], rollEdits: [], pallets: [],
    };

    for (const { key, table, sourceKey } of [
      { key: 'rolls', table: 'rolls', sourceKey: 'rolls' },
      { key: 'archivedRolls', table: 'archivedRolls', sourceKey: 'archived' },
    ]) {
      const rows = src[key] || [];
      if (!rows.length) continue;
      const isV1 = rows.every(
        (r) => r && typeof r === 'object' && !('rollNumber' in r) && r.data && typeof r.data === 'object'
      );
      if (isV1) {
        const headers = Object.keys(rows[0].data || {});
        const mapping = N.buildFieldMapping(sourceKey, headers);
        for (const r of rows) {
          try { out[table].push(N.normalizeRow(r.data, sourceKey, mapping).record); }
          catch { /* سطر معتبر نیست — رد می‌شود */ }
        }
      } else {
        out[table] = rows.map(({ id, ...rec }) => rec);
      }
    }

    /* ستاپ‌ها — v1: فیلدهای قدیمی (rollWidth…) → مدل جدید با پرچم legacy */
    const setups = src.setupRolls || [];
    if (setups.length) {
      const isV1 = setups.every((s) => s && typeof s === 'object' && !('width' in s));
      if (isV1) {
        const now = Date.now();
        out.setupRolls = setups.map((s) => ({
          setupNumber: U.parseInt(s.setupNumber) ?? 0,
          machineNumber: U.parseInt(s.machineNumber) ?? null,
          width: U.parseNumber(s.rollWidth) ?? null,
          thickness: null,
          standardLength: null,
          rollCount: U.parseInt(s.rollCount) ?? 0,
          cuttingPattern: null,
          legacy: true,
          createdAt: s.createdAt || now,
          updatedAt: now,
        }));
      } else {
        out.setupRolls = setups.map(({ id, ...rec }) => rec);
      }
    }

    const pass = (rows, stripId) => {
      if (!Array.isArray(rows)) return [];
      return stripId ? rows.map(({ id, ...rec }) => rec) : rows.slice();
    };
    out.standardLengthRules = pass(src.standardLengthRules, true);
    out.importMetadata = pass(src.importMetadata, true);
    out.appSettings = pass(src.appSettings, false);
    out.rollEdits = pass(src.rollEdits, false);
    out.pallets = pass(src.pallets, true);

    /* متای قدیمی v1 (rollsInfo/archivedInfo) → سابقهٔ Import
       (رکورد متای قدیمی هم شکل تخت — فیلدها روی خود رکورد، شکل واقعی
       نسخه‌های ۱ — و هم تودرتو (value) پشتیبانی می‌شود) */
    const meta = src.meta;
    if (Array.isArray(meta)) {
      const readMeta = (k) => {
        const row = meta.find((m) => m && m.key === k);
        if (!row) return null;
        return (row.value && typeof row.value === 'object') ? { ...row, ...row.value } : row;
      };
      const get = readMeta;
      const now = Date.now();
      const rInfo = get('rollsInfo');
      if (rInfo) {
        out.importMetadata.push({
          target: 'rolls',
          fileName: rInfo.fileName || 'rolls.xlsx (قدیمی)',
          importedAt: rInfo.importedAt || now,
          totalRecords: rInfo.totalRows || 0,
          validRecords: rInfo.totalRows || 0,
          rawRolls: rInfo.matchedRows || 0,
          fileHash: null,
          datasetVersion: 1,
        });
      }
      const aInfo = get('archivedInfo');
      if (aInfo) {
        out.importMetadata.push({
          target: 'archived',
          fileName: aInfo.fileName || 'Archived Rolls.xlsx (قدیمی)',
          importedAt: aInfo.importedAt || now,
          totalRecords: aInfo.totalRows || 0,
          validRecords: aInfo.totalRows || 0,
          rawRolls: 0,
          fileHash: null,
          datasetVersion: 1,
        });
      }
    }

    return out;
  };

  /** ایمپورت افزایشی داده‌های تبدیل‌شده به پایگاه‌دادهٔ جاری (بدون پاک‌سازی) */
  Recovery.importIntoCurrent = async function (conv) {
    const db = RM.db.db;
    const add = async (table, rows) => {
      if (!Array.isArray(rows) || !rows.length) return 0;
      await db.table(table).bulkAdd(rows);
      return rows.length;
    };
    await db.transaction(
      'rw',
      [db.rolls, db.archivedRolls, db.setupRolls, db.standardLengthRules,
       db.importMetadata, db.appSettings, db.rollEdits, db.pallets],
      async () => {
        await add('rolls', conv.rolls);
        await add('archivedRolls', conv.archivedRolls);
        await add('setupRolls', conv.setupRolls);
        await add('standardLengthRules', conv.standardLengthRules);
        await add('importMetadata', conv.importMetadata);
        await add('appSettings', conv.appSettings);
        await add('rollEdits', conv.rollEdits);
        await add('pallets', conv.pallets);
      }
    );
    return {
      rolls: conv.rolls.length,
      archivedRolls: conv.archivedRolls.length,
      setupRolls: conv.setupRolls.length,
      rules: conv.standardLengthRules.length,
    };
  };

  /**
   * اسکن همهٔ پایگاه‌داده‌های این مبدأ — اولین پایگاه‌دادهٔ معتبرِ
   * غیرجاری ایمپورت می‌شود. خروجی: { imported, name?, counts?, candidates }
   */
  Recovery.scanAndImportForeign = async function () {
    const result = { imported: false, candidates: [] };
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
      return result;
    }
    let dbs = [];
    try { dbs = await indexedDB.databases(); } catch { return result; }

    for (const { name } of dbs) {
      if (!name || name === 'RollMonitorDB') continue;
      if (/eva/i.test(name)) continue;   /* برنامهٔ خواهر — متعلق به این سامانه نیست */

      let idb = null;
      try {
        idb = await openRaw(name);
        const stores = Array.from(idb.objectStoreNames);
        if (!stores.includes('rolls')) continue;

        const src = {
          rolls: await readAll(idb, 'rolls'),
          archivedRolls: await readAll(idb, 'archivedRolls'),
          setupRolls: await readAll(idb, 'setupRolls'),
          standardLengthRules: await readAll(idb, 'standardLengthRules'),
          importMetadata: await readAll(idb, 'importMetadata'),
          appSettings: await readAll(idb, 'appSettings'),
          rollEdits: await readAll(idb, 'rollEdits'),
          pallets: await readAll(idb, 'pallets'),
          meta: await readAll(idb, 'meta'),
        };
        idb.close();
        idb = null;

        /* اعتبارسنجی شکل — فقط دادهٔ «رول» با ساختار شناخته‌شده */
        if (!looksLikeRollRecords(src.rolls || [])) continue;
        if ((src.setupRolls || []).length &&
            !(src.setupRolls.every((s) => s && typeof s === 'object' && ('setupNumber' in s)))) continue;

        result.candidates.push(name);
        const conv = await Recovery.convertForeign(src);
        if (!conv.rolls.length && !conv.archivedRolls.length && !conv.setupRolls.length) continue;

        const counts = await Recovery.importIntoCurrent(conv);
        result.imported = true;
        result.name = name;
        result.counts = counts;
        return result;
      } catch {
        if (idb) { try { idb.close(); } catch { /* بی‌صدا */ } }
      }
    }
    return result;
  };

  /* ================================================================
     ۴) پنل بازیابی داده
     ================================================================ */

  /** اطلاعات مبدأ فعلی برای نمایش در پنل (آگاهانهٔ وضعیت) */
  Recovery.getOriginInfo = function () {
    const isFile = location.protocol === 'file:';
    return {
      isFile,
      href: location.href,
      label: isFile ? 'حالت آفلاین (فایل محلی)' : 'حالت وب',
    };
  };

  /** نمایش پنل بازیابی (مارک‌آپ ثابت در index.html) */
  Recovery.showPanel = function () {
    const panel = document.getElementById('recovery-panel');
    if (!panel) return;
    const diag = document.getElementById('recovery-origin');
    if (diag) {
      const info = Recovery.getOriginInfo();
      diag.innerHTML =
        `<b>وضعیت فعلی:</b> ${U.escapeHtml(info.label)} — <code dir="ltr">${U.escapeHtml(info.href)}</code>`;
      const hint = document.getElementById('recovery-file-hint');
      if (hint) hint.hidden = !info.isFile;
    }
    panel.hidden = false;
  };

  /** بستن پنل — dismiss=true یعنی دیگر در این وضعیت نمایش نده */
  Recovery.hidePanel = function (dismiss) {
    const panel = document.getElementById('recovery-panel');
    if (panel) panel.hidden = true;
    if (dismiss) {
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* حالت خصوصی */ }
    }
  };

  /** اسکن مجدد (دکمهٔ پنل و تنظیمات) — فقط وقتی برنامه خالی است */
  Recovery.rescan = async function () {
    let empty = true;
    try { empty = await Recovery.isEmpty(); } catch { /* بی‌صدا */ }
    if (!empty) {
      RM.ui.toast('برنامه در حال حاضر داده دارد — اسکن دادهٔ قدیمی فقط زمانی اجرا می‌شود که برنامه خالی باشد.', 'info', 5000);
      return;
    }
    const res = await Recovery.scanAndImportForeign();
    if (res.imported) {
      Recovery.hidePanel(false);
      const c = res.counts || {};
      RM.ui.toast(
        `داده‌های قدیمی از پایگاه‌دادهٔ «${res.name}» بازیابی شد — ` +
        `${U.faNum(c.setupRolls || 0)} ستاپ · ${U.faNum(c.rolls || 0)} رول خام · ${U.faNum(c.archivedRolls || 0)} رول آرشیو.`,
        'success', 7000
      );
      await RM.refreshAll();
    } else {
      RM.ui.toast('پایگاه‌دادهٔ قدیمی دیگری در این مرورگر یافت نشد — از فایل پشتیبان بازیابی کنید.', 'info', 6000);
    }
  };

  /* ================================================================
     ۵) ارکستراتور شروع — پس از بازشدن موفق پایگاه‌داده فراخوانی می‌شود
     ================================================================ */

  Recovery.runBootRecovery = async function () {
    /* برنامه داده دارد؟ → پرچم بستن پنل را پاک کن و تمام */
    let empty;
    try { empty = await Recovery.isEmpty(); } catch { return; }
    if (!empty) {
      try { localStorage.removeItem(DISMISS_KEY); } catch { /* بی‌صدا */ }
      return;
    }

    /* لایهٔ ۱ — آینهٔ پشتیبان خودکار */
    try {
      const res = await Recovery.restoreFromAutosave();
      if (res.ok) {
        const c = res.counts || {};
        RM.ui.toast(
          'پشتیبان خودکار بازیابی شد — داده‌های قبلی برنامه برگشت ' +
          `(${U.faNum(c.setupRolls || 0)} ستاپ · ${U.faNum(c.rolls || 0)} رول خام · ${U.faNum(c.archivedRolls || 0)} آرشیو).`,
          'success', 7000
        );
        return;
      }
    } catch { /* لایهٔ بعد */ }

    /* لایهٔ ۲ — پایگاه‌دادهٔ قدیمی دیگر در همین مبدأ */
    try {
      const res = await Recovery.scanAndImportForeign();
      if (res.imported) {
        const c = res.counts || {};
        RM.ui.toast(
          `داده‌های قدیمی از پایگاه‌دادهٔ «${res.name}» بازیابی شد — ` +
          `${U.faNum(c.setupRolls || 0)} ستاپ · ${U.faNum(c.rolls || 0)} رول خام · ${U.faNum(c.archivedRolls || 0)} رول آرشیو.`,
          'success', 7000
        );
        return;
      }
    } catch { /* لایهٔ بعد */ }

    /* لایهٔ ۳ — پنل راهنمای بازیابی (مگر آنکه کاربر بسته باشد) */
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* بی‌صدا */ }
    if (!dismissed) Recovery.showPanel();
  };

  /* ================================================================
     ۶) رویدادهای پنل (دکمه‌ها — یک‌بار نصب می‌شوند)
     ================================================================ */

  Recovery.initPanelEvents = function () {
    const panel = document.getElementById('recovery-panel');
    if (!panel) return;

    const pick = document.getElementById('btn-recovery-restore');
    if (pick) {
      pick.addEventListener('click', () => {
        const input = document.getElementById('recovery-file');
        if (input) input.click();
      });
    }

    const file = document.getElementById('recovery-file');
    if (file) {
      file.addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        if (RM.views.settings && typeof RM.views.settings.restoreBackup === 'function') {
          await RM.views.settings.restoreBackup(f);
        } else {
          RM.ui.toast('نمای تنظیمات هنوز آماده نیست — کمی بعد دوباره تلاش کنید.', 'error', 5000);
        }
      });
    }

    const rescanBtn = document.getElementById('btn-recovery-rescan');
    if (rescanBtn) rescanBtn.addEventListener('click', () => { Recovery.rescan(); });

    const closeBtn = document.getElementById('btn-recovery-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { Recovery.hidePanel(true); });
  };

  RM.recovery = Recovery;
})();
