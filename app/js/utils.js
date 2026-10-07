/* =========================================================================
   utils.js — ابزارهای عمومی مشترک
   -------------------------------------------------------------------------
   شامل: نرمال‌سازی اعداد (فارسی/لاتین)، قالب‌بندی نمایش، Escape امن،
   هش FNV-1a برای شناسایی فایل، تاریخ شمسی و ابزارهای کوچک دیگر.
   ========================================================================= */

'use strict';

(function () {
  const U = {};

  /* ---------- ۱) تبدیل ارقام فارسی/عربی به لاتین (§94-95) ---------- */

  const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

  /** تبدیل تمام ارقام فارسی و عربی یک رشته به ارقام لاتین */
  U.toLatinDigits = function (str) {
    let out = String(str ?? '');
    for (let i = 0; i < 10; i++) {
      out = out.replaceAll(PERSIAN_DIGITS[i], String(i));
      out = out.replaceAll(ARABIC_DIGITS[i], String(i));
    }
    return out;
  };

  /** تبدیل ارقام لاتین یک رشته به ارقام فارسی (بدون تغییر بقیهٔ کاراکترها) */
  U.toFaDigits = function (str) {
    let out = String(str ?? '');
    for (let i = 0; i < 10; i++) {
      out = out.replaceAll(String(i), PERSIAN_DIGITS[i]);
    }
    return out;
  };

  /* ---------- ۲) نرمال‌سازی اعداد (§94) ---------- */

  /**
   * تجزیهٔ امن مقادیر عددی از Excel یا ورودی کاربر.
   * مثال‌های پشتیبانی‌شده:  20 ، "20" ، "۲۰" ، "20,000" ، "۲۰٬۰۰۰" ، " 20 "
   * خروجی: عدد (در صورت موفقیت) و در غیر این صورت null.
   */
  U.parseNumber = function (value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    // تبدیل ارقام فارسی/عربی + حذف جداکننده‌های هزارگان و فاصله‌ها
    const cleaned = U.toLatinDigits(String(value))
      .replace(/[,\u066C\u2019\u066B\s]/g, '')   // کاما، جداکنندهٔ فارسی ٬، آپاستروف، فاصله
      .replace(/[\u200c\u200f\u200e\uFEFF]/g, ''); // کاراکترهای کنترلی RTL و نیم‌فاصله

    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;

    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  };

  /** تجزیهٔ عدد صحیح (برای شماره ستاپ، تعداد و…) */
  U.parseInt = function (value) {
    const n = U.parseNumber(value);
    return n === null ? null : Math.trunc(n);
  };

  /* ---------- ۳) قالب‌بندی نمایش ---------- */

  /** نمایش عدد با ارقام فارسی و جداکنندهٔ هزارگان (null → «—») */
  U.faNum = function (n) {
    if (n === null || n === undefined || n === '') return '—';
    const num = Number(n);
    if (!Number.isFinite(num)) return '—';
    return num.toLocaleString('fa-IR');
  };

  /** نمایش عدد فارسی بدون جداکنندهٔ هزارگان */
  U.faNumPlain = function (n) {
    if (n === null || n === undefined || n === '') return '—';
    const num = Number(n);
    if (!Number.isFinite(num)) return '—';
    return num.toLocaleString('fa-IR', { useGrouping: false });
  };

  /**
   * قالب‌دهندهٔ مرکزی «عرض رول» — بدون جداکنندهٔ هزارگان.
   * مثال: 1200 → «۱۲۰۰» (نه «۱٬۲۰۰»).
   * فقط لایهٔ Presentation است؛ مقدار/نوع داده در محاسبات و
   * Storage بدون تغییر می‌ماند.
   */
  U.faWidth = function (n) {
    return U.faNumPlain(n);
  };

  /**
   * قالب‌دهندهٔ «سال» چهاررقمی (نسخهٔ ۳٫۰ — تغییر ۷ کاربر) — ارقام فارسی
   * «بدون» جداکنندهٔ هزارگان: 1405 → «۱۴۰۵» (نه «۱٬۴۰۵»).
   * سال‌ها هرگز سه‌رقمی جدا نمی‌شوند — در همهٔ جدول‌ها و متن‌های پروژه
   * مقدار سال با همین قالب‌دهنده نمایش داده می‌شود.
   */
  U.faYear = function (n) {
    if (n === null || n === undefined || n === '') return '—';
    const num = Number(n);
    if (!Number.isFinite(num)) return '—';
    return U.toFaDigits(String(Math.trunc(num)));
  };

  /**
   * قالب‌دهندهٔ «وزن» رول‌های برش‌خورده — جداسازی سه‌رقمی با نقطه
   * (فرمت خواسته‌شدهٔ کاربر: 1235456 → «1.235.456» و 2316.8 → «2.316»).
   * جز اعشار برای نمایش حذف می‌شود (طبق مثال مرجع ۸۰۰×۰٫۳۶۲×۸ = «2.316»).
   * مقدار عددی دقیق در داده‌ها حفظ می‌شود — این فقط لایهٔ Presentation است.
   */
  U.faWeightDot = function (n) {
    if (n === null || n === undefined || n === '') return '—';
    const num = Number(n);
    if (!Number.isFinite(num)) return '—';
    const sign = num < 0 ? '-' : '';
    const int = Math.floor(Math.abs(num));
    return sign + String(int).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  /**
   * قالب‌دهندهٔ «مدت زمان» (دقیقه) — خوانا و فشرده:
   *   < 60  → «۴۵ دقیقه»
   *   ≥ 60  → «۵ ساعت» یا «۵ ساعت و ۳۰ دقیقه»
   * مقدار تهی → «—»
   */
  U.faDuration = function (minutes) {
    if (minutes === null || minutes === undefined) return '—';
    const m = Math.max(0, Math.round(Number(minutes)));
    if (!Number.isFinite(m)) return '—';
    if (m < 60) return `${U.faNumPlain(m)} دقیقه`;
    const hours = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0
      ? `${U.faNumPlain(hours)} ساعت و ${U.faNumPlain(rem)} دقیقه`
      : `${U.faNumPlain(hours)} ساعت`;
  };

  /** مقدار ساعتِ یک عدد دقیقه‌ای (برای کارت‌ها و چارت‌ها — گردشده) */
  U.hoursOf = function (minutes) {
    if (minutes === null || minutes === undefined) return null;
    return Math.round((Number(minutes) || 0) / 60);
  };

  /**
   * فرمت زمان [H]:mm (نسخهٔ ۲٫۴) — مجموع ساعت‌ها با دو رقم دقیقه:
   *   487.7 دقیقه → «۴۸۷:۴۲»   ·   62 دقیقه → «۱:۰۲»   ·   45 دقیقه → «۰:۴۵»
   * ساعت‌ها بدون صفرِ پیشین و دقیقه همیشه دو رقمی. مقدار تهی → «—».
   * ارقام فارسی؛ چون رقم و «:» هر دو خنثی‌اند، در متن RTL درست رندر می‌شود.
   */
  U.faHMM = function (minutes) {
    if (minutes === null || minutes === undefined) return '—';
    const m = Math.max(0, Math.round(Number(minutes)));
    if (!Number.isFinite(m)) return '—';
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return `${U.faNumPlain(h)}:${U.toFaDigits(String(rem).padStart(2, '0'))}`;
  };

  /**
   * معادل روزانهٔ یک عدد دقیقه‌ای (نسخهٔ ۲٫۴) — روز ۲۴ ساعته با یک رقم اعشار:
   *   62.7 ساعت → «۲٫۶ روز» · مقدار تهی → «—»
   */
  U.faDaysOf = function (minutes) {
    if (minutes === null || minutes === undefined) return '—';
    const days = (Number(minutes) || 0) / 60 / 24;
    if (!Number.isFinite(days)) return '—';
    return `${U.faNum(Math.round(days * 10) / 10)} روز`;
  };

  /**
   * مُهر تاریخ شمسی برای نام فایل (نسخهٔ ۲٫۴) — ارقام لاتین:
   *   new Date() → «1405-06-17» (تقویم هجری شمسی، بدون وابستگی خارجی)
   */
  U.jalaliFileStamp = function (ts) {
    try {
      const parts = new Intl.DateTimeFormat('en-u-ca-persian', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(ts));
      const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch (e) {
      // Fallback: تاریخ میلادی (قدیمی)
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  };

  /**
   * نمایش تاریخ/زمان از مقادیر اکسل برای جزئیات رکوردها.
   * سه حالت پشتیبانی می‌شود:
   *   ۱) رشتهٔ شمسی مثل «1405/05/25 10:06:38» → همان‌گونه نمایش
   *   ۲) رشتهٔ ISO/میلادی → تبدیل به تقویم شمسی (fa-IR)
   *   ۳) عدد سریال تاریخ اکسل → تبدیل و نمایش شمسی
   */
  U.faDateTime = function (value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number' && Number.isFinite(value)) {
      // سریال تاریخ اکسل (روز از 1899-12-30) → 25569 = فاصله تا 1970-01-01
      const d = new Date(Math.round((value - 25569) * 86400000));
      return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fa-IR');
    }
    const s = String(value).trim();
    if (s === '') return '—';
    // رشتهٔ شمسی (سال ۱۳۰۰ تا ۱۴۹۹) — مستقیم نمایش داده می‌شود
    if (/^1[34]\d{2}[\/\-]/.test(s)) return s;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('fa-IR');
    return s;
  };

  /** نمایش تاریخ و ساعت شمسی */
  U.faDate = function (ts) {
    try {
      return new Date(ts).toLocaleString('fa-IR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  /** نمایش تاریخ شمسی بدون ساعت */
  U.faDateOnly = function (ts) {
    try {
      return new Date(ts).toLocaleDateString('fa-IR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  /* ---------- ۳-ب) تقویم هجری شمسی — اعتبارسنجی کامل (نسخهٔ ۲٫۷) ----------
     الگوریتم استاندارد jalaali (بدون وابستگی خارجی) برای تشخیص سال کبیسه
     و تعداد روزهای هر ماه — دامنهٔ معتبر: ۱۳۰۰ تا ۱۴۹۹. */

  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  /** محاسبهٔ کبیسه بودن سال شمسی (الگوریتم دقیق jalaali-js) */
  function jalCal(jy) {
    const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    const gy = jy + 621;
    let leapJ = -14;
    let jp = breaks[0];
    let jump = 0;
    let jm;
    for (let i = 1; i < breaks.length; i++) {
      jm = breaks[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    let n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    let leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap, gy, march };
  }

  /** سال کبیسهٔ شمسی؟ (اسفند ۳۰ روزه) */
  U.isJalaliLeap = function (jy) {
    return jalCal(jy).leap === 0;
  };

  /** تعداد روزهای یک ماه شمسی: ۱-۶ = ۳۱ · ۷-۱۱ = ۳۰ · ۱۲ = ۲۹/۳۰ (کبیسه) */
  U.jalaliMonthDays = function (jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return U.isJalaliLeap(jy) ? 30 : 29;
  };

  /**
   * تجزیه و اعتبارسنجی کامل تاریخ شمسی از ورودی کاربر (نسخهٔ ۲٫۷).
   * فرمت‌های پذیرفته‌شده: «1405/06/18» ، «1405-6-8» ، «۱۴۰۵/۰۶/۱۸»
   * (ارقام فارسی/عربی خودکار به لاتین تبدیل می‌شوند).
   * خروجی: { y, m, d, normalized: "YYYY/MM/DD" } یا null (نامعتبر).
   * نرمال‌شدهٔ «YYYY/MM/DD» با صفرِ پیشین، لغوی مرتب‌شدن = ترتیب زمانی است.
   */
  U.parseJalaliDate = function (value) {
    if (value === null || value === undefined) return null;
    const s = U.toLatinDigits(String(value)).trim().replace(/[.\-\\ ]/g, '/');
    const m = /^(1[34]\d{2})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
    if (!m) return null;

    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);

    if (mo < 1 || mo > 12) return null;
    if (d < 1 || d > U.jalaliMonthDays(y, mo)) return null;

    return {
      y, m: mo, d,
      normalized: `${String(y).padStart(4, '0')}/${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
    };
  };

  /** نمایش تاریخ شمسی نرمال‌شده با ارقام فارسی: «1405/06/18» → «۱۴۰۵/۰۶/۱۸» */
  U.faJalali = function (normalized) {
    if (!normalized) return '—';
    return U.toFaDigits(String(normalized));
  };

  /**
   * جمع/کم روز با تقویم شمسی دقیق (نسخهٔ ۳٫۳) — بدون وابستگی خارجی.
   *   «1405/06/18» + ۱۳ روز → «1405/07/01» · «1405/06/18» + ۱۱ روز → «1405/06/29»
   * ماه‌های ۳۱/۳۰ روزه و اسفند کبیسه (jalaliMonthDays) لحاظ می‌شوند؛
   * مقدار روز می‌تواند منفی هم باشد. ورودی نامعتبر → null.
   */
  U.addJalaliDays = function (normalized, days) {
    const p = U.parseJalaliDate(normalized);
    if (!p || days === null || days === undefined || !Number.isFinite(Number(days))) return null;
    let { y, m, d } = p;
    d += Math.trunc(Number(days));

    while (d > U.jalaliMonthDays(y, m)) {
      d -= U.jalaliMonthDays(y, m);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    while (d < 1) {
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
      d += U.jalaliMonthDays(y, m);
    }

    return `${String(y).padStart(4, '0')}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
  };

  /* ---------- ۳-ب-۲) تبدیل تاریخ/زمان شمسی به Timestamp (نسخهٔ ۳٫۵ — تغییر ۹) ----------
     برای محاسبهٔ فاصلهٔ زمانی «تاریخ تولید» (رشتهٔ شمسی مثل «1405/06/18 13:55:40»)
     با اکنون. سه قالب پشتیبانی می‌شود:
       ۱) رشتهٔ شمسی «YYYY/MM/DD[ HH:mm[:ss]]» (ارقام فارسی هم پذیرفته می‌شود)
       ۲) عدد سریال تاریخ اکسل (روز از 1899-12-30)
       ۳) رشتهٔ ISO/میلادی قابل‌تجزیه با Date
     روش: اختلاف روزِ تقویمی هدف با «امروزِ شمسی» از راه شمارش روزهای واقعی
     ماه‌ها (jalaliMonthDays) محاسبه و روی نیمه‌شبِ امروز اعمال می‌شود + ساعت
     ورودی — دقیق و بدون نیاز به تبدیل معکوس تقویم. ورودی نامعتبر → null. */
  U.jalaliDaysSinceEpoch = function (y, m, d) {
    let days = 0;
    for (let yy = 1300; yy < y; yy++) days += U.isJalaliLeap(yy) ? 366 : 365;
    for (let mm = 1; mm < m; mm++) days += U.jalaliMonthDays(y, mm);
    return days + d;
  };

  U.jalaliDateTimeToTimestamp = function (value) {
    if (value === null || value === undefined || value === '') return null;

    // عدد سریال اکسل
    if (typeof value === 'number' && Number.isFinite(value)) {
      const d = new Date(Math.round((value - 25569) * 86400000));
      return Number.isNaN(d.getTime()) ? null : d.getTime();
    }

    const s = U.toLatinDigits(String(value)).trim();
    if (s === '') return null;

    // رشتهٔ شمسی با ساعت اختیاری
    const m = /^(1[34]\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(s);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (mo < 1 || mo > 12) return null;
      if (d < 1 || d > U.jalaliMonthDays(y, mo)) return null;

      // امروزِ شمسی + نیمه‌شبِ امروز (مبنای اختلاف روز)
      const todayStamp = U.jalaliFileStamp(Date.now());   // «YYYY-MM-DD»
      const tp = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(todayStamp);
      if (!tp) return null;
      const diffDays = U.jalaliDaysSinceEpoch(y, mo, d)
        - U.jalaliDaysSinceEpoch(Number(tp[1]), Number(tp[2]), Number(tp[3]));
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return midnight.getTime()
        + diffDays * 86400000
        + (Number(m[4]) || 0) * 3600000
        + (Number(m[5]) || 0) * 60000
        + (Number(m[6]) || 0) * 1000;
    }

    // رشتهٔ ISO/میلادی
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  };

  /* ---------- ۳-پ) ایزوله‌سازی لاتین در متن فارسی (نسخهٔ ۲٫۷) ----------
     حل مشکل به‌هم‌ریختگی متن وقتی حروف لاتین (شمارهٔ رول، نام فایل، اصطلاح
     فنی مانند IndexedDB یا Excel) داخل جملهٔ فارسی می‌آیند: هر «ران لاتین»
     (شامل ارقام/نقطه/خط تیره/پرانتز چسبیده) با LRI…PDI (U+2066/U+2069)
     ایزوله می‌شود تا الگوریتم دوجهته متن اطراف را جابه‌جا نکند.
     تگ‌های HTML و Entityها (مثل &amp;) دست‌نخورده می‌مانند.
     علامت‌های پایان جمله (نقطه و…، ویرگول و…) از انتهای ران خارج می‌شوند. */

  const BIDI_LATIN_RUN = /[A-Za-z0-9.,_\-+/:()%&@]*[A-Za-z][A-Za-z0-9.,_\-+/:()%&@]*/g;
  const BIDI_TRAIL_PUNCT = /[.,;:!?،؛]+$/;

  U.bidi = function (text) {
    const s = String(text ?? '');
    if (!s || !/[A-Za-z]/.test(s)) return s;

    // محافظت از تگ‌ها و Entityها
    const stash = [];
    let guarded = s.replace(/<[^>]*>|&[a-zA-Z#][a-zA-Z0-9]*;/g, (m) => {
      stash.push(m);
      return `\u0001${stash.length - 1}\u0001`;
    });

    guarded = guarded.replace(BIDI_LATIN_RUN, (m) => {
      const trail = BIDI_TRAIL_PUNCT.exec(m);
      const core = trail ? m.slice(0, m.length - trail[0].length) : m;
      return `\u2066${core}\u2069${trail ? trail[0] : ''}`;
    });

    return guarded.replace(/\u0001(\d+)\u0001/g, (_, i) => stash[Number(i)]);
  };

  /* ---------- ۴) امنیت: فرار دادن HTML (§73) ---------- */

  U.escapeHtml = function (value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  };

  /* ---------- ۵) نرمال‌سازی متن هدر ستون‌های اکسل ---------- */

  /**
   * حذف فاصله‌ها، نیم‌فاصله و کاراکترهای جهت‌دهی برای مقایسهٔ مطمئن عنوان ستون‌ها.
   * «نوع فیلم» ، «نوع‌فیلم» و «نوعفیلم» هم‌ارزش می‌شوند.
   */
  U.normalizeHeader = function (h) {
    return String(h ?? '')
      .replace(/[\s\u200c\u200f\u200e\uFEFF]/g, '')
      .trim();
  };

  /* ---------- ۶) هش FNV-1a برای شناسایی فایل (§12) ---------- */

  /**
   * هش ۳۲ بیتی FNV-1a روی ArrayBuffer — سبک، همگام و بدون نیاز به
   * crypto.subtle (که در برخی زمینه‌ها مثل file:// قدیمی در دسترس نیست).
   * برای تشخیص «فایل بدون تغییر» کاملاً کافی است.
   */
  U.hashBuffer = function (buffer) {
    const view = new Uint8Array(buffer);
    let hash = 0x811c9dc5;
    for (let i = 0; i < view.length; i++) {
      hash ^= view[i];
      hash = Math.imul(hash, 0x01000193) >>> 0;   // ضرب FNV با حفظ uint32
    }
    return ('00000000' + hash.toString(16)).slice(-8).toUpperCase();
  };

  /* ---------- ۷) ابزارهای کوچک ---------- */

  /** فرمت کلید گروه: «عرض-متراژ-ستاپ» */
  U.formatKey = (...parts) => parts.map((p) => (p === null || p === undefined ? 'null' : String(p))).join('-');

  /** قطع متن طولانی برای نمایش در جدول */
  U.truncate = function (text, max = 40) {
    const s = String(text ?? '');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };

  /** مقایسهٔ عددی امن برای مرتب‌سازی (null در انتها) */
  U.compareNumeric = function (a, b, direction = 'asc') {
    const na = a === null || a === undefined || a === '—' ? null : Number(a);
    const nb = b === null || b === undefined || b === '—' ? null : Number(b);
    let result = 0;
    if (na === null && nb === null) result = 0;
    else if (na === null) result = 1;      // مقادیر تهی همیشه آخر
    else if (nb === null) result = -1;
    else result = na < nb ? -1 : na > nb ? 1 : 0;
    return direction === 'desc' ? -result : result;
  };

  RM.utils = U;
})();
