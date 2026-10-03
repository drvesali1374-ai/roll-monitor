/* =========================================================================
   database.js — لایهٔ دسترسی به پایگاه‌داده (Dexie / IndexedDB)
   -------------------------------------------------------------------------
   جداول (§13):
     rolls              رکوردهای نرمال‌شدهٔ فایل rolls.xlsx
     archivedRolls      رکوردهای نرمال‌شدهٔ فایل Archived Rolls.xlsx
     setupRolls         رکوردهای تعریف‌شدهٔ کاربر برای ستاپ‌ها
     standardLengthRules قوانین متراژ استاندارد (§15)
     appSettings        تنظیمات برنامه (مرتب‌سازی ماندگار و…)
     importMetadata     متادیتای هر Import (§12)
     rollEdits          ویرایش‌های کاربر روی رکوردهای رول (تغییر ۳)
     meta               جدول قدیمی نسخهٔ ۱ (برای سازگاری حفظ می‌شود)

   مهاجرت امن v1 → v2 (§76):
     داده‌های قدیمی کاربر بدون از دست رفتن به مدل جدید تبدیل می‌شوند.
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const N = RM.normalize;

  /* ---------------- تعریف پایگاه‌داده ---------------- */

  const db = new Dexie('RollMonitorDB');

  /** Schema نسخهٔ ۱ — ساختار قدیمی پروژه (برای مسیر مهاجرت) */
  db.version(1).stores({
    rolls: '++id, filmType',
    archivedRolls: '++id, filmType',
    setupRolls: '++id, setupNumber, machineNumber, rollType',
    meta: 'key',
  });

  /**
   * نسخهٔ ۲ — Schema جدید + مهاجرت داده‌های قدیمی (§76)
   * ایندکس‌ها بر اساس نیاز واقعی موتورهای محاسباتی تعریف شده‌اند (§13).
   */
  db.version(2).stores({
    rolls:             '++id, rollNumber, setupNumber, width, filmType',
    archivedRolls:     '++id, rollNumber, setupNumber, width, filmType',
    setupRolls:        '++id, setupNumber, machineNumber, [setupNumber+machineNumber]',
    standardLengthRules: '++id, thickness',
    appSettings:       'key',
    importMetadata:    '++id, target, importedAt',
    meta:              'key',
  }).upgrade(async (tx) => {
    /* ----- مهاجرت rolls و archivedRolls: نرمال‌سازی مجدد از سطر خام قدیمی ----- */
    const targets = [
      { table: 'rolls', sourceKey: 'rolls' },
      { table: 'archivedRolls', sourceKey: 'archived' },
    ];

    for (const { table, sourceKey } of targets) {
      const legacyRows = await tx.table(table).toArray();
      if (!legacyRows.length) continue;

      // بازسازی رکوردهای جدید از سطرهای خام ذخیره‌شده در فیلد data
      const headers = legacyRows.length ? Object.keys(legacyRows[0].data || {}) : [];
      const mapping = N.buildFieldMapping(sourceKey, headers);

      const records = [];
      for (const legacy of legacyRows) {
        const raw = legacy.data || {};
        const { record } = N.normalizeRow(raw, sourceKey, mapping);
        records.push(record);
      }

      const tableRef = tx.table(table);
      await tableRef.clear();
      await tableRef.bulkAdd(records);
    }

    /* ----- مهاجرت setupRolls: نگاشت فیلدهای قدیمی به مدل جدید ----- */
    const legacySetups = await tx.table('setupRolls').toArray();
    if (legacySetups.length) {
      const now = Date.now();
      const migrated = legacySetups.map((s) => ({
        setupNumber: U.parseInt(s.setupNumber) ?? 0,
        machineNumber: U.parseInt(s.machineNumber) ?? null,
        width: U.parseNumber(s.rollWidth) ?? null,
        // مدل جدید ضخامت/متراژ استاندارد دارد؛ رکوردهای قدیمی ناقص علامت‌گذاری می‌شوند
        thickness: null,
        standardLength: null,
        rollCount: U.parseInt(s.rollCount) ?? 0,
        cuttingPattern: null,
        legacy: true,          // نشانِ «نیازمند تکمیل توسط کاربر»
        createdAt: s.createdAt || now,
        updatedAt: now,
      }));

      const setupTable = tx.table('setupRolls');
      await setupTable.clear();
      await setupTable.bulkAdd(migrated);
    }

    /* ----- مهاجرت meta قدیمی → importMetadata ----- */
    const metaTable = tx.table('meta');
    const importTable = tx.table('importMetadata');

    const legacyRollsInfo = await metaTable.get('rollsInfo');
    if (legacyRollsInfo) {
      await importTable.add({
        target: 'rolls',
        fileName: legacyRollsInfo.fileName || 'rolls.xlsx (قدیمی)',
        importedAt: legacyRollsInfo.importedAt || now,
        totalRecords: legacyRollsInfo.totalRows || 0,
        validRecords: legacyRollsInfo.totalRows || 0,
        rawRolls: legacyRollsInfo.matchedRows || 0,
        fileHash: null,
        datasetVersion: 1,
      });
    }

    const legacyArchivedInfo = await metaTable.get('archivedInfo');
    if (legacyArchivedInfo) {
      await importTable.add({
        target: 'archived',
        fileName: legacyArchivedInfo.fileName || 'Archived Rolls.xlsx (قدیمی)',
        importedAt: legacyArchivedInfo.importedAt || now,
        totalRecords: legacyArchivedInfo.totalRows || 0,
        validRecords: legacyArchivedInfo.totalRows || 0,
        rawRolls: 0,
        fileHash: null,
        datasetVersion: 1,
      });
    }
  });

  /* ---------------- نسخهٔ ۳ — جدول ویرایش‌های رول (تغییر ۳) ----------------
     رکورد ویرایش هر رول: { key: 'rolls|F…', source, rollNumber, fields, updatedAt }.
     افزودن جدول جدید — جداول قبلی دست‌نخورده باقی می‌مانند (Dexie Merge). */
  db.version(3).stores({
    rollEdits: 'key, source',
  });

  /* ---------------- نسخهٔ ۴ — جدول پالت‌های فایل مدیریت پالت‌ها (۳٫۱۲) ----------------
     رکوردهای نرمال‌شدهٔ فایل «Pallet Data» برای صفحهٔ «بسته‌بندی».
     افزودن جدول جدید — جداول قبلی دست‌نخورده (Dexie Merge). */
  db.version(4).stores({
    pallets: '++id, palletNo, filmType',
  });

  /* ---------------- لایهٔ دسترسی راحت (Repository ساده) ---------------- */

  const DB = { db };

  /** خواندن همهٔ منابع داده به‌صورت موازی (برای موتور محاسبه)
      تغییر ۳: ویرایش‌های کاربر روی رول‌ها «قبل از هر محاسبه» اعمال می‌شوند
      تا اطلاعات ویرایش‌شده جایگزین اطلاعات فایل ایمپورت‌شده شود
      (داشبورد/گزارش‌ها/تطبیق ستاپ‌ها همیشه از دیتای ویرایش‌شده تغذیه می‌شوند).
      نسخهٔ ۳٫۷ — تغییر ۱: عرض رول‌های آرشیو دیگر از مسیر «جستجوی شمارهٔ خام
      در رول‌های موجود» بازتخصیص نمی‌شود (رفتار نسخهٔ ۲٫۹ حذف شد) — عرض هر
      رول آرشیو در همهٔ محاسبات همان مقدار ستون «عرض» نگاشت اکسل آرشیو است. */
  DB.loadAllSources = async function () {
    const [rolls, archivedRolls, setupRolls, rules, importMetadata] = await Promise.all([
      db.rolls.toArray(),
      db.archivedRolls.toArray(),
      db.setupRolls.toArray(),
      db.standardLengthRules.toArray(),
      db.importMetadata.toArray(),
    ]);

    let editedRolls = rolls;
    let editedArchived = archivedRolls;
    try {
      editedRolls = await RM.edits.applyToRecords('rolls', rolls);
      editedArchived = await RM.edits.applyToRecords('archived', archivedRolls);
    } catch (err) {
      console.warn('[ApplyEdits]', err);
    }

    return { rolls: editedRolls, archivedRolls: editedArchived, setupRolls, rules, importMetadata };
  };

  /* ---------------- مهاجرت هویت ستاپ‌های قدیمی (نسخهٔ ۲٫۹) ----------------

     رکوردهای ستاپ که از نسخه‌های قبل (بدون خط تولید/سالن/تاریخ) آمده‌اند،
     به‌صورت خودکار از روی رول‌های همان شماره ستاپ تکمیل می‌شوند:
       · خط تولید + شماره سالن + عدد سال = هویتِ پرتکرار (اکثریت) رول‌های
         همان شماره ستاپ (از هر دو منبع رول‌های موجود و آرشیو — هویت از
         شمارهٔ رول: F=BOPP/K=CPP، رقم ۱=سالن، رقم ۲=رقم آخر سال)
       · تاریخ ستاپ = قدیمی‌ترین تاریخ تولید (شمسی YYYY/MM/DD) رول‌های
         هم‌هویتِ همان ستاپ
     Idempotent است: رکوردهای کامل دست نمی‌خورند؛ ستاپ بدون رولِ منطبق
     دست‌نخورده می‌ماند (در هشدار «رکورد ناقص» گزارش می‌شود).
     فراخوانی: در هر refreshAll (با گارد ارزان — فقط وقتی رکورد ناقص هست
     دیتای رول‌ها خوانده می‌شود) — پس از Import/Restore/شروع برنامه
     خودکار اجرا می‌شود. */
  DB.migrateSetupIdentity = async function () {
    let setups;
    try {
      setups = await db.setupRolls.toArray();
    } catch {
      return { migrated: 0 };
    }
    if (!setups.length) return { migrated: 0 };

    const needsFix = (s) => !s.productionLine || s.hallNumber === null || s.hallNumber === undefined || !s.setupDate;
    const pending = setups.filter(needsFix);
    if (!pending.length) return { migrated: 0 };

    // فقط در صورت نیاز دیتای رول‌ها خوانده می‌شود (گارد ارزان)
    const [rolls, archivedRolls] = await Promise.all([
      db.rolls.toArray(),
      db.archivedRolls.toArray(),
    ]);

    // ایندکس رول‌ها بر اساس شماره ستاپ
    const rollsBySetup = new Map();
    for (const r of [...rolls, ...archivedRolls]) {
      if (r.setupNumber === null || r.setupNumber === undefined) continue;
      if (!rollsBySetup.has(r.setupNumber)) rollsBySetup.set(r.setupNumber, []);
      rollsBySetup.get(r.setupNumber).push(r);
    }

    /** تجزیهٔ تاریخ تولید شمسی «YYYY/MM/DD» از مقدار فایل (مثل «1405/06/16 11:25:22») */
    const parseProdDate = (value) => {
      const s = RM.utils.toLatinDigits(String(value ?? '')).trim();
      const m = /^(1[34]\d{2})[\/](\d{1,2})[\/](\d{1,2})/.exec(s);
      if (!m) return null;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (mo < 1 || mo > 12) return null;
      if (d < 1 || d > RM.utils.jalaliMonthDays(y, mo)) return null;
      return { y, m: mo, d, normalized: `${String(y).padStart(4, '0')}/${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}` };
    };

    const updates = [];
    for (const setup of pending) {
      const rs = rollsBySetup.get(setup.setupNumber) || [];
      if (!rs.length) continue;

      // رأی اکثریت روی هویت کامل (خط+سالن+سال) — برندهٔ مطلق یا پرتکرارترین
      const votes = new Map();
      for (const r of rs) {
        const id = RM.normalize.parseRollIdentity(r.rollNumber);
        if (!id.line || id.hall === null || id.yearDigit === null) continue;
        const k = `${id.line}|${id.hall}|${id.yearDigit}`;
        votes.set(k, (votes.get(k) || 0) + 1);
      }
      if (!votes.size) continue;

      let winner = null;
      let winnerCount = -1;
      for (const [k, c] of votes.entries()) {
        if (c > winnerCount) { winner = k; winnerCount = c; }
      }
      const [line, hallStr, yearDigitStr] = winner.split('|');
      const hall = Number(hallStr);
      const yearDigit = Number(yearDigitStr);

      const patch = {};
      if (!setup.productionLine) patch.productionLine = line;
      if (setup.hallNumber === null || setup.hallNumber === undefined) patch.hallNumber = hall;

      // تاریخ ستاپ: قدیمی‌ترین تاریخ تولیدِ رول‌های هم‌هویت (سال = ۱۴۰X هویت)
      if (!setup.setupDate) {
        let earliest = null;
        for (const r of rs) {
          const id = RM.normalize.parseRollIdentity(r.rollNumber);
          if (!id.line || id.line !== line || id.hall !== hall || id.yearDigit !== yearDigit) continue;
          const p = parseProdDate(r.productionDate);
          if (p && (earliest === null || p.normalized < earliest)) earliest = p.normalized;
        }
        if (earliest !== null) patch.setupDate = earliest;
      }

      if (Object.keys(patch).length) {
        updates.push({ id: setup.id, patch });
      }
    }

    if (!updates.length) return { migrated: 0 };

    await db.transaction('rw', db.setupRolls, async () => {
      for (const { id, patch } of updates) {
        await db.setupRolls.update(id, patch);
      }
    });

    return { migrated: updates.length };
  };

  /** خواندن یک تنظیم (با مقدار پیش‌فرض) */
  DB.getSetting = async function (key, defaultValue) {
    const row = await db.appSettings.get(key);
    return row ? row.value : defaultValue;
  };

  /** ذخیرهٔ یک تنظیم به‌صورت تراکنشی */
  DB.setSetting = async function (key, value) {
    await db.transaction('rw', db.appSettings, async () => {
      await db.appSettings.put({ key, value });
    });
  };

  /** آخرین متادیتای Import برای هر هدف */
  DB.getLatestImportMeta = async function (targetKey) {
    const entries = await db.importMetadata
      .where('target').equals(targetKey)
      .reverse()
      .sortBy('importedAt');
    return entries.length ? entries[0] : null;
  };

  /** شمارهٔ نسخهٔ Dataset بعدی برای هر هدف (§60) */
  DB.nextDatasetVersion = async function (targetKey) {
    const count = await db.importMetadata.where('target').equals(targetKey).count();
    return count + 1;
  };

  /**
   * ارتقای رکوردهای قدیمی به مدل فعلی (بدون تغییر Schema — سازگاری نرم).
   * رکوردهایی که پیش از افزودن فیلد cutWidth ایمپورت/بازیابی شده‌اند،
   * از سطر خام ذخیره‌شده (raw) با Mapping جاری بازسازی می‌شوند تا فیلدهای
   * جدید مقدار بگیرند. تراکنشی و یک‌باره — اگر رکوردها از قبل به‌روز
   * باشند هیچ کاری انجام نمی‌شود.
   */
  DB.ensureModelFields = async function () {
    const targets = [
      { table: 'rolls', sourceKey: 'rolls' },
      { table: 'archivedRolls', sourceKey: 'archived' },
    ];

    for (const { table, sourceKey } of targets) {
      try {
        const all = await db[table].toArray();
        if (!all.length) continue;
        if ('cutWidth' in all[0]) continue;          // مدل فعلی — نیازی به بازسازی نیست

        const withRaw = all.filter((r) => r.raw);
        if (!withRaw.length) continue;               // بدون سطر خام — قابل بازسازی نیست

        const headers = Object.keys(withRaw[0].raw);
        const overrides = (await N.getUserMapping())[sourceKey] || {};
        const mapping = N.buildFieldMapping(sourceKey, headers, overrides);

        const fresh = all.map((r) =>
          r.raw ? { ...N.normalizeRow(r.raw, sourceKey, mapping).record, id: r.id } : r
        );

        await db.transaction('rw', db[table], async () => {
          await db[table].clear();
          await db[table].bulkPut(fresh);
        });
      } catch (err) {
        console.warn('[ModelUpgrade]', table, err);
      }
    }
  };

  RM.db = DB;
})();
