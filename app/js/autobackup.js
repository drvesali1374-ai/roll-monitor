/* =========================================================================
   autobackup.js — پشتیبان‌گیری خودکار روزانه (نسخهٔ ۳٫۳۷)
   -------------------------------------------------------------------------
   سامانهٔ زمان‌بندی سمت کاربر برای وب‌اپ کاملاً آفلاین (بدون سرور):

     · هر روز در ساعتِ تعیین‌شدهٔ کاربر (پیش‌فرض ۱۲:۰۰)، یک نسخهٔ پشتیبان
       «دقیقاً همان فایل دکمهٔ دستیِ ساخت فایل پشتیبان» ساخته می‌شود
       (Backup.build مشترک — محتوای یکسان، نام فایل یکسان).
     · جبران عقب‌افتادگی: اگر در ساعت مقرر برنامه باز نبوده باشد، در
       اولین بررسی پس از باز شدن (بوت/بازگشت به تب/تیک ۳۰ ثانیه‌ای)،
       «آخرین فرصت مقررِ گذشته» با «آخرین پشتیبان موفق» مقایسه می‌شود و
       در صورت عقب‌ماندن، پشتیبان‌گیری فوراً اجرا می‌شود.
     · ذخیرهٔ امن داخلی: هر نسخه در جدول‌های backups (متادیتا) و
       backupBlobs (محتوای کامل) ذخیره می‌شود و در «تاریخچهٔ نسخه‌ها»
       (تنظیمات ← پشتیبان‌گیری خودکار روزانه) با دانلود/بازیابی/حذف
       قابل مدیریت است — حتی اگر مرورگر دانلود خودکار را مسدود کند،
       نسخه در تاریخچه امن است و با یک کلیک دانلود می‌شود.
     · چرخش نسخه‌ها (Rotation): فقط N نسخهٔ آخر نگه داشته می‌شود
       (پیش‌فرض ۷، قابل تنظیم ۱ تا ۳۰) — قدیمی‌ها خودکار حذف می‌شوند.
     · دانلود خودکار در مرورگر (قابل خاموش‌کردن): همان سازوکار Blob
       دکمهٔ دستی.
     · ضدانعطاف: گارد ورود مجدد، ضد تکرار در چند تب همزمان (بررسی
       دوتایی داخل تراکنش IndexedDB)، تلاش مجدد ۳۰ ثانیه‌ای پس از خطا،
       جبران سهمیهٔ پر (حذف قدیمی‌ترین و درج مجدد)، نادیده‌گرفتن
       ساعتِ جلو‌رانده‌شده، و رد شدن از بک‌آپِ دیتابیسِ خالی.

   طراحی «فرصت مقرر» (Due Slot):
     آخرین گذرِ ساعتِ تنظیم‌شده نسبت به «الان» — اگر الان ۱۰:۰۰ و ساعت
     تنظیمی ۱۴:۳۰ باشد، فرصت مقرر = دیروز ۱۴:۳۰؛ اگر الان ۱۵:۰۰ باشد،
     فرصت مقرر = امروز ۱۴:۳۰. پشتیبان جدید فقط وقتی لازم است که
     «آخرین پشتیبانِ برآورده‌شده» قدیمی‌تر از فرصت مقرر باشد — همین یک
     مقایسه، هر دو حالتِ «سر وقت» و «جبران عقب‌افتاده» را پوشش می‌دهد.
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const db = RM.db.db;

  const AutoBackup = {};

  /* ---------------- ثابت‌ها ---------------- */

  /** فاصلهٔ بررسی زمان‌بند (۳۰ ثانیه) */
  const TICK_MS = 30 * 1000;

  /** تأخیر اولین بررسی پس از بوت (تسبیت رندر اولیه) */
  const BOOT_DELAY_MS = 3000;

  /** مرز تشخیص «جبران عقب‌افتاده» — اگر بیش از ۲ دقیقه از فرصت مقرر گذشته
      باشد، اجرا با برچسب جبران (پیام مخصوص) انجام می‌شود. */
  const CATCHUP_GRACE_MS = 2 * 60 * 1000;

  /** پیش‌فرض‌های تنظیمات (کلیدهای جدول appSettings) */
  const DEFAULTS = {
    enabled: false,      // autoBackupEnabled
    time: '12:00',       // autoBackupTime  («HH:MM»)
    download: true,      // autoBackupDownload
    retention: 7,        // autoBackupRetention (۱ تا ۳۰)
  };

  /* ---------------- وضعیت داخلی ---------------- */

  let started = false;
  let running = false;          // گارد ورود مجدد tick
  let lastErrorToastSlot = 0;   // ضد اسپم پیام خطا (فقط یک‌بار به ازای هر فرصت)

  /* ---------------- تنظیمات ---------------- */

  /** خواندن و نرمال‌سازی تنظیمات پشتیبان‌گیری خودکار */
  AutoBackup.loadSettings = async function () {
    const [enabled, time, download, retention, lastSlot, lastError] = await Promise.all([
      RM.db.getSetting('autoBackupEnabled', DEFAULTS.enabled),
      RM.db.getSetting('autoBackupTime', DEFAULTS.time),
      RM.db.getSetting('autoBackupDownload', DEFAULTS.download),
      RM.db.getSetting('autoBackupRetention', DEFAULTS.retention),
      RM.db.getSetting('autoBackupLastSlot', 0),
      RM.db.getSetting('autoBackupLastError', null),
    ]);

    const t = String(time || DEFAULTS.time).trim();
    const hhmm = /^\d{1,2}:\d{1,2}$/.test(t) ? t : DEFAULTS.time;
    const r = Math.min(30, Math.max(1, U.parseInt(retention) || DEFAULTS.retention));

    return {
      enabled: !!enabled,
      time: hhmm,
      download: !!download,
      retention: r,
      lastSlot: Number(lastSlot) || 0,
      lastError: lastError || null,
    };
  };

  /** ذخیرهٔ یک تنظیم + به‌روزرسانی پنل تنظیمات (اگر باز باشد) */
  AutoBackup.saveSetting = async function (key, value) {
    await RM.db.setSetting(key, value);
    try {
      if (RM.views.settings && RM.views.settings.renderAutoBackupPanel) {
        await RM.views.settings.renderAutoBackupPanel();
      }
    } catch { /* بی‌صدا */ }
    // تنظیم تغییر کرده است — بلافاصله بررسی شود (مثلاً فعال‌سازی یا
    // تغییر ساعت می‌تواند فوراً به جبران عقب‌افتاده بینجامد)
    AutoBackup.tick('setting-change').catch((err) => console.warn('[AutoBackup]', err));
  };

  /* ---------------- محاسبهٔ فرصت‌های زمان‌بندی ---------------- */

  /** تجزیهٔ «HH:MM» به [ساعت، دقیقه] با گارد خطا */
  function parseHM(timeStr) {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(timeStr || DEFAULTS.time));
    if (!m) return [12, 0];
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0));
    const mm = Math.min(59, Math.max(0, parseInt(m[2], 10) || 0));
    return [hh, mm];
  }

  /**
   * آخرین فرصت مقررِ گذشته نسبت به «الان» — قلب منطق زمان‌بندی و جبران:
   *   الان ۱۰:۰۰، ساعت تنظیمی ۱۴:۳۰ → دیروز ۱۴:۳۰
   *   الان ۱۵:۰۰، ساعت تنظیمی ۱۴:۳۰ → امروز ۱۴:۳۰
   */
  AutoBackup.latestDueSlot = function (now, timeStr) {
    const [hh, mm] = parseHM(timeStr);
    const d = new Date(now);
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
  };

  /** نزدیک‌ترین فرصت آینده (برای نمایش «اجرای بعدی» در وضعیت) */
  AutoBackup.nextSlotAfter = function (now, timeStr) {
    const [hh, mm] = parseHM(timeStr);
    const d = new Date(now);
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  };

  /** آیا برنامه داده‌ای برای پشتیبان‌گیری دارد؟ (دیتابیس خالی → رد) */
  AutoBackup.hasAnyData = async function () {
    try {
      const [rolls, archived, setups, pallets] = await Promise.all([
        db.rolls.count(),
        db.archivedRolls.count(),
        db.setupRolls.count(),
        db.pallets.count(),
      ]);
      return (rolls + archived + setups + pallets) > 0;
    } catch {
      return false;
    }
  };

  /* ---------------- حجم فایل (نمایش فارسی) ---------------- */

  function formatSize(bytes) {
    const b = Number(bytes);
    if (!Number.isFinite(b) || b <= 0) return '۰ بایت';
    if (b < 1024) return `${U.faNum(Math.round(b))} بایت`;
    if (b < 1024 * 1024) return `${U.faNum(Math.round(b / 102.4) / 10)} کیلوبایت`;
    return `${U.faNum(Math.round(b / 104857.6) / 10)} مگابایت`;
  }
  AutoBackup.formatSize = formatSize;

  /* ---------------- تاریخچهٔ نسخه‌ها (CRUD) ---------------- */

  /** فهرست متادیتای نسخه‌ها (جدید → قدیم) — بدون بارگذاری محتوای حجیم */
  AutoBackup.listBackups = function () {
    return db.backups.orderBy('createdAt').reverse().toArray();
  };

  /** محتوای کامل یک نسخه (برای دانلود/بازیابی) */
  AutoBackup.getBackupPayload = async function (id) {
    const row = await db.backupBlobs.get(id);
    return row ? row.payload : null;
  };

  /** حذف یک نسخه (متادیتا + محتوا) به‌صورت تراکنشی */
  AutoBackup.deleteBackup = async function (id) {
    await db.transaction('rw', [db.backups, db.backupBlobs], async () => {
      await db.backups.delete(id);
      await db.backupBlobs.delete(id);
    });
  };

  /** پاک‌کردن کل تاریخچه (۳٫۳۷ — «پاک‌سازی کامل برنامه» هم این را صدا می‌زند) */
  AutoBackup.clearHistory = async function () {
    await db.transaction('rw', [db.backups, db.backupBlobs], async () => {
      await db.backups.clear();
      await db.backupBlobs.clear();
    });
  };

  /** چرخش نسخه‌ها: فقط retention نسخهٔ آخر بماند — خروجی: تعداد حذف‌شده‌ها */
  AutoBackup.prune = async function (retention) {
    const all = await db.backups.orderBy('createdAt').reverse().toArray();
    const extra = all.slice(Math.max(1, retention));
    for (const rec of extra) {
      await AutoBackup.deleteBackup(rec.id);
    }
    return extra.length;
  };

  /* ---------------- ساخت و درج پشتیبان ---------------- */

  function isQuotaError(err) {
    const name = (err && err.name) || '';
    const msg = String((err && err.message) || err || '');
    return name === 'QuotaExceededError' || /quota/i.test(name + msg);
  }

  /** درج تراکنشی متادیتا + محتوا با بررسی دوتایی ضد تکرار (چند تب همزمان) */
  function insertBackup(meta, payload, fulfilledKnown) {
    return db.transaction('rw', [db.backups, db.backupBlobs], async () => {
      // داخل تراکنش rw، تب‌های همزمان سریالی می‌شوند — این خواندن همیشه
      // نتیجهٔ درجِ تبِ دیگر را می‌بیند → هیچ‌وقت نسخهٔ تکراری برای یک
      // فرصت مقرر ساخته نمی‌شود.
      const newest = await db.backups.orderBy('createdAt').last();
      const newestSlot = (newest && Number(newest.scheduledFor)) || 0;
      const fulfilled = Math.max(fulfilledKnown || 0, newestSlot);
      if (meta.scheduledFor <= fulfilled) return { skipped: true };

      const id = await db.backups.add(meta);
      await db.backupBlobs.put({ id, payload });
      return { skipped: false, id };
    });
  }

  /**
   * ساخت یک نسخهٔ پشتیبان خودکار — عیناً همان Payload دکمهٔ دستی
   * («ساخت فایل پشتیبان»)، به‌علاوهٔ متادیتای زمان‌بندی.
   * opts.trigger: 'schedule' (سر وقت) | 'catchup' (جبران) | 'manual' (اجرای فوری)
   */
  AutoBackup.createBackup = async function (slotTs, opts = {}) {
    const settings = await AutoBackup.loadSettings();

    // همان سازوکار دکمهٔ دستی — فایل و محتوا بایت‌به‌بایت یکسان
    const payload = await RM.backupEngine.build();
    const fileName = `RollMonitor-Backup-${U.jalaliFileStamp(payload.exportedAt)}.json`;
    const json = JSON.stringify(payload);

    const meta = {
      createdAt: payload.exportedAt,
      scheduledFor: slotTs,
      kind: 'auto',
      trigger: opts.trigger || 'schedule',
      fileName,
      counts: payload.counts || {},
      sizeBytes: json.length,
    };

    // درج + جبران سهمیهٔ پر (حذف قدیمی‌ترین و تلاش مجدد)
    let result;
    try {
      result = await insertBackup(meta, payload, settings.lastSlot);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      console.warn('[AutoBackup] سهمیهٔ پر — قدیمی‌ترین نسخه حذف و دوباره تلاش می‌شود.', err);
      const oldest = await db.backups.orderBy('createdAt').first();
      if (oldest) await AutoBackup.deleteBackup(oldest.id);
      result = await insertBackup(meta, payload, settings.lastSlot);
    }
    if (result.skipped) return { skipped: true };

    // فرصت مقرر به‌عنوان برآورده‌شده ثبت می‌شود (حتی اگر کاربر نسخه‌های
    // تاریخچه را دستی حذف کند، جبرانِ بی‌مورد رخ نمی‌دهد)
    await RM.db.setSetting('autoBackupLastSlot', slotTs);
    await RM.db.setSetting('autoBackupLastError', null);

    // چرخش نسخه‌ها
    try {
      await AutoBackup.prune(settings.retention);
    } catch (err) {
      console.warn('[AutoBackup:Prune]', err);
    }

    // دانلود خودکار در مرورگر (قابل خاموش‌کردن) — شکست دانلود، خودِ
    // پشتیبان را به خطر نمی‌اندازد؛ نسخه در تاریخچه امن است.
    if (settings.download) {
      try {
        RM.backupEngine.downloadPayload(payload, fileName);
      } catch (err) {
        console.warn('[AutoBackup:Download]', err);
      }
    }

    // اعلان کاربر
    const c = meta.counts || {};
    const label = opts.trigger === 'catchup'
      ? `جبران پشتیبان عقب‌افتاده (${U.faDate(slotTs)})`
      : (opts.trigger === 'manual' ? 'پشتیبان‌گیری (اجرای فوری)' : 'پشتیبان خودکار روزانه');
    RM.ui.toast(
      `${label} انجام شد — ${U.faNum(c.setupRolls || 0)} ستاپ · ` +
      `${U.faNum((c.rolls || 0) + (c.archivedRolls || 0))} رکورد اکسل · ${formatSize(meta.sizeBytes)}` +
      (settings.download
        ? ' — فایل در مرورگر دانلود شد و نسخه در تاریخچهٔ تنظیمات ذخیره گردید.'
        : ' — نسخه در تاریخچهٔ تنظیمات ذخیره گردید (دانلود خودکار خاموش است).'),
      'success',
      7000
    );

    // به‌روزرسانی پنل تنظیمات اگر باز باشد
    try {
      if (RM.views.settings && RM.views.settings.renderAutoBackupPanel) {
        await RM.views.settings.renderAutoBackupPanel();
      }
    } catch { /* بی‌صدا */ }

    return { skipped: false, id: result.id, counts: meta.counts, sizeBytes: meta.sizeBytes, fileName };
  };

  /** اجرای فوری از دکمهٔ تنظیمات — فرصت مقررِ فعلی را برآورده می‌کند */
  AutoBackup.runNow = async function () {
    const settings = await AutoBackup.loadSettings();
    const due = AutoBackup.latestDueSlot(Date.now(), settings.time);
    return AutoBackup.createBackup(due, { trigger: 'manual' });
  };

  /* ---------------- زمان‌بند ---------------- */

  /**
   * یک بررسی کامل: اگر پشتیبان روزِ جاری (فرصت مقرر گذشته) ساخته نشده
   * باشد، همین حالا ساخته می‌شود — چه برنامه در ساعت مقرر باز بوده
   * (تیک ۳۰ ثانیه‌ای → سر وقت) و چه بسته بوده (بوت/بازگشت به تب → جبران).
   */
  AutoBackup.tick = async function (reason = 'tick') {
    if (running) return;
    running = true;
    try {
      const settings = await AutoBackup.loadSettings();
      if (!settings.enabled) return;

      const now = Date.now();
      const due = AutoBackup.latestDueSlot(now, settings.time);

      // آخرین پشتیبانِ برآورده‌شده — ساعتِ جلو‌رانده خنثی می‌شود
      const lastSlotClamped = Math.min(settings.lastSlot, now);
      let newestSlot = 0;
      try {
        const newest = await db.backups.orderBy('createdAt').last();
        newestSlot = (newest && Number(newest.scheduledFor)) || 0;
      } catch { /* جدول تازه ساخته شده — خالی */ }
      const fulfilled = Math.max(lastSlotClamped, newestSlot);

      if (fulfilled >= due) return;                       // به‌روز است
      if (!(await AutoBackup.hasAnyData())) return;       // چیزی برای پشتیبان نیست

      const trigger = (now - due > CATCHUP_GRACE_MS) ? 'catchup' : 'schedule';
      const res = await AutoBackup.createBackup(due, { trigger });
      if (res && res.skipped) return;   // تب دیگری همین فرصت را برآورده کرد
    } catch (err) {
      console.error('[AutoBackup:Tick:' + reason + ']', err);
      // ثبت خطا برای نمایش در وضعیت پنل + پیام (فقط یک‌بار به ازای هر فرصت) —
      // تیک بعدی (۳۰ ثانیه بعد) دوباره تلاش می‌کند.
      try {
        await RM.db.setSetting('autoBackupLastError', {
          at: Date.now(),
          message: String((err && err.message) || err),
        });
      } catch { /* بی‌صدا */ }
      try {
        RM.ui.toast(
          'پشتیبان‌گیری خودکار روزانه ناموفق بود — چند ثانیه دیگر به‌صورت خودکار دوباره تلاش می‌شود.',
          'error',
          6000
        );
      } catch { /* بی‌صدا */ }
      try {
        if (RM.views.settings && RM.views.settings.renderAutoBackupPanel) {
          await RM.views.settings.renderAutoBackupPanel();
        }
      } catch { /* بی‌صدا */ }
    } finally {
      running = false;
    }
  };

  /**
   * شروع زمان‌بند — یک‌بار پس از بوت برنامه صدا زده می‌شود:
     · بررسی اولیه با تأخیر کوتاه (جبران عقب‌افتادهٔ هنگام بوت)
     · تیک دوره‌ای هر ۳۰ ثانیه (اجرای سرِ وقت)
     · بررسی فوری با نمایان‌شدن تب (بازگشت کاربر پس از غیبت)
   */
  AutoBackup.start = function () {
    if (started) return;
    started = true;

    setTimeout(() => {
      AutoBackup.tick('boot').catch((err) => console.warn('[AutoBackup:Boot]', err));
    }, BOOT_DELAY_MS);

    setInterval(() => {
      AutoBackup.tick('interval').catch((err) => console.warn('[AutoBackup:Interval]', err));
    }, TICK_MS);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        AutoBackup.tick('visible').catch((err) => console.warn('[AutoBackup:Visible]', err));
      }
    });

    console.info('⏱ زمان‌بند پشتیبان‌گیری خودکار روزانه فعال شد (بررسی هر ۳۰ ثانیه)');
  };

  RM.autoBackup = AutoBackup;
})();
