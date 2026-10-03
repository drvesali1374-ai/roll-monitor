/* =========================================================================
   quality.js — موتور کنترل‌های کیفیت دادهٔ رول‌ها (نسخهٔ ۲٫۷ → ۲٫۹)
   -------------------------------------------------------------------------
   سه کنترل روی رکوردهای نرمال‌شدهٔ هر منبع (رول‌های موجود / آرشیو):

     کنترل ۱ — یکسانی ضخامت در کلید هویت ستاپ (نسخهٔ ۲٫۹ — اصلاح کاربر):
       هویت هر ستاپ = شماره ستاپ + خط تولید + شماره سالن + عدد سال
       (نه فقط شماره ستاپ!) زیرا ممکن است دو ستاپ ۱۳۰ با خط/سال/سالن
       متفاوت تفاوت‌های اساسی داشته باشند و نباید یکی تلقی شوند.
       هویت از شمارهٔ رول خوانده می‌شود:
         · حرف آغازین: F → خط BOPP · K → خط CPP
         · رقم اول بعد از F/K = شمارهٔ سالن  (K1400… → سالن ۱ · F2500… → سالن ۲)
         · رقم دوم بعد از F/K = سال ۱۴۰X     (K14… → ۱۴۰۴ · F25… → ۱۴۰۵)
       مبنا = ضخامتی که در همان کلید بیشترین تعداد را دارد؛ رول‌های منحرف
       به‌عنوان هشدار با جزئیات گزارش می‌شوند. اگر تساوی باشد (مثلاً ضخامت
       ۲۰ و ۳۰ هر کدام ۵ رول)، همهٔ رول‌های همان کلید هشدارند.

     کنترل ۲ — تطبیق M با نوع فیلم (نسخهٔ ۲٫۹ — اصلاح کاربر، دوطرفه):
       شمارهٔ رول دارای M → نوع فیلم باید M داشته باشد؛
       شمارهٔ رول بدون M → نوع فیلم نباید M داشته باشد.
       (بررسی R حذف شد — فقط M معیار است.)

     کنترل ۳ — بازوی برش بعد از M:
       در شمارهٔ رول‌های دارای M، بعد از M حداکثر یک بازوی برش (R یا L)
       مجاز است؛ بیشتر از یکی خطاست.
         K1400110101L4M121R2        → بعد از M فقط R2 ✓
         K2502610071R2M2111R211R2   → بعد از M دو بازو (R…R) ✕

   خروجی runControls(records) برای رندر مستقیم در نماها است؛
   رکوردهای بدون شمارهٔ ستاپ / بدون شمارهٔ رول در کنترل‌های وابسته
       بررسی نمی‌شوند (نقص‌شان در گزارشنمای Import جدا گزارش می‌شود).
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;

  const Quality = {};

  /**
   * هویت کامل رول از شمارهٔ رول (نسخهٔ ۲٫۹): خط تولید + سالن + سال.
   * پیاده‌سازی مرکزی در normalize.js است (همان منبع هم برای کلیدهای
   * تطبیق calc.js استفاده می‌شود) — اینجا فقط alias برای سازگاری نماها.
   */
  Quality.parseRollIdentity = function (rollNumber) {
    return RM.normalize.parseRollIdentity(rollNumber);
  };

  /**
   * اجرای هر سه کنترل روی رکوردهای نرمال‌شدهٔ یک منبع.
   * @param {Array} records  رکوردهای مدل داخلی (ایندکس‌دار؛ ویرایش‌ها اعمال‌شده)
   * @returns {{
   *   thickness: { warnings: Array, groups: number },
   *   filmMatch:  Array,
   *   arms:       Array,
   *   counts:     { thickness: number, filmMatch: number, arms: number }
   * }}
   *  thickness.warnings[i] = { record, setupNumber, line, hall, year, kind:'tie'|'deviant',
   *                            base?, countsTxt }
   *  filmMatch[i]  = { record, setupNumber, line, hall, year, issues:['M'] }
   *  arms[i]       = { record, setupNumber, line, hall, year, count, after }
   */
  Quality.runControls = function (records) {
    const recs = Array.isArray(records) ? records : [];
    const thickness = { warnings: [], groups: 0 };
    const filmMatch = [];
    const arms = [];

    /* ---------- کنترل ۱: ضخامت به تفکیک کلید هویت (ستاپ + خط + سالن + سال — نسخهٔ ۲٫۹) ---------- */
    const bySetup = new Map();
    for (const r of recs) {
      if (r.setupNumber === null || r.setupNumber === undefined) continue;   // بدون ستاپ → خارج از این کنترل
      const id = Quality.parseRollIdentity(r.rollNumber);
      const key = `${r.setupNumber}|${id.line ?? '?'}|${id.hall ?? '?'}|${id.year ?? '?'}`;
      if (!bySetup.has(key)) {
        bySetup.set(key, {
          setupNumber: r.setupNumber, line: id.line, hall: id.hall, year: id.year, rolls: [],
        });
      }
      bySetup.get(key).rolls.push(r);
    }

    for (const g of bySetup.values()) {
      // فقط رول‌های «دارای ضخامت» در تعیین مبنا مشارکت دارند (بدون ضخامت در
      // گزارشنمای Import جدا گزارش می‌شود)
      const withT = g.rolls.filter((r) => r.thickness !== null && r.thickness !== undefined);
      if (withT.length < 1) continue;

      const counts = new Map();
      for (const r of withT) counts.set(r.thickness, (counts.get(r.thickness) || 0) + 1);
      if (counts.size < 2) continue;   // تک‌ضخامتی (یا تک‌رول) → بدون هشدار

      thickness.groups++;
      const max = Math.max(...counts.values());
      const winners = [...counts.entries()].filter(([, c]) => c === max);
      const countsTxt = [...counts.entries()]
        .map(([t, c]) => `${U.faNumPlain(t)}×${U.faNumPlain(c)}`)
        .sort()
        .join('، ');

      if (winners.length > 1) {
        // تساوی → همهٔ رول‌های دارای ضخامتِ همین کلید هشدارند
        for (const r of withT) {
          thickness.warnings.push({
            record: r, setupNumber: g.setupNumber, line: g.line, hall: g.hall, year: g.year,
            kind: 'tie', countsTxt,
          });
        }
      } else {
        const base = winners[0][0];
        for (const r of withT) {
          if (r.thickness !== base) {
            thickness.warnings.push({
              record: r, setupNumber: g.setupNumber, line: g.line, hall: g.hall, year: g.year,
              kind: 'deviant', base, baseCount: max, countsTxt,
            });
          }
        }
      }
    }

    /* ---------- کنترل ۲: تطبیق M شمارهٔ رول با نوع فیلم (نسخهٔ ۲٫۹ — دوطرفه) ----------
       شمارهٔ رول دارای M → نوع فیلم باید M داشته باشد؛
       شمارهٔ رول بدون M → نوع فیلم نباید M داشته باشد. (R حذف شد.) */
    for (const r of recs) {
      const roll = String(r.rollNumber ?? '').trim();
      if (!roll) continue;   // بدون شمارهٔ رول → گزارشنمای Import
      const rollU = roll.toUpperCase();
      const filmU = String(r.filmType ?? '').trim().toUpperCase();

      const issues = [];
      if (rollU.includes('M') && !filmU.includes('M')) issues.push('M');
      if (!rollU.includes('M') && filmU.includes('M')) issues.push('M!');   // M در نوع فیلم ولی نه در شمارهٔ رول
      if (issues.length) {
        const id = Quality.parseRollIdentity(r.rollNumber);
        filmMatch.push({ record: r, setupNumber: r.setupNumber ?? null, line: id.line, hall: id.hall, year: id.year, issues });
      }
    }

    /* ---------- کنترل ۳: حداکثر یک بازوی برش (R/L) بعد از M ---------- */
    for (const r of recs) {
      const roll = String(r.rollNumber ?? '').trim().toUpperCase();
      const mIdx = roll.indexOf('M');
      if (mIdx === -1) continue;   // بدون M → این کنترل تعریف نمی‌شود
      const after = roll.slice(mIdx + 1);
      const count = (after.match(/[LR]/g) || []).length;
      if (count > 1) {
        const id = Quality.parseRollIdentity(r.rollNumber);
        arms.push({ record: r, setupNumber: r.setupNumber ?? null, line: id.line, hall: id.hall, year: id.year, count, after });
      }
    }

    return {
      thickness,
      filmMatch,
      arms,
      counts: {
        thickness: thickness.warnings.length,
        filmMatch: filmMatch.length,
        arms: arms.length,
      },
    };
  };

  /** شرح فارسی هر مشکل (برای ستون «شرح» جداول کیفیت) */
  Quality.describeIssue = function (item, control) {
    if (control === 'thickness') {
      return item.kind === 'tie'
        ? `تساوی ضخامت‌ها در این کلید هویت (${item.countsTxt}) — مبنا قابل تعیین نیست؛ همهٔ رول‌های همین کلید هشدارند`
        : `ضخامت ${U.faNumPlain(item.record.thickness)} ≠ مبنا ${U.faNumPlain(item.base)} (مبنا = پرتکرارِ همین کلید ستاپ+خط+سالن+سال: ${item.countsTxt})`;
    }
    if (control === 'filmMatch') {
      const parts = item.issues.map((L) =>
        L === 'M'
          ? 'حرف M در شمارهٔ رول هست اما در نوع فیلم نیست'
          : 'حرف M در شمارهٔ رول نیست اما در نوع فیلم هست');
      return parts.join(' · ');
    }
    if (control === 'arms') {
      return `${U.faNumPlain(item.count)} بازوی برش (R/L) بعد از M — حداکثر ۱ بازو مجاز است (${item.after})`;
    }
    return '';
  };

  RM.quality = Quality;
})();
