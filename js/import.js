/* =========================================================================
   import.js — موتور Import فایل‌های Excel (§10-§12، §60، §89)
   -------------------------------------------------------------------------
   خط لولهٔ Import (§10):
     File → Extension Validation → ArrayBuffer → SheetJS XLSX.read
     → Worksheet Detection → Header Validation → Normalization
     → Data Validation → Confirmation(جایگزینی §89) → IndexedDB(تراکنشی §14)
     → Derived Calculations → UI Refresh

   خروجی هر Import:
     - گزارشنمای اعتبارسنجی (§11)
     - متادیتا + هش فایل + نسخهٔ Dataset (§12، §60)
     - هشدار «فایل بدون تغییر» در صورت هش یکسان
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const N = RM.normalize;
  const DB = RM.db;
  const db = RM.db.db;

  const Import = {};

  /* ---------------- مرحلهٔ ۱-۳: خواندن و تجزیهٔ فایل ---------------- */

  /**
   * خواندن فایل اکسل و نرمال‌سازی کامل — بدون نوشتن در دیتابیس.
   * خروجی: گزارش کامل اعتبارسنجی برای نمایش به کاربر (§11).
   */
  async function parseExcelFile(targetKey, file) {
    const target = RM.config.IMPORT_TARGETS[targetKey];

    // --- اعتبارسنجی پسوند (§10) ---
    const name = file.name || '';
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      throw new Error(`فرمت فایل «${name}» مجاز نیست؛ فقط xlsx. یا xls.`);
    }

    // --- ArrayBuffer + هش (§12) ---
    const buffer = await file.arrayBuffer();
    const fileHash = U.hashBuffer(buffer);

    // --- SheetJS ---
    const workbook = XLSX.read(buffer, { type: 'array' });
    if (!workbook.SheetNames.length) throw new Error('هیچ شیتی در فایل یافت نشد.');

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rows.length) throw new Error('فایل خالی است؛ هیچ ردیف داده‌ای وجود ندارد.');

    // --- اعتبارسنجی هدرها (§10: Header Validation) با Mapping کاربر ---
    const headers = Object.keys(rows[0]);
    const userMapping = await N.getUserMapping();
    const mapping = N.buildFieldMapping(targetKey, headers, userMapping[targetKey] || {});

    if (mapping.__missing.length) {
      const hasMappingHint = mapping.__usedOverrides.length > 0 || mapping.__invalid.length > 0;
      throw new Error(
        `ستون‌های الزامی یافت نشد: ${mapping.__missing.join('، ')} — ` +
        `احتمالاً فایل «${target.expectedFile}» انتخاب نشده است.` +
        (hasMappingHint ? ' Mapping ستون‌ها را در تنظیمات بررسی کنید.' : '')
      );
    }

    // --- نرمال‌سازی (§9) + گزارشنمای داده‌ها (§11) ---
    /* نسخهٔ ۳٫۱۲ — فایل پالت‌ها نرمال‌ساز اختصاصی دارد (فیلتر M + مدل پالت)؛
       دو فایل رول مانند قبل از نرمال‌ساز مشترک رول استفاده می‌کنند. */
    const normalizeFn = target.normalizer === 'pallets'
      ? N.normalizePalletRows
      : N.normalizeRows;
    const { records, issues } = normalizeFn(rows, targetKey, mapping);

    // شمارش رول‌های خام برای هر دو هدف (برای گزارشنما)
    // نسخهٔ ۳٫۱۲ — فایل پالت‌ها این شاخص‌ها را ندارد (۰)
    const rawCount = targetKey === 'rolls' ? records.filter(N.isRawRoll).length : 0;

    // یونیک متالایز (فقط برای گزارش — محاسبهٔ اصلی در موتور محاسبه)
    const uniqueR = targetKey === 'archived'
      ? new Set(records.filter((r) => N.hasR(r.filmType)).map((r) => r.rollNumber)).size
      : 0;

    return {
      fileName: name,
      sheetName,
      fileHash,
      headers,                               // هدرهای واقعی فایل (Mapping و Audit)
      mappingGaps: mapping.__invalid,        // فیلدهای تنظیم‌شدهٔ کاربر که در فایل نبودند
      totalRecords: records.length,
      records,
      issues,
      rawCount,
      uniqueR,
    };
  }

  /* ---------------- مرحلهٔ ۴: ذخیرهٔ تراکنشی در IndexedDB (§14، §89) ---------------- */

  /**
   * جایگزینی Dataset قبلی — تراکنشی و اتمیک:
   * یا کامل موفق، یا بدون هیچ تغییری (Import نیمه‌کاره وجود ندارد §14).
   */
  async function persistDataset(targetKey, parsed) {
    const target = RM.config.IMPORT_TARGETS[targetKey];
    const datasetVersion = await DB.nextDatasetVersion(targetKey);

    await db.transaction('rw', db[target.table], db.importMetadata, async () => {
      await db[target.table].clear();          // سیاست جایگزینی (§89)
      await db[target.table].bulkAdd(parsed.records);   // عملیات انبوه (§56)

      await db.importMetadata.add({
        target: targetKey,
        fileName: parsed.fileName,
        sheetName: parsed.sheetName,
        importedAt: Date.now(),
        totalRecords: parsed.totalRecords,
        validRecords: parsed.totalRecords,
        errorCount: 0,
        status: 'ok',                        // وضعیت Import (برای گزارشنمای UI)
        rawRolls: targetKey === 'rolls' ? parsed.rawCount : (targetKey === 'archived' ? parsed.uniqueR : 0),
        fileHash: parsed.fileHash,
        datasetVersion,                        // نسخه‌بندی Dataset (§60)
        issues: parsed.issues,                 // جزئیات نقص داده‌ها
        headers: parsed.headers,               // هدرهای واقعی فایل — Audit/Traceability + Mapping
        mappingGaps: parsed.mappingGaps || [], // فیلدهای Mapping بدون ستون (§ Mapping ناقص)
      });
    });

    return datasetVersion;
  }

  /* ---------------- فرایند کامل Import (با تأیید جایگزینی) ---------------- */

  /**
   * فرایند کامل Import با UI:
   *  ۱) تجزیه و اعتبارسنجی
   *  ۲) هشدار فایل تکراری (هش یکسان §12)
   *  ۳) تأیید جایگزینی با نمایش تعداد قدیم/جدید (§89)
   *  ۴) ذخیرهٔ تراکنشی + محاسبات + رفرش UI
   */
  Import.run = async function (targetKey, file, ui) {
    const confirmFn = (ui && ui.confirm) || (async () => true);

    // ۱) تجزیه (بدون ذخیره)
    const parsed = await parseExcelFile(targetKey, file);

    // ۲) هشدار فایل بدون تغییر
    const previous = await DB.getLatestImportMeta(targetKey);
    let sameFileWarning = false;
    if (previous && previous.fileHash && previous.fileHash === parsed.fileHash) {
      sameFileWarning = true;
    }

    // ۳) تأیید جایگزینی (§89) — نمایش تعداد رکوردهای فعلی و جدید
    const currentCount = await db[RM.config.IMPORT_TARGETS[targetKey].table].count();
    const ok = await confirmFn({
      title: 'تأیید جایگزینی داده‌ها',
      html:
        `<div class="confirm-stats">` +
        `<div>رکوردهای فعلی: <b>${U.faNum(currentCount)}</b></div>` +
        `<div>رکوردهای فایل جدید: <b>${U.faNum(parsed.totalRecords)}</b></div>` +
        `<div>فایل: <b>${U.escapeHtml(parsed.fileName)}</b></div>` +
        (sameFileWarning
          ? `<div class="confirm-warn">⚠ محتوای این فایل با آخرین Import یکسان است (هش یکسان).</div>`
          : '') +
        `</div>` +
        `<p style="margin-top:8px">داده‌های قبلی این جدول جایگزین خواهد شد. ادامه می‌دهید؟</p>`,
      confirmText: 'بله، جایگزین کن',
    });
    if (!ok) return { cancelled: true };

    // ۴) ذخیره + محاسبات + رفرش
    const datasetVersion = await persistDataset(targetKey, parsed);

    return { ok: true, parsed, datasetVersion, sameFileWarning };
  };

  RM.importEngine = Import;
})();
