/* =========================================================================
   planning.js — موتور برنامه‌ریزی زمان‌بندی دستگاه‌های متالایز (نسخهٔ ۳٫۳)
   -------------------------------------------------------------------------
   مدل داده (ذخیره در appSettings با کلید 'planningBoard' — به‌صورت خودکار
   در Backup/Restore و «پاک‌سازی کامل برنامه» پوشش داده می‌شود):

     {
       version: 1,
       machines: {
         "1": {
           startTime: "07:00",        // ساعت شروع چارت (HH:mm لاتین)
           dateMode:  "auto",         // auto = همیشه تاریخ امروز | fixed = تاریخ ثابت
           fixedDate: null,           // "YYYY/MM/DD" شمسی نرمال‌شده (وقتی fixed)
           showNow:   true,           // نمایش خط قرمز «اکنون» در گانت (نسخهٔ ۳٫۳)
           items: [                   // لیست اولویت‌دار (ترتیب آرایه = ترتیب اجرا)
             { id, type: "roll", setupId, quantity,
               linkedRaw: false },    // لینک تعداد با «خام موجود» (نسخهٔ ۳٫۴)
             { id, type: "lag",  title, minutes },      // لگ/توقف/تاخیر
           ]
         },
         "2": {...}, "3": {...}
       }
     }

   قواعد محاسبه:
     - منبع رول‌ها: جدول «گزارش تولید ستاپ‌ها» (موتور محاسبه) — همهٔ رکوردهای
       وضعیت «باقی مانده» قابل انتخاب‌اند، فارغ از دستگاهِ تخصیص‌داده‌شده
       (نسخهٔ ۳٫۳ — قبلاً فقط همان دستگاه).
     - زمان هر رول = تعداد × مدت زمان متالایز هر رول (قانون زمان دستگاهِ
       رکورد + متراژ استاندارد) — پیش‌فرض تعداد = ستون «خام موجود».
     - زمان هر لگ = دقیقهٔ مثبتِ تعیین‌شده توسط کاربر.
     - زمان‌بندی زنجیره‌ای: هر قلم بلافاصله پس از پایان قلم قبلی شروع می‌شود.
     - زمان‌های روزهای بعد با تاریخ شمسی جلالی دقیق همان روز نمایش داده
       می‌شوند (نسخهٔ ۳٫۳ — بجای نشان «+n روز»).
     - اقلام نامعتبر (رکورد حذف‌شده / تعداد < ۱ / قانون زمان حذف‌شده / لگ با
       زمان نامثبت) از زنجیرهٔ زمان‌بندی کنار گذاشته می‌شوند و در UI علامت‌گذاری
       می‌شوند (قرمز + دلیل).
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;

  const Planning = {};

  Planning.SETTING_KEY = 'planningBoard';
  Planning.ACTIVE_KEY = 'planningActiveMachine';
  Planning.DEFAULT_START = '07:00';           // ۷ صبح — پیش‌فرض ساعت شروع چارت
  Planning.MACHINES = [1, 2, 3];              // دستگاه‌های متالایز (§21)

  /* ================================================================
     ۱) ساختار خالی + پاک‌سازی/نرمال‌سازی Board
     ================================================================ */

  Planning.emptyMachine = function () {
    return { startTime: Planning.DEFAULT_START, dateMode: 'auto', fixedDate: null, showNow: true, items: [] };
  };

  Planning.emptyBoard = function () {
    const machines = {};
    for (const m of Planning.MACHINES) machines[String(m)] = Planning.emptyMachine();
    return { version: 1, machines };
  };

  /**
   * نرمال‌سازی Board ذخیره‌شده — مقاوم در برابر فایل‌های ناقص/قدیمی:
   * هر ماشین با ساختار پیش‌فرض ادغام می‌شود و اقلام ناشناخته حذف می‌شوند.
   */
  Planning.sanitizeBoard = function (raw) {
    const board = Planning.emptyBoard();
    if (!raw || typeof raw !== 'object' || !raw.machines || typeof raw.machines !== 'object') {
      return board;
    }

    for (const m of Planning.MACHINES) {
      const src = raw.machines[String(m)];
      if (!src || typeof src !== 'object') continue;

      const machine = board.machines[String(m)];

      // ساعت شروع — فقط مقدار معتبر HH:mm
      const start = Planning.parseClock(src.startTime);
      machine.startTime = start !== null ? Planning.formatClock(start) : Planning.DEFAULT_START;

      // تاریخ — auto معتبر؛ fixed فقط با تاریخ شمسی نرمال‌شده
      if (src.dateMode === 'fixed') {
        const parsed = U.parseJalaliDate(src.fixedDate);
        if (parsed) {
          machine.dateMode = 'fixed';
          machine.fixedDate = parsed.normalized;
        }
      }

      // نمایش خط «اکنون» در گانت (نسخهٔ ۳٫۳) — پیش‌فرض روشن
      machine.showNow = src.showNow !== false;

      // اقلام — فقط ساختارهای شناخته‌شده
      if (Array.isArray(src.items)) {
        const items = [];
        for (const it of src.items) {
          if (!it || typeof it !== 'object') continue;
          if (it.type === 'roll' && Number.isFinite(Number(it.setupId))) {
            const quantity = U.parseInt(it.quantity);
            items.push({
              id: String(it.id || Planning.makeItemId()),
              type: 'roll',
              setupId: Number(it.setupId),
              quantity: quantity === null ? 1 : quantity,
              // لینک تعداد با «خام موجود» (نسخهٔ ۳٫۴) — فقط پرچم؛ مقدار زنده از رکورد خوانده می‌شود
              linkedRaw: it.linkedRaw === true,
            });
          } else if (it.type === 'lag') {
            const minutes = U.parseNumber(it.minutes);
            items.push({
              id: String(it.id || Planning.makeItemId()),
              type: 'lag',
              title: String(it.title || '').trim(),
              minutes: minutes !== null && minutes > 0 ? minutes : 0,
            });
          }
        }
        machine.items = items;
      }
    }

    return board;
  };

  /** شناسهٔ یکتای قلم (برای کلیدهای DOM و جابجایی) */
  let _idSeq = 0;
  Planning.makeItemId = function () {
    _idSeq += 1;
    return `it-${Date.now().toString(36)}-${_idSeq.toString(36)}`;
  };

  /* ---------------- خواندن / ذخیره ---------------- */

  Planning.load = async function () {
    const raw = await RM.db.getSetting(Planning.SETTING_KEY, null);
    return Planning.sanitizeBoard(raw);
  };

  Planning.save = async function (board) {
    await RM.db.setSetting(Planning.SETTING_KEY, board);
  };

  /* ================================================================
     ۲) ابزارهای زمان (ساعت / تاریخ)
     ================================================================ */

  /**
   * تجزیهٔ ساعت «HH:mm» از ورودی کاربر (ارقام فارسی/عربی خودکار تبدیل
   * می‌شوند). خروجی: دقیقهٔ از نیمه‌شب یا null.
   * مثال: "07:00" → 420 · "7:5" → 425 · "۲۳:۴۵" → 1425
   */
  Planning.parseClock = function (value) {
    if (value === null || value === undefined) return null;
    const s = U.toLatinDigits(String(value)).trim().replace(/[.\-]/g, ':');
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return h * 60 + mi;
  };

  /** قالب لاتین HH:mm (ذخیره‌سازی) — 420 → "07:00" */
  Planning.formatClock = function (minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(total / 60) % 24;
    const mi = total % 60;
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  };

  /** نمایش فارسی ساعت — 1425 → «۲۳:۴۵» (فارسی، دو رقمی) */
  Planning.faClock = function (minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(total / 60) % 24;
    const mi = total % 60;
    return U.toFaDigits(`${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`);
  };

  /**
   * مُهر ساعت + تاریخ شمسی دقیق (نسخهٔ ۳٫۳ — جایگزین نشان «+n روز»):
   * وقتی زمان از نیمه‌شبِ روزِ چارت بگذرد، تاریخ شمسی جلالیِ همان روز
   * محاسبه و کنار ساعت نمایش داده می‌شود (متنِ ساده — بدون HTML):
   *   (1665, "1405/06/28") → «۱۴۰۵/۰۶/۲۹ ۱۸:۴۵» · (1035, …) → «۱۷:۱۵»
   */
  Planning.faStampWithDate = function (minutes, baseJalaliDate) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const day = Math.floor(total / 1440);
    const clock = Planning.faClock(total);
    if (day > 0) {
      const base = baseJalaliDate || Planning.todayJalali();
      const shifted = base ? U.addJalaliDays(base, day) : null;
      if (shifted) return `${U.faJalali(shifted)} ${clock}`;
    }
    return clock;
  };

  /** تاریخ شمسی امروز به‌صورت نرمال‌شدهٔ «YYYY/MM/DD» (ارقام لاتین) */
  Planning.todayJalali = function () {
    try {
      return U.jalaliFileStamp(Date.now()).replace(/-/g, '/');
    } catch {
      return null;
    }
  };

  /** تاریخ مؤثر چارت یک ماشین: auto → امروز (هر روز خودکار) | fixed → تاریخ ثبت‌شده */
  Planning.effectiveDate = function (machine) {
    if (machine.dateMode === 'fixed' && machine.fixedDate) {
      return { mode: 'fixed', date: machine.fixedDate };
    }
    return { mode: 'auto', date: Planning.todayJalali() || machine.fixedDate || '' };
  };

  /** دقیقهٔ شروع مؤثر (با Fallback به ۰۷:۰۰) */
  Planning.effectiveStart = function (machine) {
    const parsed = Planning.parseClock(machine.startTime);
    return parsed !== null ? parsed : 420;
  };

  /* ================================================================
     ۳) رول‌های قابل انتخاب (وضعیت «باقی مانده» — همهٔ دستگاه‌ها)
     ================================================================ */

  /**
   * رکوردهای «گزارش تولید ستاپ‌ها» که برای برنامه‌ریزی قابل انتخاب‌اند
   * (نسخهٔ ۳٫۳ — فارغ از دستگاهِ تخصیص‌داده‌شده): وضعیت = «باقی مانده»
   * (هر کدام از دو مانده زمان مثبت). مرتب‌سازی: شماره ستاپ سپس عرض.
   */
  Planning.eligibleRolls = function (state) {
    if (!state || !Array.isArray(state.setupReport)) return [];
    return state.setupReport
      .filter((r) => r.timeStatus === 'remaining')
      .sort((a, b) => (a.setupNumber || 0) - (b.setupNumber || 0) || (a.width || 0) - (b.width || 0));
  };

  /**
   * برچسب گزینهٔ انتخاب رول (برای دراپ‌داون — نسخهٔ ۳٫۳):
   * فقط ۵ فیلد خواسته‌شده — ستاپ · عرض · متراژ استاندارد · تعداد در ستاپ · خام موجود.
   */
  Planning.rollOptionLabel = function (r) {
    return `ستاپ ${U.faNum(r.setupNumber)} · عرض ${U.faWidth(r.width)} · متراژ استاندارد ${U.faNum(r.standardLength)} · تعداد در ستاپ ${U.faNum(r.rollCount)} · خام موجود ${U.faNum(r.rawExisting)}`;
  };

  /* ================================================================
     ۴) ساخت زمان‌بندی زنجیره‌ای هر دستگاه (مغز محاسباتی)
     ================================================================ */

  /**
   * حل کامل اقلام یک ماشین + زمان‌بندی زنجیره‌ای.
   *
   * @param {object} machine  دادهٔ ماشین از Board (items/startTime/…)
   * @param {object} state    خروجی موتور محاسبه (setupReport و…)
   * @param {number} machineNumber
   *
   * خروجی:
   * {
   *   date, dateMode, startMin,                 // تنظیمات زمان‌بندی مؤثر
   *   rows: [{ index, item, kind,               // 'roll' | 'lag'
   *            valid, invalidReason,            // اقلام نامعتبر از زنجیره خارج‌اند
   *            setup?,                          // رکورد زندهٔ گزارش ستاپ‌ها (رول)
   *            label, subLabel,                 // برچسب‌های محور عمودی گانت
   *            quantity?,                       // رول: تعداد مؤثر (لینک خام موجود یا دستی — ۳٫۴)
   *            manualQty?, linkedRaw?,          // رول: تعداد دستی + پرچم لینک فعال (۳٫۴)
   *            perRollMin?,                     // رول: مدت هر رول (قانون زمان)
   *            durationMin,                     // زمان کل قلم (دقیقه)
   *            startMin, endMin }],             // شروع/پایان دقیقهٔ مطلق از نیمه‌شبِ روز صفر
   *   totalMin, endMin,                         // فقط اقلام معتبر
   *   stats: { rollItems, rollQty, rollMin, lagItems, lagMin, invalid },
   *   invalidCount,
   * }
   */
  Planning.buildSchedule = function (machine, state, machineNumber) {
    const setupReport = (state && Array.isArray(state.setupReport)) ? state.setupReport : [];
    const setupById = new Map(setupReport.map((r) => [r.id, r]));

    const startBase = Planning.effectiveStart(machine);
    const dateInfo = Planning.effectiveDate(machine);

    const rows = [];
    let cursor = startBase;   // پایان ردیف قبلی = شروع ردیف جاری (زنجیرهٔ پیوسته)
    const stats = { rollItems: 0, rollQty: 0, rollMin: 0, lagItems: 0, lagMin: 0, invalid: 0 };

    machine.items.forEach((item, idx) => {
      const row = {
        index: idx,
        item,
        kind: item.type,
        valid: false,
        invalidReason: null,
        setup: null,
        label: '',
        subLabel: '',
        quantity: null,
        perRollMin: null,
        durationMin: null,
        startMin: null,
        endMin: null,
      };

      if (item.type === 'roll') {
        const setup = setupById.get(item.setupId) || null;
        row.setup = setup;
        const manualQty = U.parseInt(item.quantity);
        // لینک با «خام موجود» (نسخهٔ ۳٫۴): تعداد مؤثر = مقدار زندهٔ ستون
        // «خام موجود» رکورد؛ اگر خام موجود < ۱ باشد به مقدار دستی برمی‌گردد.
        const linkedRaw = item.linkedRaw === true
          && setup !== null
          && (U.parseInt(setup.rawExisting) || 0) >= 1;
        const quantity = linkedRaw ? U.parseInt(setup.rawExisting) : manualQty;

        if (!setup) {
          row.invalidReason = 'رکورد ستاپ حذف شده است';
        } else if (quantity === null || quantity < 1) {
          row.invalidReason = 'تعداد باید حداقل ۱ باشد';
        } else if (setup.durationMin === null || setup.durationMin === undefined) {
          row.invalidReason = 'قانون زمان متالایز برای این رکورد تعریف نشده';
        } else {
          row.valid = true;
          row.quantity = quantity;
          row.manualQty = manualQty === null ? 1 : manualQty;
          row.linkedRaw = linkedRaw;
          row.perRollMin = setup.durationMin;
          row.durationMin = quantity * setup.durationMin;
          row.label = `عرض ${U.faWidth(setup.width)}`;
          row.subLabel = `ستاپ ${U.faNum(setup.setupNumber)} · ${U.faNum(setup.standardLength)} متر`;
        }
      } else if (item.type === 'lag') {
        const title = String(item.title || '').trim();
        const minutes = U.parseNumber(item.minutes);

        if (!title) {
          row.invalidReason = 'عنوان لگ را وارد کنید';
        } else if (minutes === null || !(minutes > 0)) {
          row.invalidReason = 'زمان لگ باید عددی مثبت باشد';
        } else {
          row.valid = true;
          row.title = title;
          row.durationMin = minutes;
          row.label = title;
          row.subLabel = 'لگ / توقف';
        }
      } else {
        row.invalidReason = 'نوع قلم ناشناخته';
      }

      if (row.valid) {
        row.startMin = cursor;
        row.endMin = cursor + row.durationMin;
        cursor = row.endMin;

        if (row.kind === 'roll') {
          stats.rollItems += 1;
          stats.rollQty += row.quantity;
          stats.rollMin += row.durationMin;
        } else {
          stats.lagItems += 1;
          stats.lagMin += row.durationMin;
        }
      } else {
        stats.invalid += 1;
      }

      rows.push(row);
    });

    return {
      machineNumber,
      date: dateInfo.date,
      dateMode: dateInfo.mode,
      startMin: startBase,
      rows,
      totalMin: Math.max(0, cursor - startBase),
      endMin: cursor,
      stats,
      invalidCount: stats.invalid,
    };
  };

  RM.planning = Planning;
})();
