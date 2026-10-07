/* =========================================================================
   edits.js — موتور ویرایش رکوردهای رول (تغییر ۳)
   -------------------------------------------------------------------------
   مدل هر رکورد ویرایش (جدول rollEdits — یک رکورد به ازای هر شماره رول):
     {
       key:        'rolls|F35019…'  (کلید یکتا: منبع + شماره رول اصلی)
       source:     'rolls' | 'archived'
       rollNumber: شماره رول «اصلی» فایل (کلید ویرایش — ثابت می‌ماند)
       fields:     { فیلد: مقدار ویرایش‌شده } — فقط فیلدهای تغییرکرده
       updatedAt:  تاریخ آخرین ویرایش
     }

   قوانین حاکم:
     - ویرایش جدید روی ویرایش قبلی همان رول «ذخیره» می‌شود (Merge);
       اگر مقدار جدید با مقدار اصلی فایل برابر باشد آن فیلد از ویرایش
       حذف می‌شود (بازگشت به دیتای فایل).
     - پس از هر Import، ویرایش‌ها به‌صورت خودکار جایگزین اطلاعات فایل
       می‌شوند (اعمال در DB.loadAllSources و نماها — Single Source of Truth).
     - ویرایش شماره رول = تغییر نام: کلید ویرایش همان شمارهٔ اصلی می‌ماند
       و مقدار جدید جایگزین نمایش/محاسبات می‌شود.
     - رکوردهای ویرایش‌شده در Backup/Restore کامل پشتیبان گرفته می‌شوند.
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const db = RM.db.db;

  const Edits = {};

  /** کلید یکتای ویرایش: منبع + شماره رول اصلی */
  Edits.tableKey = function (sourceKey, rollNumber) {
    return `${sourceKey}|${String(rollNumber ?? '')}`;
  };

  /** همهٔ رکوردهای ویرایش */
  Edits.getAll = async function () {
    try {
      return await db.rollEdits.toArray();
    } catch {
      return [];   // دیتابیس هنوز آماده نیست
    }
  };

  /** ویرایش‌های یک منبع */
  Edits.getFor = async function (sourceKey) {
    try {
      return await db.rollEdits.where('source').equals(sourceKey).toArray();
    } catch {
      return [];
    }
  };

  /** ویرایش یک رول مشخص (یا null) */
  Edits.getEdit = async function (sourceKey, rollNumber) {
    try {
      return await db.rollEdits.get(Edits.tableKey(sourceKey, rollNumber)) || null;
    } catch {
      return null;
    }
  };

  /**
   * ذخیرهٔ ویرایش یک رول — Merge روی ویرایش قبلی (تغییر ۳).
   * @param {string} sourceKey       'rolls' | 'archived'
   * @param {string} rollNumber      شماره رول «اصلی» (کلید ویرایش)
   * @param {object} changes         { فیلد: مقدار جدید (پارس‌شده) }
   * @param {object} importedRecord  رکورد اصلی فایل (برای تشخیص بازگشت به اصلی)
   * خروجی: { ok, fields, applied, removed }
   */
  Edits.saveEdit = async function (sourceKey, rollNumber, changes, importedRecord) {
    const key = Edits.tableKey(sourceKey, rollNumber);
    const existing = await Edits.getEdit(sourceKey, rollNumber);
    const merged = { ...(existing ? existing.fields : {}) };
    const applied = [];
    const removed = [];

    for (const [field, value] of Object.entries(changes || {})) {
      const original = importedRecord ? importedRecord[field] : undefined;
      const same = Edits.valuesEqual(value, original);
      if (same) {
        // مقدار جدید = مقدار اصلی فایل → این فیلد دیگر ویرایش نیست
        if (field in merged) { delete merged[field]; removed.push(field); }
      } else {
        merged[field] = value;
        applied.push(field);
      }
    }

    await db.transaction('rw', db.rollEdits, async () => {
      if (Object.keys(merged).length === 0) {
        await db.rollEdits.delete(key);           // همهٔ فیلدها به اصلی برگشت
      } else {
        await db.rollEdits.put({
          key,
          source: sourceKey,
          rollNumber: String(rollNumber ?? ''),
          fields: merged,
          updatedAt: Date.now(),
        });
      }
    });

    return { ok: true, fields: merged, applied, removed };
  };

  /** حذف ویرایش یک رول (بازگشت کامل به دیتای فایل) */
  Edits.removeEdit = async function (sourceKey, rollNumber) {
    const key = Edits.tableKey(sourceKey, rollNumber);
    await db.transaction('rw', db.rollEdits, async () => {
      await db.rollEdits.delete(key);
    });
  };

  /** مقایسهٔ مقدار ویرایش با مقدار اصلی (پس از نرمال‌سازی سبک) */
  Edits.valuesEqual = function (a, b) {
    const na = a === '' || a === undefined ? null : a;
    const nb = b === '' || b === undefined ? null : b;
    if (na === null && nb === null) return true;
    if (typeof na === 'number' || typeof nb === 'number') {
      const fa = U.parseNumber(na);
      const fb = U.parseNumber(nb);
      if (fa !== null && fb !== null) return fa === fb;
    }
    if (na instanceof Date || nb instanceof Date) {
      return String(na) === String(nb);
    }
    return String(na) === String(nb);
  };

  /**
   * اعمال ویرایش‌ها روی رکوردهای یک منبع (جایگزینی اطلاعات فایل — تغییر ۳).
   * رکوردهای آرایهٔ ورودی درجا غنی می‌شوند:
   *   _editKey       شماره رول اصلیِ کلید ویرایش (برای ویرایش مجدد)
   *   __editedFields نام فیلدهای ویرایش‌شده (برای نشان «✎» جدول)
   * @param {string} sourceKey  'rolls' | 'archived'
   * @param {Array}  records    رکوردهای نرمال‌شدهٔ فایل
   * @param {Array|null} editRecords  ویرایش‌های از پیش بارگذاری‌شده (اختیاری)
   */
  Edits.applyToRecords = async function (sourceKey, records, editRecords = null) {
    if (!Array.isArray(records) || !records.length) return records;

    const edits = editRecords !== null ? editRecords : await Edits.getFor(sourceKey);
    if (!edits.length) return records;

    const byRoll = new Map(edits.map((e) => [String(e.rollNumber), e]));
    let appliedCount = 0;

    for (const r of records) {
      const edit = byRoll.get(String(r.rollNumber ?? ''));
      if (!edit || !edit.fields) continue;
      Object.assign(r, edit.fields);
      r._editKey = edit.rollNumber;          // کلید ویرایش (شمارهٔ اصلی)
      r.__editedFields = Object.keys(edit.fields);
      appliedCount++;
    }

    Edits._lastAppliedCount = appliedCount;
    return records;
  };

  /** تعداد ویرایش‌های اعمال‌شدهٔ آخرین فراخوانی applyToRecords (برای آمار) */
  Edits._lastAppliedCount = 0;

  RM.edits = Edits;
})();
