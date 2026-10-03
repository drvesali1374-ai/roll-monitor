/* =========================================================================
   normalize.js — لایهٔ نرمال‌سازی مرکزی داده‌های Excel (§8-§9)
   -------------------------------------------------------------------------
   مسیر داده:
     Excel Columns  →  Normalization  →  Internal Roll Model  →  Business Logic

   مدل داخلی رول (Independent از نام‌های خام اکسل):
     {
       rollNumber   شماره رول        (همیشه String — §97)
       width        عرض اولیه (نمایشی — از ستون «عرض رول اولیه»؛ مبنای محاسبات نیست)
       cutWidth     عرض فعلی/برش‌خورده (از ستون «عرض» — مبنای کلیدهای انطباق/تخصیص
                    رول‌های خام و محاسبات رول‌های فرزند — ۳٫۹ تغییر ۱)
       actualLength متراژ واقعی
       thickness    ضخامت (میکرون)
       filmType     نوع فیلم
       palletNumber شماره پالت (نرمال‌شده: '' اگر خالی)
       setupNumber  شماره ستاپ (عدد یا null)
       source       'rolls' | 'archived'
       parentRollNumber  رزرو برای Traceability آینده (§64-§67، §98)
       raw          سطر اصلی اکسل (برای Audit و پیش‌نمایش)
     }
   ========================================================================= */

'use strict';

(function () {
  const { COLUMN_MAP } = RM.config;
  const U = RM.utils;
  const N = {};

  /** یافتن نام واقعی ستون در هدرهای فایل بر اساس نقشهٔ پیکربندی */
  function resolveColumn(headers, spec) {
    const normalizedHeaders = new Map(
      headers.map((h) => [U.normalizeHeader(h), h])   // نگاشت «نرمال → نام اصلی»
    );

    // ابتدا نام اصلی، سپس جایگزین‌ها
    for (const candidate of [spec.primary, ...spec.fallbacks]) {
      const found = normalizedHeaders.get(U.normalizeHeader(candidate));
      if (found !== undefined) return found;
    }
    return null;
  }

  /**
   * ساخت نگاشت «فیلد داخلی → نام ستون واقعی فایل».
   * خروجی برای اعتبارسنجی وجود ستون‌ها (§10: Header Validation) هم استفاده می‌شود.
   *
   * overrides (اختیاری): نگاشت کاربر از تنظیمات — { فیلد: نام ستون اکسل }.
   * اولویت با انتخاب کاربر است؛ در نبود آن از نقشهٔ پیش‌فرض (primary + fallbacks)
   * استفاده می‌شود. منطق برنامه هرگز به نام فیزیکی ستون‌های Excel وابسته نیست.
   *
   * خروجی:
   *   map[field]          نام واقعی ستون یا null
   *   map.__missing       ستون‌های الزامی یافت‌نشده
   *   map.__invalid       انتخاب‌های کاربر که در فایل وجود ندارند
   *   map.__usedOverrides فیلدهایی که از انتخاب کاربر آمده‌اند
   */
  function buildFieldMapping(sourceKey, headers, overrides) {
    const map = { __missing: [], __invalid: [], __usedOverrides: [] };
    const spec = COLUMN_MAP[sourceKey];
    const normalizedHeaders = new Map(
      headers.map((h) => [U.normalizeHeader(h), h])
    );

    for (const [field, columnSpec] of Object.entries(spec)) {
      const override = overrides ? overrides[field] : null;

      // ۱) انتخاب صریح کاربر
      if (typeof override === 'string' && override.trim() !== '') {
        const real = normalizedHeaders.get(U.normalizeHeader(override));
        if (real !== undefined) {
          map[field] = real;
          map.__usedOverrides.push(field);
          continue;
        }
        // ستونِ تنظیم‌شدهٔ کاربر در فایل وجود ندارد
        map[field] = null;
        map.__invalid.push({ field, value: override });
        if (!columnSpec.optional) map.__missing.push(override);
        continue;
      }

      // ۲) رزولوشن خودکار (پیش‌فرض)
      const real = resolveColumn(headers, columnSpec);
      if (real === null) {
        map[field] = null;
        if (!columnSpec.optional) map.__missing.push(columnSpec.primary);
      } else {
        map[field] = real;
      }
    }
    return map;
  }

  /**
   * نرمال‌سازی یک سطر اکسل به مدل داخلی (§6، §94-§97).
   * خروجی: { record, issues: {width?, length?, thickness?, setupNumber?, rollNumber?, filmType?} }
   */
  function normalizeRow(row, sourceKey, mapping) {
    /* نسخهٔ ۳٫۱۲ — Dispatch منبع پالت‌ها به نرمال‌ساز اختصاصی
       (ساختار رکورد پالت با رول متفاوت است — § فایل مدیریت پالت‌ها) */
    if (sourceKey === 'pallets') return normalizePalletRow(row, mapping);

    const get = (field) => {
      const col = mapping[field];
      return col === null ? '' : row[col];
    };

    const rollNumberRaw = get('rollNumber');
    const productionDateRaw = get('productionDate');

    const record = {
      rollNumber: String(rollNumberRaw ?? '').trim(),   // شماره رول همیشه String (§97)
      width: U.parseNumber(get('width')),
      cutWidth: U.parseNumber(get('cutWidth')),
      actualLength: U.parseNumber(get('actualLength')),
      thickness: U.parseNumber(get('thickness')),
      filmType: String(get('filmType') ?? '').trim(),
      palletNumber: String(get('palletNumber') ?? '').trim(),
      setupNumber: U.parseInt(get('setupNumber')),
      // فیلدهای جزئیات/نمایش (اختیاری — از Mapping کاربر)
      productionDate:
        productionDateRaw === '' || productionDateRaw === null || productionDateRaw === undefined
          ? null : productionDateRaw,
      netWeight: U.parseNumber(get('netWeight')),
      grade: String(get('grade') ?? '').trim(),
      status: String(get('status') ?? '').trim(),
      source: sourceKey,
      parentRollNumber: null,                             // رزرو Traceability (§98)
      raw: row,                                           // سطر اصلی برای Audit
    };

    // گردآوری مشکلات داده‌ای برای گزارشنمای Import (§11)
    const issues = {};
    if (record.width === null) issues.width = true;
    if (record.actualLength === null) issues.length = true;
    if (record.thickness === null) issues.thickness = true;
    if (record.setupNumber === null) issues.setupNumber = true;
    if (record.rollNumber === '') issues.rollNumber = true;
    if (record.filmType === '') issues.filmType = true;

    return { record, issues };
  }

  /**
   * نرمال‌سازی کامل آرایهٔ سطرهای یک فایل.
   * خروجی: { records, issues: {width, length, thickness, setupNumber, rollNumber, filmType} }
   */
  function normalizeRows(rows, sourceKey, mapping) {
    const records = [];
    const issues = { width: 0, length: 0, thickness: 0, setupNumber: 0, rollNumber: 0, filmType: 0 };

    for (const row of rows) {
      const { record, issues: rowIssues } = normalizeRow(row, sourceKey, mapping);
      for (const key of Object.keys(issues)) {
        if (rowIssues[key]) issues[key]++;
      }
      records.push(record);
    }

    return { records, issues };
  }

  /* ---------------- نرمال‌سازی فایل مدیریت پالت‌ها (نسخهٔ ۳٫۱۲) ----------------
     مدل داخلی پالت (مستقل از نام ستون‌های اکسل):
       palletId شناسه پالت (نرم‌شده: '' اگر خالی)
       palletNo شماره پالت (کلید نمایش/ردیابی)
       filmType / thickness / width / grade ویژگی‌های پالت (به رول‌های داخل
                  پالت به ارث می‌رسند — پنج ویژگی سازگاری)
       packType نوع بسته‌بندی اکسل (فقط برای استخراج قطر بوبین — نوع بسته‌بندی
                 واقعی توسط موتور بسته‌بندی مستقل محاسبه و مقایسه می‌شود)
       rolls [] شماره رول‌های داخل پالت (تجزیه‌شده از ستون لیست رول‌ها)
       warehouse وضعیت انبار · productionDate / netWeight / grossWeight /
       setupNumber / customerCode / techSpec فیلدهای اطلاعاتی اختیاری
       raw سطر اصلی اکسل (Audit + بازسازی با Mapping جدید) */

  /** آیا نوع فیلم شامل حرف M است؟ (فقط همین ردیف‌ها وارد برنامهٔ بسته‌بندی می‌شوند) */
  function hasM(filmType) {
    return U.toLatinDigits(String(filmType ?? '')).trim().toUpperCase().includes('M');
  }

  /** تجزیهٔ ستون «لیست شماره رول‌ها» — جداکنندهٔ کاما / سمی‌کالن فارسی و لاتین */
  function parseRollList(value) {
    const s = U.toLatinDigits(String(value ?? ''));
    return s
      .split(/[,،;؛]/)
      .map((x) => x.replace(/[\s\u200c\u200f\u200e\uFEFF]/g, ''))
      .filter((x) => x !== '');
  }

  /** نرمال‌سازی یک سطر پالت (بدون فیلتر M — فیلتر در سطح آرایه اعمال می‌شود) */
  function normalizePalletRow(row, mapping) {
    const get = (field) => {
      const col = mapping[field];
      return col === null ? '' : row[col];
    };

    const record = {
      palletId: String(get('palletId') ?? '').trim(),
      palletNo: String(get('palletNo') ?? '').trim(),
      filmType: String(get('filmType') ?? '').trim(),
      thickness: U.parseNumber(get('thickness')),
      width: U.parseNumber(get('width')),
      grade: String(get('grade') ?? '').trim(),
      packType: U.toLatinDigits(String(get('packType') ?? '')).replace(/[\s\u200c]/g, '').toUpperCase(),
      rolls: parseRollList(get('rollList')),
      rollListRaw: String(get('rollList') ?? ''),
      warehouse: String(get('warehouse') ?? '').trim(),
      productionDate: (get('productionDate') ?? '') === '' ? null : get('productionDate'),
      netWeight: U.parseNumber(get('netWeight')),
      grossWeight: U.parseNumber(get('grossWeight')),
      setupNumber: U.parseInt(get('setupNumber')),
      customerCode: String(get('customerCode') ?? '').trim(),
      techSpec: String(get('techSpec') ?? '').trim(),
      source: 'pallets',
      raw: row,
    };

    /* مشکلات داده‌ای پالت (گزارشنمای Import — کلیدهای مستقل از رول‌ها) */
    const issues = {};
    if (record.palletNo === '') issues.palletNo = true;
    if (record.filmType === '') issues.filmType = true;
    if (record.width === null) issues.noWidth = true;
    if (record.rolls.length === 0) issues.noRolls = true;

    return { record, issues };
  }

  /**
   * نرمال‌سازی کامل فایل پالت‌ها:
   * ردیف‌های بدون M در سند «نوع فیلم» فقط شمرده می‌شوند و ذخیره نمی‌شوند
   * (برنامهٔ بسته‌بندی فقط با دیتای متالایز کار می‌کند).
   * خروجی: { records, issues: {nonM, palletNo, filmType, noWidth, noRolls} }
   */
  function normalizePalletRows(rows, sourceKey, mapping) {
    const records = [];
    const issues = { nonM: 0, palletNo: 0, filmType: 0, noWidth: 0, noRolls: 0 };

    for (const row of rows) {
      const filmCell = mapping.filmType === null ? '' : row[mapping.filmType];
      if (!hasM(filmCell)) {
        issues.nonM++;
        continue;
      }
      const { record, issues: rowIssues } = normalizePalletRow(row, mapping);
      for (const key of Object.keys(issues)) {
        if (key !== 'nonM' && rowIssues[key]) issues[key]++;
      }
      records.push(record);
    }

    return { records, issues };
  }

  /* ---------------- لایهٔ Mapping قابل تنظیم کاربر ---------------- */

  /** خواندن نگاشت ستون‌های ذخیره‌شدهٔ کاربر (appSettings: columnMapping) */
  N.getUserMapping = async function () {
    try {
      return (await RM.db.getSetting('columnMapping', {})) || {};
    } catch {
      return {};   // پیش از آماده‌شدن دیتابیس — حالت بدون Override
    }
  };

  /**
   * هدرهای واقعی Dataset فعلی — از متادیتای آخرین Import؛
   * در نبود آن، از raw اولین رکورد همان جدول.
   */
  N.getDatasetHeaders = async function (sourceKey) {
    const target = RM.config.IMPORT_TARGETS[sourceKey];
    try {
      const meta = await RM.db.getLatestImportMeta(sourceKey);
      if (meta && Array.isArray(meta.headers) && meta.headers.length) return meta.headers;
    } catch { /* دیتابیس در دسترس نیست */ }
    try {
      const first = await RM.db.db[target.table].limit(1).toArray();
      if (first.length && first[0].raw) return Object.keys(first[0].raw);
    } catch { /* جدول خالی */ }
    return [];
  };

  /**
   * عنوان‌های مؤثر ستون‌های جزئیات برای یک Dataset:
   * اگر Mapping (کاربر یا خودکار) به ستونی رسیده باشد → نام همان ستون اکسل؛
   * در غیر این صورت برچسب منطقی فارسی. این عنوان‌ها در جدول‌های جزئیات
   * (گروه رول، Drill-down کیفیت داده و Import) استفاده می‌شوند.
   */
  N.effectiveColumnLabels = async function (sourceKey) {
    const overrides = await N.getUserMapping();
    const headers = await N.getDatasetHeaders(sourceKey);
    const mapping = N.buildFieldMapping(sourceKey, headers, overrides[sourceKey] || {});
    const labels = {};
    for (const field of Object.keys(COLUMN_MAP[sourceKey])) {
      labels[field] = mapping[field] || N.fieldLabel(sourceKey, field);
    }
    return labels;
  };

  /**
   * برچسب منطقی یک فیلد با درنظرگرفتن برچسب‌های اختصاصی Dataset
   * (مثلاً width در «رول‌های موجود» = «عرض اولیه» و در آرشیو = «عرض»).
   */
  N.fieldLabel = function (sourceKey, field) {
    const src = RM.config.SOURCE_FIELD_LABELS[sourceKey];
    if (src && Object.prototype.hasOwnProperty.call(src, field)) return src[field];
    return RM.config.FIELD_LABELS[field] || field;
  };

  /* ---------------- فیلتر مشترک رکوردهای دارای نقص (Drill-down) ---------------- */

  /**
   * رکوردهای دارای یک نقص داده‌ای — رزولور مشترک Drill-down کیفیت
   * (Import گزارسنما + مرکز هشدار داشبورد از همین استفاده می‌کنند).
   * نکته: کلید «length» در گزارشنماها به فیلد «actualLength» مدل داخلی
   * نگاشت می‌شود (نام منطقی ≠ نام فیزیکی مدل).
   * issue ∈ width | length | thickness | rollNumber | filmType
   */
  N.recordsWithIssue = function (records, issueKey) {
    const field = issueKey === 'length' ? 'actualLength' : issueKey;
    return (records || []).filter((r) =>
      issueKey === 'rollNumber' ? r.rollNumber === '' :
      issueKey === 'filmType'   ? r.filmType === '' :
      r[field] === null
    );
  };

  /* ---------------- هویت رول از شمارهٔ رول (نسخهٔ ۲٫۹) ----------------
     سه مؤلفهٔ هویت در شمارهٔ رول:
       · حرف آغازین: F → خط تولید BOPP · K → خط تولید CPP
       · رقم اول بعد از حرف: شمارهٔ سالن (F2… → سالن ۲)
       · رقم دوم بعد از حرف: رقم آخر سال تولید (F25… → ۱۴۰۵)
     مثال: F2503640442L12M1122R1D → BOPP · سالن ۲ · سال ۱۴۰۵
     این هویت در همهٔ کلیدهای تطبیق رول↔ستاپ (نسخهٔ ۲٫۹) و کنترل‌های
     کیفیت داده نقش دارد. */

  const ROLL_IDENTITY_RE = /^([FK])(\d)(\d)/;

  /**
   * تجزیهٔ هویت (خط تولید + سالن + رقم سال) از شمارهٔ رول.
   * خروجی: { line: 'BOPP'|'CPP'|null, hall, yearDigit, year }
   *   hall/yearDigit عدد یا null · year = 1400 + yearDigit (یا null)
   */
  N.parseRollIdentity = function (rollNumber) {
    const s = U.toLatinDigits(String(rollNumber ?? '')).trim().toUpperCase();
    const m = ROLL_IDENTITY_RE.exec(s);
    if (!m) return { line: null, hall: null, yearDigit: null, year: null };
    const hall = U.parseInt(m[2]);
    const yearDigit = U.parseInt(m[3]);
    return {
      line: m[1] === 'F' ? 'BOPP' : 'CPP',
      hall,
      yearDigit,
      year: yearDigit === null ? null : 1400 + yearDigit,
    };
  };

  /* ---------------- عدد سال از تاریخ ستاپ (نسخهٔ ۲٫۹ — تغییر ۵) ----------------
     عدد سال = رقم آخر سالِ شمسی تاریخ ستاپ (1405/06/27 → ۵).
     فیلد جداگانه‌ای ندارد و همیشه از تاریخ استخراج می‌شود. */

  /** رقم آخر سالِ یک تاریخ شمسی نرمال‌شده (YYYY/MM/DD) — یا null */
  N.yearDigitOfDate = function (setupDate) {
    const parsed = U.parseJalaliDate(setupDate);
    return parsed ? parsed.y % 10 : null;
  };

  /**
   * هویت ستاپ از فیلدهای رکورد (نسخهٔ ۲٫۹):
   *   line  = productionLine ('BOPP'|'CPP')
   *   hall  = hallNumber (۱ تا ۴)
   *   yearDigit = رقم آخر سالِ setupDate
   * خروجی تهی در هر مؤلفه یعنی «نامشخص» — رکورد در تطبیق هویت‌دار
   * شرکت نمی‌کند تا تکمیل/مهاجرت شود.
   */
  N.setupIdentity = function (setup) {
    if (!setup) return { line: null, hall: null, yearDigit: null };
    return {
      line: setup.productionLine || null,
      hall: setup.hallNumber === undefined || setup.hallNumber === null ? null : setup.hallNumber,
      yearDigit: N.yearDigitOfDate(setup.setupDate),
    };
  };

  /** آیا هویت ستاپ کامل است (هر سه مؤلفه معتبر)؟ */
  N.setupIdentityComplete = function (setup) {
    const id = N.setupIdentity(setup);
    return id.line !== null && id.hall !== null && id.yearDigit !== null;
  };

  /* ---------------- قوانین تشخیص کسب‌وکار (§6-§7) ---------------- */

  /**
   * آیا نوع فیلم شامل حرف R/r است؟ (Case-Insensitive — §6)
   * بررسی Contains نه CharAt؛ دقیقاً طبق سند: filmType.includes('R')
   */
  function hasR(filmType) {
    return String(filmType ?? '').toLowerCase().includes('r');
  }

  /**
   * آیا شماره پالت «خالی» است؟ (§6)
   * null/undefined/""/"   " → خالی
   * 0 ، "0" ، "P0" ، "0:1" → غیرخالی
   */
  function isEmptyPallet(palletNumber) {
    if (palletNumber === null || palletNumber === undefined) return true;
    return String(palletNumber).trim() === '';
  }

  /**
   * آیا این رکورد یک «رول خام فعلی» است؟ (rolls.xlsx — §6، §32)
   * شرط: نوع فیلم دارای R/r  و  پالت خالی
   */
  function isRawRoll(record) {
    return hasR(record.filmType) && isEmptyPallet(record.palletNumber);
  }

  /* ---------------- قوانین تشخیص رول‌های برش‌خورده (فرزند) ---------------- */

  /**
   * آیا این رکورد یک «رول برش‌خورده» است؟
   * رول‌های برش‌خورده همیشه چند کاراکتر بعد از M در شناسهٔ رول، مشخصهٔ بازو
   * (حرف L یا R) دارند — شمارهٔ بازو مهم نیست، فقط حرف بعد از M (و ارقام
   * میان آن‌ها) تعیین‌کننده است:
   *   F3501940722R8M3311R1P1:0  → M3311R ✓ برش‌خورده
   *   K1311710151L4M1121R1D     → M1121R ✓
   *   F3501910121R4M121L2       → M121L  ✓
   *   F3504710071R8M21          → M21 بدون L/R ✗ (هنوز برش نشده)
   *   K2503330611R2             → بدون M ✗
   */
  const CUT_ARM_RE = /M\d*[LR]/;

  function isCutRoll(record) {
    return CUT_ARM_RE.test(String(record?.rollNumber ?? ''));
  }

  /**
   * حرف گرید رکورد — فقط پیشوند لاتین ستون گرید (X / U / Q / T):
   *   'U-F045-281-191-196-139' → 'U'
   *   'X-F239-195-163-117'     → 'X'
   *   بدون پیشوند مجاز → null (در هیچ‌یک از چهار دسته شمرده نمی‌شود)
   */
  function gradeLetter(record) {
    const g = String(record?.grade ?? '').trim();
    if (!g) return null;
    const first = g.charAt(0).toUpperCase();
    return RM.config.GRADE_LETTERS.includes(first) ? first : null;
  }

  /**
   * آیا رکورد در «پای کار» است؟ (ستون موقعیت فعلی → فیلد وضعیت)
   * جست‌وجوی Contains روی عبارت «پای کار» (مثل «انبار پای کار CPP»).
   */
  function isEndOfLine(record) {
    return String(record?.status ?? '').includes(RM.config.END_OF_LINE_KEYWORD);
  }

  /* ---------------- ثبت در فضای نام ---------------- */

  N.resolveColumn = resolveColumn;
  N.buildFieldMapping = buildFieldMapping;
  N.normalizeRow = normalizeRow;
  N.normalizeRows = normalizeRows;
  N.normalizePalletRow = normalizePalletRow;
  N.normalizePalletRows = normalizePalletRows;
  N.hasM = hasM;
  N.parseRollList = parseRollList;
  N.hasR = hasR;
  N.isEmptyPallet = isEmptyPallet;
  N.isRawRoll = isRawRoll;
  N.isCutRoll = isCutRoll;
  N.gradeLetter = gradeLetter;
  N.isEndOfLine = isEndOfLine;

  RM.normalize = N;
})();
