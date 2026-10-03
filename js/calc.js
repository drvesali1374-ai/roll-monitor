/* =========================================================================
   calc.js — موتور محاسبهٔ مرکزی (Calculation Engine) ⭐
   -------------------------------------------------------------------------
   این تنها منبع محاسباتی کل سیستم است (Single Source of Truth — §53، §79،
   §105). هیچ نما (Dashboard، Setup، Raw Rolls) منطق محاسبهٔ خودش را ندارد.

   خط لولهٔ محاسبه (§54):
     Raw Excel (نرمال‌شده)
        ↓  قوانین متراژ استاندارد → استانداردسازی طول
     گروه‌بندی رول‌های خام (کلید ۳فاکتوری §40)
        ↓
     متالایز یونیک از آرشیو (§7)
        ↓
     تطبیق با ستاپ‌ها + تخصیص ظرفیت‌محور (§42-§44)
        ↓
     گزارش ستاپ + هشدارها + خلاصهٔ داشبورد
   -------------------------------------------------------------------------
   خروجی calculateProductionState():
     {
       rawRollGroups,      گروه‌های رول خام (§33)
       metallizedGroups,   گروه‌های متالایز (کلید ۲فاکتوری §41)
       setupReport,        گزارش هر ستاپ (§46-§50)
       warnings,           هشدارهای مرکزی کیفیت داده (§52)
       summary             خلاصهٔ KPI داشبورد (§57-§59)
     }
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const N = RM.normalize;
  const R = RM.rulesEngine;
  const DB = RM.db;

  const Calc = { _cached: null, _dirty: true };

  /* ================================================================
     ۱) استانداردسازی + گروه‌بندی رول‌های خام (§33، §40)
     ================================================================ */

  /**
   * گروه‌بندی رول‌های خام فعلی بر اساس کلید (نسخهٔ ۲٫۹ — +هویت):
   *     عرض + متراژ استاندارد + شماره ستاپ + خط تولید + سالن + عدد سال
   * هویت (خط/سالن/سال) از شمارهٔ رول خوانده می‌شود (F=BOPP · K=CPP،
   * رقم اول = سالن، رقم دوم = رقم آخر سال) — ستاپ‌هایی با شمارهٔ مشابه
   * اما خط/سالن/سال متفاوت، هویت‌های جداگانه‌اند و جداگانه تطبیق می‌شوند.
   * رول‌هایی که قانون متراژی ندارند با standardLength=null گروه می‌شوند
   * و در تطبیق ستاپ شرکت نمی‌کنند (§17) اما دیده می‌شوند (شفافیت).
   *
   * نسخهٔ ۳٫۹ — تغییر ۱: فیلد «عرض» در کلیدهای انطباق/تخصیص جایگزین
   * «عرض اولیه» شد — مبنای کلیدِ رول‌های موجود اکنون cutWidth است
   * (ستون «عرض» در نگاشت اکسل «رول‌های موجود»)؛ تغییر فقط در محاسبات
   * و منطق کلیدهاست و هیچ تغییر ظاهری ندارد. متالایز (آرشیو) از قبل
   * با ستون «عرض» آرشیو و رول‌های برش‌خورده از قبل با cutWidth کار
   * می‌کنند — کلید سمت ستاپ (setup.width) نیز دست‌نخورده است.
   */
  function buildRawRollGroups(rawRolls, rules) {
    const groups = new Map();   // key → group object
    const noRuleCount = { count: 0 };   // رول‌های بدون قانون متراژ

    for (const roll of rawRolls) {
      // متراژ استاندارد از قوانین (§19)
      const standardLength = R.resolveStandardLength(rules, roll.thickness, roll.actualLength);
      if (standardLength === null) noRuleCount.count++;

      // هویت رول از شمارهٔ رول (نسخهٔ ۲٫۹)
      const id = N.parseRollIdentity(roll.rollNumber);
      /* ۳٫۹ — تغییر ۱: فیلد «عرض» (cutWidth — ستون «عرض» فایل رول‌های موجود)
         مبنای کلید انطباق/تخصیص است؛ جایگزین «عرض اولیه» (width) شد. */
      const matchWidth = roll.cutWidth;
      const key = U.formatKey(matchWidth, standardLength, roll.setupNumber, id.line, id.hall, id.yearDigit);
      let group = groups.get(key);

      if (!group) {
        group = {
          key,
          width: matchWidth,
          standardLength,
          setupNumber: roll.setupNumber,
          line: id.line,                                          // نسخهٔ ۲٫۹ — هویت گروه
          hall: id.hall,
          yearDigit: id.yearDigit,
          thickness: roll.thickness,
          count: 0,
          rollNumbers: [],        // برای Audit و پیش‌نمایش
          rollIds: [],            // شناسه‌های رکوردها — برای جزئیات گروه (§7 اصلاحات)
          hasRule: standardLength !== null,
          matched: false,         // پس از ساخت نمایهٔ ستاپ‌ها تکمیل می‌شود
        };
        groups.set(key, group);
      }

      group.count++;
      if (group.rollNumbers.length < 500) group.rollNumbers.push(roll.rollNumber);
      group.rollIds.push(roll.id);
    }

    return { groups: [...groups.values()], noRuleCount: noRuleCount.count };
  }

  /* ================================================================
     ۲) متالایز یونیک از آرشیو (§7، §41، §48)
     ================================================================ */

  /**
   * استخراج رول‌های خام متالایز شده:
     - فقط رکوردهای دارای R/r
     - یونیک بر اساس شماره رول (هر رول فقط یک‌بار — §7)
     - گروه‌بندی با کلید: عرض + شماره ستاپ (§41)
   * توجه: از شماره رول برای استخراج بخش قبل از M استفاده نمی‌شود (§7).
   * نسخهٔ ۳٫۱ — تغییر ۳: «متراژ استاندارد» به کلید تطبیق اضافه شد (مثل کلید
     خام) — متراژ استاندارد هر رول آرشیو از قوانین (ضخامت + متراژ واقعی)
     حل می‌شود؛ رول‌های متالایزِ دارای متراژ متفاوت دیگر به ستاپ‌های هم‌عرض
     با متراژ استاندارد دیگر تخصیص نمی‌خورند. خروجی keyByRollNumber برای
     Drill-down مازاد متالایز (بازسازی بدون کلید در داشبورد) هم برمی‌گردد.
   * نسخهٔ ۳٫۷ — تغییر ۳: نقشهٔ fiveKeyByRollNumber (کلید ۵فاکتوری بدون عرض
     = متراژ استاندارد + شماره ستاپ + خط تولید + شماره سالن + عدد سال) هم
     برمی‌گردد — مبنای هشدار «رول متالایز با عرض تعریف‌نشده در ستاپ» در
     مرکز هشدار کیفیت دادهٔ داشبورد.
   */
  function buildMetallizedGroups(archivedRolls, rules) {
    const uniqueByRollNumber = new Map();   // rollNumber → رکورد یونیک

    for (const roll of archivedRolls) {
      if (!N.hasR(roll.filmType)) continue;
      const rn = String(roll.rollNumber ?? '').trim();
      if (rn === '') continue;
      if (!uniqueByRollNumber.has(rn)) {
        uniqueByRollNumber.set(rn, roll);   // اولین رخورد کافی است (یونیک‌سازی)
      }
    }

    // گروه‌بندی (نسخهٔ ۲٫۹: کلید عرض + ستاپ + خط تولید + سالن + سال از شمارهٔ رول
    //             نسخهٔ ۳٫۱ — تغییر ۳: + متراژ استاندارد حل‌شده از قوانین)
    const groups = new Map();
    const keyByRollNumber = {};        // rollNumber → کلید ۶فاکتوری گروه (برای Drill-down)
    const fiveKeyByRollNumber = {};    // rollNumber → کلید ۵فاکتوری بدون عرض (نسخهٔ ۳٫۷ — تغییر ۳)
    for (const roll of uniqueByRollNumber.values()) {
      const id = N.parseRollIdentity(roll.rollNumber);
      const standardLength = R.resolveStandardLength(rules, roll.thickness, roll.actualLength);
      const key = U.formatKey(roll.width, standardLength, roll.setupNumber, id.line, id.hall, id.yearDigit);
      const fiveKey = U.formatKey(standardLength, roll.setupNumber, id.line, id.hall, id.yearDigit);   // بدون عرض (۳٫۷ — تغییر ۳)
      keyByRollNumber[String(roll.rollNumber ?? '')] = key;
      fiveKeyByRollNumber[String(roll.rollNumber ?? '')] = fiveKey;
      let group = groups.get(key);
      if (!group) {
        group = {
          key, width: roll.width, standardLength,               // نسخهٔ ۳٫۱ — تغییر ۳
          setupNumber: roll.setupNumber,
          line: id.line, hall: id.hall, yearDigit: id.yearDigit,   // نسخهٔ ۲٫۹
          count: 0, rollNumbers: [],
          rollIds: [],            // شناسه‌های رکوردها — برای Drill-down تخصیص هر ستاپ (۳٫۸)
        };
        groups.set(key, group);
      }
      group.count++;
      if (group.rollNumbers.length < 500) group.rollNumbers.push(roll.rollNumber);
      group.rollIds.push(roll.id);
    }

    return {
      uniqueCount: uniqueByRollNumber.size,
      uniqueRecords: [...uniqueByRollNumber.values()],   // برای Drill-down مازاد متالایز
      keyByRollNumber,                                    // نسخهٔ ۳٫۱ — تغییر ۳ (Drill بدون بازسازی کلید)
      fiveKeyByRollNumber,                                // نسخهٔ ۳٫۷ — تغییر ۳ (هشدار عرض تعریف‌نشده در ستاپ)
      groups: [...groups.values()],
    };
  }

  /* ================================================================
     ۳) موتور تخصیص ظرفیت‌محور (§42-§44)
     ================================================================ */

  /**
   * تخصیص رول‌های موجود (خام یا متالایز) به ستاپ‌های دارای کلید مشترک.
   *
   * الگوریتم (§43):
   *   ۱) ستاپ‌های دارای کلید را بر اساس «ظرفیت مؤثر» صعودی مرتب کن
   *   ۲) به‌ترتیب، هر ستاپ تا سقف ظرفیت خودش رول بگیرد (Greedy ASC)
   *   ۳) هر رول فقط به یک ستاپ تخصیص می‌یابد (بدون شمارش مضاعف — §88)
   *   ۴) مازاد → Unallocated و در هشدارها گزارش می‌شود (§44)
   *
   * نسخهٔ ۳٫۷ — تغییر ۲ (opts.lastTakesAll):
   *   در آخرین مرحلهٔ فرایند تخصیص، همهٔ رول‌های باقی‌مانده به «آخرین رکوردِ
   *   هم‌کلید ستاپ» (آخرین رکورد در ترتیب تخصیص) تخصیص می‌خورند — حتی اگر
   *   تعداد آنها از ظرفیت (تعداد رول) آن رکورد بیشتر باشد. مازاد به‌جای
   *   «تخصیص‌نیافته ماندن»، به‌صورت اضافه‌تخصیص روی همان رکورد آخر ظاهر
   *   می‌شود → «برش‌نشده» آن رکورد منفی → هشدار قرمز «مغایرت ظرفیت» — تا
   *   کاربر متوجه خطای ظرفیت شود. مثال: ۱۰ رول متالایز هم‌کلید با دو رکورد
   *   ستاپ (تعداد ۳ و ۶) → ۳ رول به رکورد اول + هر ۷ رول باقی‌مانده به رکورد
   *   دوم (۱ رول بیش از ظرفیت → مغایرت ظرفیت ۱).
   *
   * نسخهٔ ۳٫۱۱ — تغییر ۱ (opts.capacityOf — ظرفیت مؤثر):
   *   ظرفیت هر رکورد دیگر لزوماً rollCount نیست — با opts.capacityOf تابعِ
   *   «ظرفیت مؤثر» هر رکورد تعیین می‌شود. مبنای مرتب‌سازی صعودی و سقف تخصیص
   *   همان ظرفیت مؤثر است. برای تخصیص متالایز ظرفیت مؤثر = rollCount (حالت
   *   پیش‌فرض)؛ برای تخصیص خام = تعداد − متالایزِ تخصیص‌یافتهٔ همان رکورد
   *   (گام ۳ درخواست کاربر — «برش‌نشده قبل از ورود رول‌های خام»).
   *   تساوی ظرفیت‌ها با شناسهٔ پایدار id قطعی می‌شود (deterministic — نتیجه
   *   در Refreshهای مختلف با دادهٔ یکسان تغییر نمی‌کند).
   *   نسخهٔ ۳٫۱۱ — تغییر ۲: تخصیص خام هم مثل متالایز lastTakesAll دارد —
   *   آخرین رکورد هم‌کلید همهٔ رول‌های باقی‌ماندهٔ خام را می‌گیرد (اضافه‌تخصیص
   *   → برش‌نشدهٔ منفی → مغایرت ظرفیت قابل مشاهده).
   *
   * @param {number} available        تعداد رول در دسترس برای این کلید
   * @param {Array}  candidateSetups  ستاپ‌های دارای کلید مشترک
   * @param {object} [opts]           { lastTakesAll: boolean, rollIds?: Array, capacityOf?: (setup)=>number }
   *     rollIds (۳٫۸): فهرست شناسه‌های رول‌های هم‌کلید — تخصیص از ابتدای فهرست
   *     و به‌ترتیب ظرفیت‌ها برش می‌خورد تا در Drill-down/Audit رول‌های واقعیِ
   *     هر رکورد قابل نمایش باشند (برش ترتیبی و قطعی).
   *     capacityOf (۳٫۱۱): تابع ظرفیت مؤثر هر رکورد — پیش‌فرض: (s) => s.rollCount.
   * @returns {Map} setupId → { allocated, capacity (مؤثر), rollIds? }، به‌همراه unallocated
   */
  function allocateByKey(available, candidateSetups, opts) {
    const lastTakesAll = !!(opts && opts.lastTakesAll);
    const rollIds = (opts && Array.isArray(opts.rollIds)) ? opts.rollIds : null;
    /* ۳٫۱۱ — ظرفیت مؤثر: پیش‌فرض rollCount؛ برای خام = تعداد − متالایزِ تخصیص‌یافته */
    const capacityOf = (opts && typeof opts.capacityOf === 'function')
      ? opts.capacityOf
      : (s) => s.rollCount;

    // مرتب‌سازی صعودی بر اساس ظرفیت مؤثر (§43) — تساوی‌ها با شناسهٔ پایدار id قطعی (۳٫۱۱)
    const sorted = [...candidateSetups].sort((a, b) =>
      capacityOf(a) - capacityOf(b) || a.id - b.id
    );

    let remaining = available;
    let cursor = 0;   // نشانگر برش ترتیبی از ابتدای فهرست rollIds (۳٫۸)
    const allocation = new Map();   // setupId → { allocated, capacity (مؤثر), rollIds? }
    const lastIndex = sorted.length - 1;

    for (let i = 0; i < sorted.length; i++) {
      const setup = sorted[i];
      const capacity = capacityOf(setup);   // ۳٫۱۱ — ظرفیت مؤثر (می‌تواند ۰ یا منفی باشد)
      // ظرفیت منفی یعنی رکورد از قبل پُر شده → تخصیص ۰ رول (محافظ)
      let granted;
      if (lastTakesAll && i === lastIndex) {
        // آخرین رکورد هم‌کلید: همهٔ باقی‌مانده — حتی مازاد بر ظرفیت
        // (اضافه‌تخصیص → مغایرت ظرفیت) — متالایز از ۳٫۷، خام از ۳٫۱۱
        granted = Math.max(0, remaining);
      } else {
        granted = Math.max(0, Math.min(capacity, remaining));
      }
      const entry = { allocated: granted, capacity };
      if (rollIds) {
        entry.rollIds = rollIds.slice(cursor, cursor + granted);
        cursor += granted;
      }
      allocation.set(setup.id, entry);
      remaining -= granted;
      if (remaining <= 0) break;
    }

    // ستاپ‌هایی که به دلیل break حلقه تخصیص نگرفتند
    for (const setup of sorted) {
      if (!allocation.has(setup.id)) {
        const entry = { allocated: 0, capacity: capacityOf(setup) };
        if (rollIds) entry.rollIds = [];
        allocation.set(setup.id, entry);
      }
    }

    return { allocation, unallocated: Math.max(0, remaining) };
  }

  /* ================================================================
     ۴-ب) گزارش رول‌های برش‌خورده (فرزند) — کلید: عرض برش + شماره ستاپ
     ================================================================ */

  /**
   * ساخت گزارش رول‌های برش‌خورده از دو منبع:
   *
   *  ۱) «رول‌های موجود» — رکوردهایی که شناسهٔ رولشان مشخصهٔ بازو (L/R)
   *     بعد از M دارد (N.isCutRoll)؛ کلید هر رکورد: cutWidth + setupNumber.
   *     شمارش‌ها: موجود، گریدهای X/U/Q/T، پای کار (موقعیت فعلی)، پالت شده.
   *
   *  ۲) «گزارش تولید ستاپ‌ها» — تنوع عرض‌های الگوی برش هر ستاپ، مبنای
   *     رکوردهای جدول است (تغییر ۱ — تعداد ست):
   *       مقدار در ستاپ   = Σ (تکرار عرض در الگو × تعداد ست × ستون «تعداد»)
   *       مقدار برش‌نخورده = Σ (تکرار عرض در الگو × تعداد ست × ستون «برش‌نشده»)
   *     روی همهٔ رکوردهای گزارش با همان شماره ستاپ. تعداد ست هر رکورد =
   *     متراژ استاندارد ÷ کوچکترین متراژ استاندارد همان ضخامت (رول ۱ ستی).
   *
   *  وزن (تغییر ۳ — وزن خالص واقعی):
   *    - فقط «مقدار در ستاپ» و «مقدار برش‌نخورده» = عرض × ۰٫۳۶۲ × تعداد (فرمول)
   *    - مابقی (موجود/گریدها/پای کار/پالت) = Σ «وزن خالص» واقعی رول‌های
   *      منطبق از فایل (ستون Mapping «وزن خالص»)؛ برای رول بی‌وزن، همان
   *      رول با فرمول (عرض × ۰٫۳۶۲) برآورد می‌شود.
   */
  function buildCutRollsReport(rolls, setupReport) {
    const GRADES = RM.config.GRADE_LETTERS;
    const W_PER_MM = RM.config.CUT_WEIGHT_PER_MM;

    /* --- ۱) نمایهٔ رول‌های برش‌خوردهٔ موجود (بر کلید عرض + ستاپ) ---
       تغییر ۳: وزن خالص واقعی هر رول (ستون Mapping «وزن خالص») جمع می‌شود؛
       رول بدون وزن خالص با فرمول عرض × ۰٫۳۶۲ برآورد می‌شود. */
    const cutIndex = new Map();   // key → bucket
    let cutTotal = 0;
    let cutUnmatchable = 0;       // برش‌خورده بدون عرض/ستاپ — در هیچ رکوردی نمی‌نشیند

    /** وزن مؤثر یک رول برش‌خورده: وزن خالص واقعی یا فرمول (تغییر ۳) */
    const rollWeight = (roll) =>
      (roll.netWeight !== null && roll.netWeight !== undefined && Number.isFinite(roll.netWeight))
        ? roll.netWeight
        : roll.cutWidth * W_PER_MM;

    for (const roll of rolls) {
      if (!N.isCutRoll(roll)) continue;
      cutTotal++;
      if (roll.cutWidth === null || roll.setupNumber === null) {
        cutUnmatchable++;
        continue;
      }
      const cid = N.parseRollIdentity(roll.rollNumber);   // نسخهٔ ۲٫۹ — هویت از شمارهٔ رول
      const key = U.formatKey(roll.cutWidth, roll.setupNumber, cid.line, cid.hall, cid.yearDigit);
      let bucket = cutIndex.get(key);
      if (!bucket) {
        bucket = {
          count: 0,
          grades: { X: 0, U: 0, Q: 0, T: 0 },
          endCount: 0,
          palletCount: 0,
          rollIds: [],
          /* --- وزن‌های خالص واقعی (تغییر ۳) --- */
          netWeightSum: 0,
          gradeNetWeights: { X: 0, U: 0, Q: 0, T: 0 },
          endNetWeight: 0,
          palletNetWeight: 0,
        };
        cutIndex.set(key, bucket);
      }
      bucket.count++;
      const w = rollWeight(roll);
      bucket.netWeightSum += w;
      const g = N.gradeLetter(roll);
      if (g) {
        bucket.grades[g]++;
        bucket.gradeNetWeights[g] += w;
      }
      if (N.isEndOfLine(roll)) {
        bucket.endCount++;
        bucket.endNetWeight += w;
      }
      if (!N.isEmptyPallet(roll.palletNumber)) {
        bucket.palletCount++;
        bucket.palletNetWeight += w;
      }
      if (bucket.rollIds.length < 2000) bucket.rollIds.push(roll.id);
    }

    /* --- ۲) رکوردهای جدول از تنوع عرض‌های الگوی برش ستاپ‌ها --- */
    const recordsMap = new Map();   // key → record

    for (const sr of setupReport) {
      if (sr.setupNumber === null) continue;
      // ستاپ بدون هویت کامل رکورد برش‌خورده نمی‌سازد (تطبیق ممکن نیست — نسخهٔ ۲٫۹)
      if (!N.setupIdentityComplete(sr)) continue;
      const parsed = RM.setupEngine.parsePattern(sr.cuttingPattern);
      if (!parsed.ok || !parsed.parts.length) continue;

      const sid = N.setupIdentity(sr);
      for (const part of parsed.parts) {
        const key = U.formatKey(part, sr.setupNumber, sid.line, sid.hall, sid.yearDigit);
        if (!recordsMap.has(key)) {
          recordsMap.set(key, {
            key,
            width: part,
            setupNumber: sr.setupNumber,
            line: sid.line, hall: sid.hall, yearDigit: sid.yearDigit,   // نسخهٔ ۲٫۹
            existingCount: 0,
            inSetupCount: 0,
            uncutCount: 0,
            grades: { X: 0, U: 0, Q: 0, T: 0 },
            endCount: 0,
            palletCount: 0,
            matchedRollIds: [],
          });
        }
      }
    }

    /* --- ۳) محاسبهٔ «در ستاپ» و «برش‌نخورده» از رکوردهای گزارش ---
       برای هر کلید، روی همهٔ رکوردهای گزارش با همان شماره ستاپ:
       تعداد تکرار عرض در الگو × (تعداد | برش‌نشده) — جمع کل. */
    const setupsByNumber = new Map();   // setupNumber → [report rows]
    for (const sr of setupReport) {
      if (sr.setupNumber === null) continue;
      if (!setupsByNumber.has(sr.setupNumber)) setupsByNumber.set(sr.setupNumber, []);
      setupsByNumber.get(sr.setupNumber).push(sr);
    }

    for (const record of recordsMap.values()) {
      const rows = setupsByNumber.get(record.setupNumber) || [];
      for (const sr of rows) {
        const parsed = RM.setupEngine.parsePattern(sr.cuttingPattern);
        if (!parsed.ok || !parsed.parts.length) continue;
        let occurrences = 0;
        for (const part of parsed.parts) {
          if (part === record.width) occurrences++;
        }
        if (occurrences === 0) continue;
        /* --- تغییر ۱: تعداد رول مادر × تعداد ست = تعداد فرزند ---
           هر قطعه الگو به‌ازای هر «ستِ» رول مادر یک‌بار تولید می‌شود؛
           تعداد ست = متراژ استاندارد ÷ کوچکترین استاندارد ضخامت. */
        const setCount = Number.isFinite(sr.setCount) && sr.setCount > 0 ? sr.setCount : 1;
        record.inSetupCount += occurrences * setCount * (sr.rollCount || 0);
        record.uncutCount += occurrences * setCount * (sr.uncut || 0);
      }

      /* --- ۴) پیوند با رول‌های موجود هم‌کلید (موجود/گرید/پای کار/پالت) --- */
      const bucket = cutIndex.get(record.key);
      if (bucket) {
        record.existingCount = bucket.count;
        record.grades = { ...bucket.grades };
        record.endCount = bucket.endCount;
        record.palletCount = bucket.palletCount;
        record.matchedRollIds = [...bucket.rollIds];
        /* --- وزن‌های خالص واقعی (تغییر ۳) --- */
        record.netWeightSum = bucket.netWeightSum;
        record.gradeNetWeights = { ...bucket.gradeNetWeights };
        record.endNetWeight = bucket.endNetWeight;
        record.palletNetWeight = bucket.palletNetWeight;
      }
    }

    /* --- ۵) رکوردهای برش‌خوردهٔ موجودِ خارج از ستاپ‌ها (حالت شفافیت) ---
       اگر رول برش‌خورده‌ای در فایل موجود با کلیدی باشد که هیچ الگویی نمی‌سازد،
       در آمار گزارش می‌ماند اما رکورد مستقل نمی‌سازد (تعریف رکورد = از ستاپ). */
    const records = [...recordsMap.values()];

    /* --- ۶) آمار کلی --- */
    const stats = {
      totalRecords: records.length,
      cutRollsFound: cutTotal,
      cutUnmatchable,
      totalExisting: records.reduce((s, r) => s + r.existingCount, 0),
      totalInSetup: records.reduce((s, r) => s + r.inSetupCount, 0),
      totalUncut: records.reduce((s, r) => s + r.uncutCount, 0),
    };

    /* --- وزن‌ها (تغییر ۳) ---
       فقط «در ستاپ» و «برش‌نخورده» با فرمول عرض × ۰٫۳۶۲ × تعداد؛
       مابقی از «وزن خالص» واقعی رول‌های منطبق فایل (Mapping «وزن خالص»). */
    const weightOf = (width, count) => width * W_PER_MM * count;
    for (const r of records) {
      // فیلدهای مسطح گریدها (برای مرتب‌سازی/فیلتر/نمای جدول)
      r.xCount = r.grades.X;
      r.uCount = r.grades.U;
      r.qCount = r.grades.Q;
      r.tCount = r.grades.T;

      /* فرمول — فقط این دو ستون (سفارش کاربر) */
      r.inSetupWeight = weightOf(r.width, r.inSetupCount);
      r.uncutWeight = weightOf(r.width, r.uncutCount);

      /* وزن خالص واقعی — از دیتای فایل (با برآورد فرمول برای رول بی‌وزن) */
      r.existingWeight = r.netWeightSum || 0;
      r.gradeWeights = {
        X: (r.gradeNetWeights && r.gradeNetWeights.X) || 0,
        U: (r.gradeNetWeights && r.gradeNetWeights.U) || 0,
        Q: (r.gradeNetWeights && r.gradeNetWeights.Q) || 0,
        T: (r.gradeNetWeights && r.gradeNetWeights.T) || 0,
      };
      r.endWeight = r.endNetWeight || 0;
      r.palletWeight = r.palletNetWeight || 0;
    }

    return { records, stats, gradeLetters: GRADES };
  }

  /* ================================================================
     ۵) موتور محاسبهٔ اصلی — calculateProductionState (§53)
     ================================================================ */

  /**
   * محاسبهٔ وضعیت کامل تولید از تمام منابع داده.
   * این تابع تنها منبع حقیقت کل رابط کاربری است.
   */
  async function calculateProductionState() {
    const { rolls, archivedRolls, setupRolls, rules, importMetadata } = await DB.loadAllSources();

    /* --- قوانین زمان متالایز (تنظیمات — تغییرات جدید) --- */
    const timeRules = await DB.getSetting('machineTimeRules', []);

    /* --- ۱) رول‌های خام فعلی (§6: R/r + پالت خالی) --- */
    const rawRolls = rolls.filter(N.isRawRoll);

    /* --- ۲) گروه‌بندی خام (§33) --- */
    const { groups: rawRollGroups, noRuleCount } = buildRawRollGroups(rawRolls, rules);

    /* --- ۳) متالایز یونیک (§7 — نسخهٔ ۳٫۱: قوانین برای حل متراژ استاندارد هر رول) --- */
    const metallized = buildMetallizedGroups(archivedRolls, rules);

    /* --- ۴) نمایه‌سازی گروه‌های خام برای تطبیق سریع (§56: Map) --- */
    const rawGroupIndex = new Map();
    for (const group of rawRollGroups) {
      if (group.hasRule) rawGroupIndex.set(group.key, group);
    }

    /* --- ۵) نمایهٔ ستاپ‌ها ---
       rawIndex:  کلید «عرض + متراژ استاندارد + ستاپ + هویت» → ستاپ‌ها
       metIndex:  کلید «عرض + متراژ استاندارد + ستاپ + هویت» → ستاپ‌ها
       (نسخهٔ ۳٫۱ — تغییر ۳: متراژ استاندارد به کلید متالایز هم اضافه شد —
       هم‌قالب با کلید خام؛ رول‌های متالایز فقط به ستاپ‌های هم‌عرض و هم‌متراژ تخصیص می‌خورند)
       نسخهٔ ۳٫۷ — تغییر ۳: metFiveKeys = مجموعهٔ کلیدهای ۵فاکتوریِ ستاپ‌های
       کامل «بدون عرض» (متراژ استاندارد + ستاپ + خط + سالن + سال) — مبنای
       هشدار «رول متالایز با عرض تعریف‌نشده در ستاپ»: رولی که کلید ۵فاکتوری‌اش
       با ستاپ مطابق است ولی کلید کامل (با عرض) با هیچ رکوردی مطابق نیست. */
    const rawIndex = new Map();
    const metIndex = new Map();
    const metFiveKeys = new Set();

    for (const setup of setupRolls) {
      // ستاپ ناقص (قدیمی/ناتمام) در تطبیق شرکت نمی‌کند (§25 کلید نیازمند داده کامل)
      // نسخهٔ ۲٫۹: هویت (خط تولید + سالن + تاریخ ستاپ) هم باید کامل باشد
      const isComplete = setup.thickness !== null && setup.standardLength !== null &&
        N.setupIdentityComplete(setup);
      if (isComplete) {
        const sid = N.setupIdentity(setup);
        const rawKey = U.formatKey(setup.width, setup.standardLength, setup.setupNumber, sid.line, sid.hall, sid.yearDigit);
        if (!rawIndex.has(rawKey)) rawIndex.set(rawKey, []);
        rawIndex.get(rawKey).push(setup);

        const metKey = U.formatKey(setup.width, setup.standardLength, setup.setupNumber, sid.line, sid.hall, sid.yearDigit);   // نسخهٔ ۳٫۱ — تغییر ۳: + متراژ استاندارد
        if (!metIndex.has(metKey)) metIndex.set(metKey, []);
        metIndex.get(metKey).push(setup);

        // نسخهٔ ۳٫۷ — تغییر ۳: کلید ۵فاکتوری بدون عرض (متراژ استاندارد + ستاپ + خط + سالن + سال)
        metFiveKeys.add(U.formatKey(setup.standardLength, setup.setupNumber, sid.line, sid.hall, sid.yearDigit));
      }
    }

    // تکمیل پرچم «matched» گروه‌ها (وضعیت تطبیق — برای جدول و مرتب‌سازی وضعیت)
    for (const group of rawRollGroups) {
      group.matched = group.hasRule && rawIndex.has(group.key);
    }

    /* --- ۶) تخصیص متالایز به ستاپ‌ها (§42-§44 — کلید «عرض + متراژ استاندارد + ستاپ + هویت» نسخهٔ ۳٫۱)
       نسخهٔ ۳٫۷ — تغییر ۲: آخرین رکورد هم‌کلید ستاپ همهٔ رول‌های باقی‌مانده را
       می‌گیرد (حتی بیش از ظرفیت خود) → مازاد به‌جای «تخصیص‌نیافته»، به‌صورت
       اضافه‌تخصیص و «مغایرت ظرفیت» گزارش می‌شود تا کاربر متوجه خطا شود.
       نسخهٔ ۳٫۱۱ — ترتیب گام‌ها: تخصیص متالایز «پیش از» تخصیص خام انجام می‌شود؛
       چون ظرفیت مؤثر رول خام هر رکورد = تعداد − متالایزِ تخصیص‌یافتهٔ همان
       رکورد است و باید پس از این گام در دسترس باشد (گام ۷). --- */
    const metAllocationBySetup = new Map();
    const metUnallocatedTotal = { total: 0, keys: [] };

    for (const [key, group] of metIndex) {
      const metGroup = metallized.groups.find((g) => g.key === key);
      const available = metGroup ? metGroup.count : 0;
      if (!available) continue;

      const { allocation, unallocated } = allocateByKey(available, group, { lastTakesAll: true, rollIds: metGroup ? metGroup.rollIds : null });
      if (unallocated > 0) {
        metUnallocatedTotal.total += unallocated;
        metUnallocatedTotal.keys.push({ key, unallocated, available });
      }

      for (const [setupId, info] of allocation) {
        metAllocationBySetup.set(setupId, {
          ...info,
          sourceKey: key,
          groupCount: available,
        });
      }
    }

    /* --- ۷) تخصیص رول‌های خام موجود به ستاپ‌ها (ظرفیت‌محور — بازطراحی ۳٫۱۱) ---
       ترتیب کامل محاسبات (۳٫۱۱): متالایز → ظرفیت باقی‌مانده → خام → برش‌نشدهٔ نهایی.
       ظرفیت مؤثر هر رکورد برای رول خام = تعداد Setup − متالایزِ تخصیص‌یافتهٔ
       همان رکورد («برش‌نشده قبل از ورود رول‌های خام») — rollCount دیگر ظرفیت
       مستقیم Allocation خام نیست؛ فقط یکی از اجزای محاسبهٔ ظرفیت اولیه و
       برش‌نشدهٔ نهایی است.
       رفتار مازاد مانند متالایز (۳٫۱۱): رکوردها صعودی بر اساس ظرفیت مؤثر پر
       می‌شوند و «آخرین رکورد هم‌کلید» همهٔ رول‌های باقی‌مانده را می‌گیرد — حتی
       اگر از ظرفیتش بیشتر باشد (اضافه‌تخصیص → برش‌نشدهٔ منفی → مغایرت ظرفیت).
       هر رول فقط به یک ستاپ تخصیص می‌یابد (§88 — بدون شمارش مضاعف). */
    const rawAllocationBySetup = new Map();   // setupId → { allocated, capacity (مؤثر), audit }
    const rawUnallocatedTotal = { total: 0, keys: [] };
    const rawUnmatchedRollIds = [];            // رول‌های خامِ تطبیق‌داده‌نشده با ستاپ‌ها (نسخهٔ ۳٫۴ — کارت داشبورد)

    /* ظرفیت مؤثر رول خام (۳٫۱۱): تعداد − متالایزِ تخصیص‌یافته — می‌تواند ۰ یا
       منفی باشد؛ منفی یعنی متالایزِ آن رکورد (با اضافه‌تخصیص گام ۶) از تعداد
       بیشتر بوده → این رکورد ظرفیت خامی ندارد (allocateByKey محافظ دارد) */
    const rawCapacityOf = (setup) => {
      const metAlloc = metAllocationBySetup.get(setup.id);
      return setup.rollCount - (metAlloc ? metAlloc.allocated : 0);
    };

    for (const [key, group] of rawGroupIndex) {
      const candidates = rawIndex.get(key) || [];
      if (!candidates.length) continue;   // بدون ستاپ — در وضعیت گروه گزارش می‌شود

      const { allocation, unallocated } = allocateByKey(group.count, candidates, {
        lastTakesAll: true,          // ۳٫۱۱ — مانند متالایز: آخرین رکورد همهٔ باقی‌مانده را می‌گیرد
        capacityOf: rawCapacityOf,   // ۳٫۱۱ — ظرفیت مؤثر = تعداد − متالایزِ تخصیص‌یافته
        rollIds: group.rollIds,
      });
      if (unallocated > 0) {
        rawUnallocatedTotal.total += unallocated;
        rawUnallocatedTotal.keys.push({ key, unallocated });
        // رول‌های هم‌کلید قابل‌تعویضند → سرِ آخرِ گروه به‌عنوان تطبیق‌داده‌نشده (۳٫۴)
        rawUnmatchedRollIds.push(...group.rollIds.slice(-unallocated));
      }

      for (const [setupId, info] of allocation) {
        rawAllocationBySetup.set(setupId, {
          ...info,
          sourceKey: key,
          groupCount: group.count,
        });
      }
    }

    // گروه‌های بدون ستاپ / بدون قانون متراژ → همهٔ رول‌هایشان تطبیق‌داده‌نشده‌اند (۳٫۴)
    for (const group of rawRollGroups) {
      if (!group.hasRule || !group.matched) rawUnmatchedRollIds.push(...group.rollIds);
    }

    /* --- ۸) گزارش هر ستاپ (§46-§50) + ستون‌های مانده زمان (تغییرات جدید) --- */
    const setupReport = setupRolls.map((setup) => {
      const rawAlloc = rawAllocationBySetup.get(setup.id);
      const metAlloc = metAllocationBySetup.get(setup.id);

      const rawExisting = rawAlloc ? rawAlloc.allocated : 0;
      const metallizedAllocated = metAlloc ? metAlloc.allocated : 0;

      // فرمول اصلی (§50 — نهایی در ۳٫۱۱ پس از اتمام Allocation خام و متالایز):
      // Uncut = SetupCount - (RawExisting + Metallized) — می‌تواند منفی شود (§86)
      const uncutCalculated = setup.rollCount - (rawExisting + metallizedAllocated);

      /* --- استخراج مدت زمان از قوانین زمان (دستگاه + متراژ استاندارد) ---
         نسخهٔ ۲٫۷ (اصلاح فرمول‌ها طبق تعریف کاربر):
           مانده زمان ستاپ   = (تعداد − متالایز) × مدت زمان
           مانده زمان موجودی = خام موجود × مدت زمان
         مدت زمان از جدول «تعریف قانون زمان متالایز (هر دستگاه)» بر اساس
         شمارهٔ دستگاه + متراژ استاندارد همان رکورد خوانده می‌شود.
         پایهٔ منفی (متالایز بیش از تعداد) به صفر محدود می‌شود.
         بدون قانون مطابق → هر دو مقدار null (نمایش «—») */
      const timeRule = R.findTimeRule(timeRules, setup.machineNumber, setup.standardLength);
      const durationMin = timeRule ? timeRule.durationMin : null;
      // نسخهٔ ۲٫۷: (تعداد − متالایز) × مدت — پایهٔ مانده زمان ستاپ
      const remainingSetupCount = Math.max(0, setup.rollCount - metallizedAllocated);
      const remainingSetupTime = durationMin !== null ? durationMin * remainingSetupCount : null;
      // نسخهٔ ۲٫۷: خام موجود × مدت — پایهٔ مانده زمان موجودی
      const remainingProducedTime = durationMin !== null ? durationMin * rawExisting : null;
      /* وضعیت ستاپ (نسخهٔ ۳٫۰ — تغییر ۲ کاربر):
         · «تمام شده» فقط وقتی «مانده زمان ستاپ» = ۰ «و» «مانده زمان موجودی» = ۰
         · «باقی مانده» وقتی هر کدام از این دو مثبت (غیرصفر) باشد
         · بدون قانون زمان → null (نامشخص) */
      const timeStatus = (remainingSetupTime === null || remainingProducedTime === null)
        ? null
        : (remainingSetupTime === 0 && remainingProducedTime === 0 ? 'done' : 'remaining');

      /* --- تعداد ست (تغییر ۱) — متراژ استاندارد ÷ کوچکترین استاندارد ضخامت
         مبنای تعداد رول‌های الگوی برش (فرزند) در سراسر سیستم. */
      const setBase = R.setBaseLength(rules, setup.thickness);
      const setCount = R.setCount(rules, setup.thickness, setup.standardLength);

      return {
        ...setup,
        rawExisting,
        metallized: metallizedAllocated,
        uncutCalculated,                                  // مقدار خام (می‌تواند منفی باشد)
        uncut: Math.max(0, uncutCalculated),              // مقدار نمایش (§51)
        conflict: uncutCalculated < 0 ? -uncutCalculated : 0,   // مغایرت ظرفیت
        timeRuleId: timeRule ? timeRule.id : null,
        durationMin,
        remainingSetupTime,
        remainingProducedTime,
        remainingSetupCount,                      // پایهٔ مانده زمان ستاپ = تعداد − متالایز (نسخهٔ ۲٫۷)
        timeStatus,                                // 'done' | 'remaining' | null (نسخهٔ ۳٫۰ — هر دو مانده زمان)
        setBase,                                   // کوچکترین استاندارد ضخامت = رول ۱ ستی (تغییر ۱)
        setCount,                                  // تعداد ست رول مادر (تغییر ۱)
        audit: {
          rawGroup: rawAlloc ? { key: rawAlloc.sourceKey, count: rawAlloc.groupCount } : null,
          metGroup: metAlloc ? { key: metAlloc.sourceKey, count: metAlloc.groupCount } : null,
          rawCapacity: rawAlloc ? rawAlloc.capacity : 0,   // ۳٫۱۱ — ظرفیت مؤثر خام = تعداد − متالایزِ تخصیص‌یافته
          metCapacity: metAlloc ? metAlloc.capacity : 0,
          /* شناسهٔ رول‌های تخصیص‌یافتهٔ واقعی این رکورد (۳٫۸ — Audit دو لیست) */
          rawRollIds: (rawAlloc && Array.isArray(rawAlloc.rollIds)) ? rawAlloc.rollIds : [],
          metRollIds: (metAlloc && Array.isArray(metAlloc.rollIds)) ? metAlloc.rollIds : [],
        },
      };
    });

    /* --- ۸-ب) گزارش رول‌های برش‌خورده (فرزند) — تغییرات جدید --- */
    const cutRolls = buildCutRollsReport(rolls, setupReport);

    /* --- ۹) هشدارهای مرکزی کیفیت داده (§52 + Drill-down) ---
       هر هشدار می‌تواند drill داشته باشد: { source, issue?, filter? }
       تا دقیقاً رکوردهای عامل همان هشدار در یک جدول با ستون‌های Mapping
       نمایش داده شوند (Summary → مشکل → رکوردهای عامل). */
    const warnings = [];

    /* --- ۹-ب) رکوردهای ستاپ بدون قانون زمان (تغییرات جدید) --- */
    if (setupRolls.length && timeRules.length) {
      const noTimeRule = setupReport.filter((r) => r.remainingSetupTime === null);
      if (noTimeRule.length) {
        warnings.push({
          type: 'no-time-rule',
          severity: 'warning',
          title: `${U.faNum(noTimeRule.length)} رکورد ستاپ قانون زمان متالایز ندارد`,
          detail: 'برای ترکیب دستگاه + متراژ استاندارد این رکوردها قانونی در تنظیمات تعریف نشده؛ ستون‌های «مانده زمان» برایشان محاسبه نمی‌شود.',
          action: 'settings',
          drill: { source: 'setups', filter: 'no-time-rule' },
        });
      }
    } else if (setupRolls.length && !timeRules.length) {
      warnings.push({
        type: 'no-time-rules-at-all',
        severity: 'warning',
        title: 'هیچ قانون زمان متالایزی تعریف نشده است',
        detail: 'برای محاسبهٔ «مانده زمان ستاپ/موجودی» در گزارش ستاپ‌ها و داشبورد، برای هر دستگاه قانون زمان تعریف کنید.',
        action: 'settings',
      });
    }

    // الف) بدون قانون متراژ تعریف‌شده
    if (!rules.length) {
      warnings.push({
        type: 'no-rules',
        severity: 'error',
        title: 'هیچ قانون متراژ استانداردی تعریف نشده است',
        detail: 'بدون تعریف قوانین در تنظیمات، هیچ رولی استانداردسازی و با ستاپ‌ها تطبیق نمی‌شود.',
        action: 'settings',
      });
    }

    // ب) رول‌های خام بدون قانون پوشش‌دهنده (§17)
    if (noRuleCount > 0 && rules.length) {
      warnings.push({
        type: 'no-rule-coverage',
        severity: 'warning',
        title: `${U.faNum(noRuleCount)} رول خام قانون متراژی ندارد`,
        detail: 'متراژ واقعی این رول‌ها در بازهٔ هیچ قانونی برای ضخامتشان قرار نمی‌گیرد؛ با ستاپ‌ها تطبیق نمی‌شوند.',
        action: 'settings',
        drill: { source: 'rolls', filter: 'no-rule' },
      });
    }

    // ج) گروه‌های خام بدون ستاپ (§52)
    const unmatchedGroups = rawRollGroups.filter((g) => g.hasRule && !g.matched);
    if (unmatchedGroups.length) {
      warnings.push({
        type: 'no-setup',
        severity: 'warning',
        title: `${U.faNum(unmatchedGroups.length)} گروه رول خام بدون ستاپ`,
        detail: 'ترکیب عرض/متراژ استاندارد/ستاپ این گروه‌ها در هیچ ستاپی تعریف نشده است.',
        action: 'rolls',
        drill: { source: 'rolls', filter: 'group', groupKeys: unmatchedGroups.map((g) => g.key) },
      });
    }

    // د) مازاد متالایز تخصیص‌نیافته (§44)
    //    نسخهٔ ۳٫۷ — تغییر ۲: با تخصیص «همهٔ باقی‌مانده به آخرین رکورد هم‌کلید»،
    //    برای کلیدهای دارای ستاپ دیگر مازاد تخصیص‌نیافته‌ای وجود ندارد (مسیر
    //    دفاعی) — مازاد واقعی اکنون به‌صورت «مغایرت ظرفیت» (بند و) گزارش می‌شود.
    if (metUnallocatedTotal.total > 0) {
      warnings.push({
        type: 'metallized-surplus',
        severity: 'warning',
        title: `${U.faNum(metUnallocatedTotal.total)} رول متالایز تخصیص‌نیافته`,
        detail: 'تعداد متالایزهای یونیک بیش از مجموع ظرفیت ستاپ‌های دارای کلید مشابه است.',
        action: 'setup',
        drill: {
          source: 'archived',
          filter: 'metallized-unallocated',
          groupKeys: metUnallocatedTotal.keys.map((k) => k.key),
        },
      });
    }

    // د-ب) رول‌های متالایز با عرض تعریف‌نشده در ستاپ (نسخهٔ ۳٫۷ — تغییر ۳)
    //    رول متالایزی (رکوردهای آرشیو با R/r، یکتاشده با شمارهٔ رول) که کلید
    //    ۵فاکتوری‌اش «متراژ استاندارد + شماره ستاپ + خط تولید + شماره سالن +
    //    عدد سال» با رکوردی از ستاپ‌های کامل مطابقت دارد ولی کلید کامل
    //    ۶فاکتوری (با عرض) با هیچ رکوردی مطابقت ندارد → احتمالاً رول به یکی
    //    از ستاپ‌های تعریف‌شده تعلق دارد ولی عرض آن در آن ستاپ تعریف نشده
    //    است. هشدار مهم (قرمز) + Drill-down رکوردهای عامل (مانند سایر هشدارها).
    const metWidthMismatch = [];
    for (const rec of metallized.uniqueRecords) {
      const rn = String(rec.rollNumber ?? '');
      const sixKey = metallized.keyByRollNumber[rn];
      if (sixKey !== undefined && metIndex.has(sixKey)) continue;   // کلید کامل منطبق → تخصیص می‌خورد
      if (metFiveKeys.has(metallized.fiveKeyByRollNumber[rn])) metWidthMismatch.push(rec);
    }
    if (metWidthMismatch.length) {
      // ستاپ‌های درگیر (برای مرور سریع بدون باز کردن Drill)
      const setupsInvolved = [...new Set(
        metWidthMismatch.map((r) => r.setupNumber).filter((s) => s !== null && s !== undefined)
      )];
      const setupsTxt = setupsInvolved.slice(0, 8).map((s) => U.faNum(s)).join('، ') +
        (setupsInvolved.length > 8 ? ' و…' : '');
      warnings.push({
        type: 'metallized-width-mismatch',
        severity: 'error',
        title: `${U.faNum(metWidthMismatch.length)} رول متالایز با عرض تعریف‌نشده در ستاپ`,
        detail: `کلید «متراژ استاندارد + شماره ستاپ + خط تولید + شماره سالن + عدد سال» این رول‌ها با رکوردهای ستاپ مطابقت دارد${setupsTxt ? ` (ستاپ‌های درگیر: ${setupsTxt})` : ''} ولی کلید کاملِ شامل «عرض» با هیچ رکوردی از ستاپ‌ها مطابقت ندارد — احتمالاً این رول‌ها به ستاپ‌های تعریف‌شده تعلق دارند ولی عرض آنها در آن ستاپ‌ها تعریف نشده است. با «مشاهدهٔ رکوردها» ستون عرض این رول‌ها را بررسی کنید.`,
        action: 'setup',
        drill: { source: 'archived', filter: 'metallized-width-mismatch', ids: metWidthMismatch.map((r) => r.id) },
      });
    }

    // هـ) رول‌های خام تخصیص‌نیافته (به دلیل ظرفیت)
    //    نسخهٔ ۳٫۱۱: با تخصیص «همهٔ باقی‌مانده به آخرین رکورد هم‌کلید» برای خام
    //    نیز، برای کلیدهای دارای ستاپ دیگر مازاد تخصیص‌نیافته‌ای وجود ندارد
    //    (مسیر دفاعی) — مازاد واقعی اکنون به‌صورت «مغایرت ظرفیت» (بند و) گزارش می‌شود.
    if (rawUnallocatedTotal.total > 0) {
      warnings.push({
        type: 'raw-surplus',
        severity: 'warning',
        title: `${U.faNum(rawUnallocatedTotal.total)} رول خام تخصیص‌نیافته`,
        detail: 'ظرفیت ستاپ‌های منطبق برای پوشش تمام رول‌های خام کافی نیست.',
        action: 'setup',
        drill: {
          source: 'rolls',
          filter: 'group',
          groupKeys: rawUnallocatedTotal.keys.map((k) => k.key),
        },
      });
    }

    // و) مغایرت ظرفیت در گزارش ستاپ (§86)
    const conflicts = setupReport.filter((r) => r.conflict > 0);
    if (conflicts.length) {
      warnings.push({
        type: 'capacity-conflict',
        severity: 'error',
        title: `${U.faNum(conflicts.length)} ستاپ با مغایرت ظرفیت`,
        detail: 'مجموع خام موجود + متالایزِ تخصیص‌یافته از تعداد رول ستاپ بیشتر است (در ستون برش‌نشده ستاره‌دار نمایش داده می‌شود).',
        action: 'setup',
        drill: { source: 'setups', filter: 'capacity-conflict' },
      });
    }

    // ز) ستاپ‌های ناقص قدیمی (پس از مهاجرت) — شامل هویت ناقص (نسخهٔ ۲٫۹)
    const incomplete = setupRolls.filter(
      (s) => s.thickness === null || s.standardLength === null || !N.setupIdentityComplete(s)
    );
    if (incomplete.length) {
      warnings.push({
        type: 'incomplete-setup',
        severity: 'warning',
        title: `${U.faNum(incomplete.length)} رکورد ستاپ ناقص`,
        detail: 'رکوردهایی که ضخامت/متراژ استاندارد یا هویت (خط تولید/شماره سالن/تاریخ ستاپ) ندارند؛ برای شرکت در محاسبات ویرایش و تکمیل شوند.',
        action: 'setup',
        drill: { source: 'setups', filter: 'incomplete' },
      });
    }

    // ح) هم‌پوشانی قوانین (دفاع مرکزی — در ذخیره مسدود است §18)
    const overlapPairs = [];
    const rulesByThickness = new Map();
    for (const rule of rules) {
      if (!rulesByThickness.has(rule.thickness)) rulesByThickness.set(rule.thickness, []);
      rulesByThickness.get(rule.thickness).push(rule);
    }
    for (const list of rulesByThickness.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (R.findOverlap(list[i], [list[j]])) overlapPairs.push([list[i], list[j]]);
        }
      }
    }
    if (overlapPairs.length) {
      warnings.push({
        type: 'rule-overlap',
        severity: 'error',
        title: `${U.faNum(overlapPairs.length)} جفت قانون هم‌پوشان شناسایی شد`,
        detail: 'قوانین هم‌پوشان نباید ذخیره شوند؛ لطفاً بازبینی و اصلاح کنید.',
        action: 'settings',
        drill: { source: 'rules', filter: 'overlap', pairs: overlapPairs },
      });
    }

    // ط) داده‌های ناقص اکسل — به تفکیک Dataset و نوع نقص (هر کدام Drill-down مستقل)
    const DATASET_LABELS = RM.config.DATASET_LABELS;
    const ISSUE_META = [
      { issue: 'width',      label: 'بدون عرض' },
      { issue: 'length',     label: 'بدون متراژ' },
      { issue: 'thickness',  label: 'بدون ضخامت' },
      { issue: 'rollNumber', label: 'شماره رول نامعتبر (خالی)' },
      { issue: 'filmType',   label: 'نوع فیلم نامعتبر (خالی)' },
    ];
    const datasets = [
      { source: 'rolls', records: rolls },
      { source: 'archived', records: archivedRolls },
    ];
    for (const { source, records: dsRecords } of datasets) {
      for (const meta of ISSUE_META) {
        // رزولور مشترک نقص‌ها («length» → actualLength در مدل داخلی)
        const count = N.recordsWithIssue(dsRecords, meta.issue).length;
        if (count > 0) {
          warnings.push({
            type: `missing-${meta.issue}-${source}`,
            severity: 'warning',
            title: `${meta.label} (${DATASET_LABELS[source]}): ${U.faNum(count)}`,
            detail: 'رکوردهای عامل این هشدار قابل مشاهده‌اند — دکمهٔ «مشاهده» را بزنید.',
            action: 'import',
            drill: { source, issue: meta.issue },
          });
        }
      }
    }

    // ی) Mapping ناقص — فیلدهایی که کاربر تنظیم کرده اما ستونشان در فایل نبوده
    for (const meta of (importMetadata || [])) {
      const gaps = (meta && Array.isArray(meta.mappingGaps)) ? meta.mappingGaps : [];
      if (!gaps.length) continue;
      const fieldNames = gaps.map((g) => RM.config.FIELD_LABELS[g.field] || g.field).join('، ');
      warnings.push({
        type: `mapping-incomplete-${meta.target}`,
        severity: 'warning',
        title: `Mapping ناقص (${DATASET_LABELS[meta.target] || meta.target})`,
        detail: `ستون تنظیم‌شده برای فیلدهای ${fieldNames} در فایل «${U.truncate(meta.fileName || '', 30)}» یافت نشد؛ این فیلدها برای رکوردها مقدار ندارند.`,
        action: 'settings',
        drill: { source: meta.target, filter: 'all' },
      });
    }

    /* --- ی-ب) رول‌های متالایزشدهٔ برش‌نشده از مهلت گذشته (۳٫۵ — تغییر ۹ · تفکیک در ۳٫۶ — تغییر ۲) ---
       رول‌هایی از «رول‌های موجود» که شمارهٔ رولشان M دارد ولی بازوی برش
       (R/L بعد از M) ندارند (متالایز شده ولی هنوز برش نخورده) و از «تاریخ
       تولید» (= زمان متالایز — فیلد Mapping «تاریخ تولید» رول‌های موجود)
       بیش از مهلت مجاز (ساعت — تنظیمات، کنار کادر تم) گذشته است.
       نسخهٔ ۳٫۶ — تغییر ۲: رول‌های شناسایی‌شده به دو گروه تفکیک می‌شوند —
       متراژ استاندارد هر رول طبق قوانین «تعریف قانون متراژ استاندارد جدید»
       (ضخامت + بازهٔ متراژ واقعی) تعیین می‌شود:
         ۱) دارای متراژ استاندارد → هشدار قرمز «رول متالایز با مهلت برش گذشته»
         ۲) بدون متراژ استاندارد  → هشدار عادی «رول متالایز شده برش نشده متراژ پایین»
       برای کم‌شدن محاسبات، اختلاف زمان فقط برای همین زیرمجموعهٔ کوچک
       محاسبه می‌شود — نه همهٔ رول‌ها. تنظیم خالی = کنترل غیرفعال. */
    const allowedCutHoursRaw = await DB.getSetting('allowedProductionToCutHours', 24);
    const allowedCutHours = (allowedCutHoursRaw === null || allowedCutHoursRaw === undefined ||
      allowedCutHoursRaw === '' || !Number.isFinite(Number(allowedCutHoursRaw)))
      ? null
      : Number(allowedCutHoursRaw);

    if (allowedCutHours !== null && allowedCutHours > 0) {
      // فقط رول‌های متالایزشدهٔ برش‌نشده: M در شمارهٔ رول بدون بازوی R/L بعد از M
      const metNotCut = rolls.filter((r) => {
        const rn = String(r.rollNumber ?? '');
        return /M\d/.test(rn) && !N.isCutRoll(r);
      });

      const overdueWithStd = [];      // ازمهلت‌گذشتهٔ دارای متراژ استاندارد (قانون منطبق)
      const overdueLowMetrage = [];   // ازمهلت‌گذشتهٔ بدون متراژ استاندارد (متراژ پایین)
      for (const r of metNotCut) {
        const ts = U.jalaliDateTimeToTimestamp(r.productionDate);
        if (ts === null) continue;   // تاریخ تولید نامعتبر/ناقص → قابل‌ارزیابی نیست
        const hoursAgo = (Date.now() - ts) / 3600000;
        if (hoursAgo <= allowedCutHours) continue;
        // متراژ استاندارد طبق قوانین «تعریف قانون متراژ استاندارد جدید» (ضخامت + بازهٔ متراژ واقعی)
        const stdLen = R.resolveStandardLength(rules, r.thickness, r.actualLength);
        (stdLen === null ? overdueLowMetrage : overdueWithStd).push(r);
      }

      /* — گروه ۱: دارای متراژ استاندارد — هشدار قرمز (خطا) — */
      if (overdueWithStd.length) {
        const maxHours = Math.max(...overdueWithStd.map((r) =>
          Math.max(0, (Date.now() - U.jalaliDateTimeToTimestamp(r.productionDate)) / 3600000)));
        warnings.push({
          type: 'metallized-uncut-overdue',
          severity: 'error',
          title: `${U.faNum(overdueWithStd.length)} رول متالایز با مهلت برش گذشته`,
          detail: `شمارهٔ رول این‌ها M دارد ولی بازوی برش (R/L) ندارد و از «تاریخ تولید» (زمان متالایز) بیش از ${U.faNum(allowedCutHours)} ساعت (مجاز تنظیم‌شده) گذشته است — قدیمی‌ترین: ${U.faNum(Math.round(maxHours))} ساعت. این رول‌ها متراژ استاندارد دارند (با قوانین «متراژ استاندارد» تطبیق شدند) و برای برش در اولویت‌اند. مهلت مجاز از تنظیمات (کنار کادر تم) قابل تغییر است.`,
          action: 'rolls',
          drill: { source: 'rolls', filter: 'metallized-uncut-overdue', ids: overdueWithStd.map((r) => r.id) },
        });
      }

      /* — گروه ۲: بدون متراژ استاندارد — هشدار عادی (کهربایی) — */
      if (overdueLowMetrage.length) {
        const maxHours = Math.max(...overdueLowMetrage.map((r) =>
          Math.max(0, (Date.now() - U.jalaliDateTimeToTimestamp(r.productionDate)) / 3600000)));
        warnings.push({
          type: 'metallized-uncut-lowmetrage',
          severity: 'warning',
          title: `${U.faNum(overdueLowMetrage.length)} رول متالایز شده برش نشده متراژ پایین`,
          detail: `این رول‌ها M دارند ولی بازوی برش (R/L) ندارند، از «تاریخ تولید» بیش از ${U.faNum(allowedCutHours)} ساعت گذشته (قدیمی‌ترین: ${U.faNum(Math.round(maxHours))} ساعت) و با هیچ قانون «تعریف قانون متراژ استاندارد جدید» (ضخامت + بازهٔ متراژ واقعی) تطبیق نشدند — متراژ پایین/خارج از بازهٔ قوانین. مهلت مجاز از تنظیمات (کنار کادر تم) قابل تغییر است.`,
          action: 'rolls',
          drill: { source: 'rolls', filter: 'metallized-uncut-overdue', ids: overdueLowMetrage.map((r) => r.id) },
        });
      }
    }

    /* --- ۱۰) خلاصهٔ داشبورد (§57-§59 + زمان‌های متالایز — تغییرات جدید) --- */
    const totalSetupRolls = setupRolls.reduce((s, r) => s + (r.rollCount || 0), 0);
    const totalRawAllocated = [...rawAllocationBySetup.values()].reduce((s, a) => s + a.allocated, 0);
    const totalMetAllocated = [...metAllocationBySetup.values()].reduce((s, a) => s + a.allocated, 0);
    const totalUncut = setupReport.reduce((s, r) => s + r.uncut, 0);
    const totalConflict = setupReport.reduce((s, r) => s + r.conflict, 0);

    /* --- مانده زمان‌ها: کل + به تفکیک دستگاه (فقط رکوردهای دارای قانون) --- */
    const totalRemainingSetupTime = setupReport.reduce(
      (s, r) => s + (r.remainingSetupTime || 0), 0
    );
    const totalRemainingProducedTime = setupReport.reduce(
      (s, r) => s + (r.remainingProducedTime || 0), 0
    );
    const machineTime = {};
    let timeCovered = 0;
    let timeUncovered = 0;
    for (const r of setupReport) {
      if (r.remainingSetupTime === null) {
        if (r.thickness !== null && r.standardLength !== null) timeUncovered++;
        continue;
      }
      timeCovered++;
      const m = r.machineNumber;
      if (!machineTime[m]) machineTime[m] = { setup: 0, produced: 0, records: 0 };
      machineTime[m].setup += r.remainingSetupTime;
      machineTime[m].produced += r.remainingProducedTime || 0;
      machineTime[m].records++;
    }

    const summary = {
      rawRollsCount: rawRolls.length,           // کل رول‌های خام فعلی (§58)
      rawMatchedCount: totalRawAllocated,       // خامِ تطبیق‌شده با ستاپ‌ها
      /* --- آمارهای کاربردی کارت «رول‌های خام» (نسخهٔ ۳٫۴) --- */
      rawGradeTCount: rawRolls.filter((r) => N.gradeLetter(r) === 'T').length,
      rawUnmatchedCount: rawUnmatchedRollIds.length,   // = خام − تطبیق‌شده
      metallizedCount: metallized.uniqueCount, // متالایز یونیک (§59)
      metallizedAllocated: totalMetAllocated,
      totalSetupRolls,                          // Σ تعداد ستاپ‌ها (§57)
      totalUncut,                               // Σ برش‌نشده نمایشی (§51)
      totalConflict,                            // Σ مغایرت ظرفیت (§86)
      rawUnallocated: rawUnallocatedTotal.total,
      metallizedUnallocated: metUnallocatedTotal.total,
      totalGroups: rawRollGroups.length,
      matchedGroups: rawRollGroups.length - unmatchedGroups.length,
      /* --- زمان متالایز (تغییرات جدید) --- */
      totalRemainingSetupTime,
      totalRemainingProducedTime,
      machineTime,
      timeRuleCoverage: { covered: timeCovered, uncovered: timeUncovered },
      timeRulesCount: timeRules.length,
      /* --- رول‌های برش‌خورده (تغییرات جدید) --- */
      cutRollsCount: cutRolls.stats.totalRecords,
      cutRollsFound: cutRolls.stats.cutRollsFound,
    };

    return {
      rawRollGroups,
      unmatchedGroups,
      metallizedGroups: metallized.groups,
      metallizedUniqueCount: metallized.uniqueCount,
      metallizedUniqueRecords: metallized.uniqueRecords,   // برای Drill-down مازاد متالایز
      metallizedKeyByRollNumber: metallized.keyByRollNumber,   // نسخهٔ ۳٫۱ — تغییر ۳: Drill بدون بازسازی کلید
      setupReport,
      cutRolls,
      warnings,
      summary,
      meta: {
        rawUnallocatedKeys: rawUnallocatedTotal.keys,
        rawUnmatchedRollIds,                    // نسخهٔ ۳٫۴ — Drill کارت داشبورد
        metUnallocatedKeys: metUnallocatedTotal.keys,
        noRuleCount,
        timeRules,
      },
    };
  }

  /* ================================================================
     ۵) مدیریت Cache (§55 — محاسبهٔ مجدد فقط در تغییر داده)
     ================================================================ */

  /** اعلام کثیف‌بودن Cache — پس از هر تغییر داده فراخوانی می‌شود */
  Calc.invalidate = function () {
    Calc._dirty = true;
  };

  /** دریافت وضعیت محاسبه‌شده (با Cache) */
  Calc.getState = async function () {
    if (Calc._dirty || !Calc._cached) {
      Calc._cached = await calculateProductionState();
      Calc._dirty = false;
    }
    return Calc._cached;
  };

  RM.calcEngine = Calc;
})();
