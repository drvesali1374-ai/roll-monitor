/* =========================================================================
   سامانهٔ مانیتورینگ صنعتی رول‌ها — app.js
   -------------------------------------------------------------------------
   معماری: Vanilla JavaScript خالص (بدون فریم‌ورک)
   پایگاه‌داده: IndexedDB با کتابخانهٔ Dexie.js (لوکال)
   خواندن اکسل: SheetJS (لوکال)
   حالت اجرا: کاملاً آفلاین — با دابل‌کلیک روی index.html اجرا می‌شود

   ساختار فایل:
     بخش ۱) ثابت‌ها و تنظیمات
     بخش ۲) راه‌اندازی پایگاه‌داده (Dexie / IndexedDB)
     بخش ۳) ابزارهای کمکی (اعداد فارسی، تاریخ، توست، مودال…)
     بخش ۴) مدیریت تب‌ها
     بخش ۵) ایمپورت فایل‌های اکسل با SheetJS
     بخش ۶) مدیریت رول‌های ستاپ (ثبت / حذف / نمایش)
     بخش ۷) داشبورد — محاسبهٔ ۴ شاخص اصلی
     بخش ۸) رویدادهای اولیه و شروع برنامه
   ========================================================================= */

'use strict';

/* =========================================================================
   بخش ۱) ثابت‌ها و تنظیمات
   ========================================================================= */

/** تنظیمات هر یک از دو فایل ورودی (هدف‌های ایمپورت) */
const IMPORT_TARGETS = {
  rolls: {
    table: 'rolls',            // نام جدول در IndexedDB
    metaKey: 'rollsInfo',      // کلید جدول meta برای ذخیرهٔ اطلاعات ایمپورت
    label: 'رول‌های موجود',
    expectedFile: 'rolls.xlsx',
  },
  archived: {
    table: 'archivedRolls',
    metaKey: 'archivedInfo',
    label: 'سابقه رول‌ها (آرشیو)',
    expectedFile: 'Archived Rolls.xlsx',
  },
};

/** تعداد ردیف‌های پیش‌نمایش جدول پس از ایمپورت */
const PREVIEW_ROWS = 20;

/** حداکثر تعداد ستون نمایش‌داده‌شده در پیش‌نمایش */
const PREVIEW_COLS = 8;

/* =========================================================================
   بخش ۲) راه‌اندازی پایگاه‌داده (Dexie / IndexedDB)
   ========================================================================= */

/** ساخت نمونهٔ پایگاه‌داده با چهار جدول:
 *  - rolls:        ردیف‌های فایل rolls.xlsx
 *  - archivedRolls: ردیف‌های فایل Archived Rolls.xlsx
 *  - setupRolls:   رکوردهای تعریف‌شدهٔ کاربر برای رول‌های ستاپ
 *  - meta:         اطلاعات جانبی (نام فایل، تاریخ ایمپورت و…)
 */
const db = new Dexie('RollMonitorDB');

db.version(1).stores({
  rolls:        '++id, filmType',                       // filmType برای فیلتر سریع
  archivedRolls:'++id, filmType',
  setupRolls:   '++id, setupNumber, machineNumber, rollType',
  meta:         'key',                                   // جدول کلید-مقدار
});

/* =========================================================================
   بخش ۳) ابزارهای کمکی
   ========================================================================= */

/** نمایش اعداد با ارقام فارسی و جداکنندهٔ هزارگان */
function faNum(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('fa-IR');
}

/** نمایش تاریخ و ساعت به شمسی (تقویم فارسی مرورگر) */
function faDate(ts) {
  try {
    return new Date(ts).toLocaleString('fa-IR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** جلوگیری از تزریق HTML (فرار دادن کاراکترهای خطرناک) */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * نرمال‌سازی عنوان ستون‌های اکسل:
 * حذف فاصله‌ها، نیم‌فاصله (ZWNJ) و کاراکترهای کنترلی برای مقایسهٔ مطمئن
 * مثال: «نوع فیلم» و «نوع‌فیلم» و «نوعفیلم» هم‌ارزش می‌شوند.
 */
function normalizeHeader(h) {
  return String(h ?? '')
    .replace(/[\s\u200c\u200f\u200e\uFEFF]/g, '')  // فاصله، نیم‌فاصله، علائم جهت
    .trim();
}

/**
 * قلب منطق محاسباتی:
 * آیا این رول «خام/متالایز» است؟
 * شرط: حرف دومِ «نوع فیلم» برابر R (بزرگ یا کوچک) باشد.
 * دقیقاً همان شرط خواسته‌شده:
 *   filmType && filmType.length >= 2 && filmType.charAt(1).toUpperCase() === 'R'
 */
function isRFilm(filmType) {
  const f = String(filmType ?? '').trim();
  return !!(f && f.length >= 2 && f.charAt(1).toUpperCase() === 'R');
}

/* ---------------- اعلان‌های شناور (Toast) ---------------- */

const ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
  error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
};

/** نمایش اعلان شناور؛ type یکی از success | error | warning | info */
function toast(message, type = 'info', duration = 4200) {
  const stack = document.getElementById('toasts');
  if (!stack) return;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `${ICONS[type] || ICONS.info}<div>${message}</div>`;
  stack.appendChild(el);

  // حذف خودکار پس از مدت مشخص
  const timer = setTimeout(() => dismiss(), duration);

  function dismiss() {
    clearTimeout(timer);
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  // با کلیک هم بسته می‌شود
  el.addEventListener('click', dismiss);
}

/* ---------------- پنجرهٔ تأیید (Modal) به‌صورت Promise ---------------- */

let modalResolve = null;

/**
 * نمایش دیالوگ تأیید و انتظار برای پاسخ کاربر.
 * مثال:  const ok = await confirmDialog('حذف', 'مطمئنید؟');
 */
function confirmDialog(title, message, confirmText = 'بله، انجام بده') {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal');
    const titleEl = document.getElementById('modal-title');
    const msgEl   = document.getElementById('modal-msg');
    const btnOk   = document.getElementById('modal-confirm');
    const btnCancel = document.getElementById('modal-cancel');

    titleEl.textContent = title;
    msgEl.textContent = message;
    btnOk.textContent = confirmText;

    overlay.hidden = false;
    btnOk.focus();

    modalResolve = resolve;

    function close(result) {
      overlay.hidden = true;
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      modalResolve = null;
      resolve(result);
    }
    function onOk()     { close(true); }
    function onCancel() { close(false); }
    function onOverlay(e) { if (e.target === overlay) close(false); }
    function onKey(e)   { if (e.key === 'Escape') close(false); }

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

/* =========================================================================
   بخش ۴) مدیریت تب‌ها
   ========================================================================= */

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;

      // فعال‌سازی دکمهٔ انتخاب‌شده
      buttons.forEach((b) => {
        const isActive = b === btn;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });

      // نمایش بخش متناظر
      document.querySelectorAll('.view').forEach((section) => {
        const isActive = section.id === `view-${view}`;
        section.classList.toggle('active', isActive);
        section.hidden = !isActive;
      });
    });
  });
}

/* =========================================================================
   بخش ۵) ایمپورت فایل‌های اکسل با SheetJS
   ========================================================================= */

/** یافتن کلید ستون «نوع فیلم» میان هدرهای فایل */
function findFilmTypeKey(headers) {
  return headers.find((h) => normalizeHeader(h) === 'نوعفیلم') || null;
}

/**
 * فرایند کامل ایمپورت یک فایل اکسل:
 * ۱) اعتبارسنجی پسوند فایل
 * ۲) خواندن فایل با FileReader و تجزیه با SheetJS
 * ۳) بررسی وجود ستون «نوع فیلم» (در غیر این صورت خطا و توقف)
 * ۴) پاک‌سازی جدول قبلی و درج ردیف‌های جدید در IndexedDB
 * ۵) ذخیرهٔ اطلاعات ایمپورت در جدول meta و به‌روزرسانی رابط کاربری
 */
async function importExcelFile(targetKey, file) {
  const target = IMPORT_TARGETS[targetKey];

  // ----- ۱) اعتبارسنجی پسوند -----
  const name = file.name || '';
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xls') {
    toast(`فرمت فایل «${escapeHtml(name)}» مجاز نیست. فقط <b>.xlsx</b> یا <b>.xls</b>`, 'error');
    return;
  }

  // حالت بارگذاری روی کارت
  const dropzone = document.getElementById(`drop-${targetKey}`);
  dropzone.classList.add('loading');

  try {
    // ----- ۲) خواندن و تجزیهٔ فایل -----
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

    if (!firstSheet) {
      throw new Error('هیچ شیتی در فایل یافت نشد.');
    }

    // تبدیل به آرایهٔ اشیا با کلید = عنوان ستون‌ها (ردیف اول = هدر)
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

    if (!rows.length) {
      throw new Error('فایل خالی است؛ هیچ ردیف داده‌ای برای ذخیره وجود ندارد.');
    }

    // ----- ۳) بررسی ستون «نوع فیلم» -----
    const headers = Object.keys(rows[0]);
    const filmKey = findFilmTypeKey(headers);
    if (!filmKey) {
      throw new Error(
        `ستون «نوع فیلم» در این فایل یافت نشد. احتمالاً فایل انتخاب‌شده «${target.expectedFile}» نیست. ` +
        `ستون‌های یافت‌شده: ${headers.slice(0, 6).join('، ')}…`
      );
    }

    // ----- ۴) ذخیره در پایگاه‌داده (جایگزینی کامل) -----
    const records = rows.map((row) => ({
      filmType: String(row[filmKey] ?? '').trim(), // مقدار «نوع فیلم» برای فیلتر سریع
      data: row,                                    // کل ردیف برای پیش‌نمایش
    }));

    // شمارش ردیف‌های منطبق (حرف دوم = R) برای نمایش سریع به کاربر
    const matched = records.filter((r) => isRFilm(r.filmType)).length;

    await db.transaction('rw', db[target.table], db.meta, async () => {
      await db[target.table].clear();               // حذف داده‌های قبلی همان جدول
      await db[target.table].bulkAdd(records);      // درج انبوه ردیف‌های جدید
      await db.meta.put({                           // ثبت اطلاعات این ایمپورت
        key: target.metaKey,
        fileName: name,
        totalRows: records.length,
        matchedRows: matched,
        importedAt: Date.now(),
      });
    });

    toast(
      `فایل «${escapeHtml(name)}» با موفقیت وارد شد — ` +
      `<b>${faNum(records.length)}</b> ردیف ذخیره شد`,
      'success'
    );

    // به‌روزرسانی کل رابط کاربری (داشبورد + کارت ایمپورت)
    await Promise.all([refreshDashboard(), refreshImportCard(targetKey)]);
  } catch (err) {
    // مدیریت خطا: نمایش پیام دقیق به کاربر (بدون افشای جزئیات فنی)
    console.error('[ایمپورت]', err);
    toast(escapeHtml(err.message || 'خطای ناشناخته هنگام خواندن فایل رخ داد.'), 'error', 6500);
  } finally {
    dropzone.classList.remove('loading');
  }
}

/** ساخت جدول پیش‌نمایش برای ۲۰ ردیف اول داده‌های ذخیره‌شده */
function renderPreviewTable(elId, rows) {
  const table = document.getElementById(elId);
  if (!rows.length) return;

  const headers = Object.keys(rows[0].data).slice(0, PREVIEW_COLS);

  const thead = '<thead><tr>' +
    headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('') +
    '</tr></thead>';

  const tbody = '<tbody>' + rows.map((r) => {
    const cells = headers.map((h) => {
      const v = String(r.data[h] ?? '').trim();
      const isFilm = normalizeHeader(h) === 'نوعفیلم';
      const cls = isFilm ? (isRFilm(v) ? 'film-r' : '') : '';
      return v
        ? `<td class="${cls}">${escapeHtml(v)}</td>`
        : '<td class="empty-cell">—</td>';
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('') + '</tbody>';

  table.innerHTML = thead + tbody;
}

/** به‌روزرسانی کارت وضعیت ایمپورت هر فایل (نام فایل، تاریخ، آمار) */
async function refreshImportCard(targetKey) {
  const target = IMPORT_TARGETS[targetKey];
  const statusEl = document.getElementById(`status-${targetKey}`);
  const previewWrap = document.getElementById(`preview-wrap-${targetKey}`);

  const info = await db.meta.get(target.metaKey);

  if (!info) {
    statusEl.className = 'import-status';
    statusEl.innerHTML = '<p class="status-empty">هنوز فایلی بارگذاری نشده است.</p>';
    previewWrap.hidden = true;
    return;
  }

  statusEl.className = 'import-status ok';
  statusEl.innerHTML = `
    <div class="status-row">
      <span class="status-icon ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></span>
      <b>${escapeHtml(info.fileName)}</b>
    </div>
    <div class="status-row">
      تاریخ ورود: <b>${faDate(info.importedAt)}</b>
       | مجموع ردیف‌ها: <span class="num">${faNum(info.totalRows)}</span>
       | ردیف‌های منطبق (حرف دوم = R): <span class="num">${faNum(info.matchedRows)}</span>
    </div>
  `;

  // پیش‌نمایش چند ردیف اول از پایگاه‌داده
  const sample = await db[target.table].limit(PREVIEW_ROWS).toArray();
  renderPreviewTable(`preview-${targetKey}`, sample);
  previewWrap.hidden = false;
}

/** اتصال رویدادهای ناحیهٔ رهاکردن فایل و ورودی فایل برای هر هدف */
function initImportUI() {
  Object.keys(IMPORT_TARGETS).forEach((key) => {
    const dropzone = document.getElementById(`drop-${key}`);
    const input = document.getElementById(`file-${key}`);

    // کلیک یا Enter/Space روی ناحیه → باز کردن پنجرهٔ انتخاب فایل
    dropzone.addEventListener('click', () => input.click());
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });

    // انتخاب فایل از پنجرهٔ سیستم
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) {
        importExcelFile(key, input.files[0]);
        input.value = ''; // اجازهٔ انتخاب مجدد همان فایل
      }
    });

    // قابلیت کشیدن و رهاکردن (Drag & Drop)
    ['dragenter', 'dragover'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) importExcelFile(key, file);
    });
  });
}

/* =========================================================================
   بخش ۶) مدیریت رول‌های ستاپ (ثبت / حذف / نمایش)
   ========================================================================= */

/** پیکربندی فیلدهای فرم: کلید، شناسهٔ ورودی، شناسهٔ خطا، پیام خطا */
const FIELD_CONFIG = [
  { key: 'setupNumber',   inputId: 'f-setup',   errId: 'err-setup', min: 0, integer: true,  message: 'شمارهٔ ستاپ را وارد کنید (عدد صحیح و نامنفی).' },
  { key: 'machineNumber', inputId: 'f-machine', errId: 'err-machine', min: 0, integer: true,  message: 'شمارهٔ دستگاه را وارد کنید (عدد صحیح و نامنفی).' },
  { key: 'rollWidth',     inputId: 'f-width',   errId: 'err-width', min: 1, integer: false, message: 'عرض رول باید عددی بزرگ‌تر از صفر باشد.' },
  { key: 'rollType',      inputId: 'f-type',    errId: 'err-type', text: true, message: 'نوع رول را وارد کنید (مثلاً FRN21).' },
  { key: 'rollCount',     inputId: 'f-count',   errId: 'err-count', min: 1, integer: true,  message: 'تعداد رول باید عدد صحیح و حداقل ۱ باشد.' },
];

/** مراجع کوتاه به عناصر فرم */
const setupForm = document.getElementById('setup-form');
const fields = Object.fromEntries(
  FIELD_CONFIG.map((f) => [f.key, document.getElementById(f.inputId)])
);

/** اعتبارسنجی کامل فرم؛ خروجی: رکورد معتبر یا null */
function validateSetupForm() {
  const record = { createdAt: Date.now() };
  let allValid = true;

  // بررسی تک‌تک فیلدها بر اساس پیکربندی + نمایش خطای زیر همان فیلد
  for (const cfg of FIELD_CONFIG) {
    const input = fields[cfg.key];
    const errEl = document.getElementById(cfg.errId);
    const rawValue = String(input.value ?? '').trim();

    let valid;
    if (cfg.text) {
      // فیلد متنی: غیرخالی و حداکثر ۳۰ کاراکتر
      valid = rawValue.length > 0 && rawValue.length <= 30;
      record[cfg.key] = rawValue;
    } else {
      // فیلد عددی: عدد، صحیح بودن (در صورت نیاز) و حداقل مجاز
      const num = Number(rawValue);
      valid = rawValue !== '' && Number.isFinite(num) && num >= cfg.min
              && (!cfg.integer || Number.isInteger(num));
      record[cfg.key] = valid ? num : rawValue;
    }

    input.classList.toggle('invalid', !valid);
    if (errEl) {
      errEl.textContent = valid ? '' : cfg.message;
      errEl.hidden = valid;
    }
    if (!valid) allValid = false;
  }

  return allValid ? record : null;
}

/** رویداد ثبت رکورد جدید */
setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const record = validateSetupForm();
  if (!record) {
    toast('لطفاً خطاهای فرم را برطرف کنید.', 'warning');
    return;
  }

  try {
    await db.setupRolls.add(record);
    toast(
      `رکورد جدید ذخیره شد — ستاپ <b>${faNum(record.setupNumber)}</b>، ` +
      `دستگاه <b>${faNum(record.machineNumber)}</b>، تعداد <b>${faNum(record.rollCount)}</b> رول`,
      'success'
    );

    setupForm.reset();
    document.querySelectorAll('.field-error').forEach((el) => (el.hidden = true));
    document.querySelectorAll('.field input').forEach((el) => el.classList.remove('invalid'));

    await Promise.all([renderSetupTable(), refreshDashboard()]);

    // بازگشت فوکوس به اولین فیلد برای ورود سریع رکورد بعدی
    fields.setupNumber.focus();
  } catch (err) {
    console.error('[ثبت رول ستاپ]', err);
    toast('خطا در ذخیرهٔ رکورد در پایگاه‌داده.', 'error');
  }
});

/** حذف خطاهای فرم هنگام تایپ مجدد */
Object.values(fields).forEach((input) => {
  input.addEventListener('input', () => {
    input.classList.remove('invalid');
    const errEl = input.closest('.field')?.querySelector('.field-error');
    if (errEl) errEl.hidden = true;
  });
});

/** حذف یک رکورد با تأیید کاربر */
async function deleteSetupRoll(id) {
  const ok = await confirmDialog(
    'حذف رکورد',
    'آیا از حذف این رکورد رول ستاپ مطمئن هستید؟ این عمل بازگشت‌پذیر نیست.'
  );
  if (!ok) return;

  try {
    await db.setupRolls.delete(id);
    toast('رکورد با موفقیت حذف شد.', 'success');
    await Promise.all([renderSetupTable(), refreshDashboard()]);
  } catch (err) {
    console.error('[حذف رکورد]', err);
    toast('خطا در حذف رکورد.', 'error');
  }
}

/** حذف تمام رکوردها با تأیید کاربر */
async function clearAllSetups() {
  const count = await db.setupRolls.count();
  if (!count) return;

  const ok = await confirmDialog(
    'حذف همهٔ رکوردها',
    `تمام ${faNum(count)} رکورد رول ستاپ حذف خواهد شد. آیا مطمئن هستید؟`
  );
  if (!ok) return;

  try {
    await db.setupRolls.clear();
    toast('همهٔ رکوردها حذف شدند.', 'success');
    await Promise.all([renderSetupTable(), refreshDashboard()]);
  } catch (err) {
    console.error('[حذف همه]', err);
    toast('خطا در حذف رکوردها.', 'error');
  }
}

/** رندر جدول رول‌های ستاپ از پایگاه‌داده */
async function renderSetupTable() {
  const wrap = document.getElementById('setup-table-wrap');
  const chipRecords = document.getElementById('chip-records');
  const chipTotal = document.getElementById('chip-total');
  const btnClear = document.getElementById('btn-clear-setups');

  // مرتب‌سازی بر اساس زمان ثبت (جدیدترین اول)
  const records = await db.setupRolls.orderBy('id').reverse().toArray();
  const totalRolls = records.reduce((sum, r) => sum + (r.rollCount || 0), 0);

  chipRecords.textContent = `${faNum(records.length)} رکورد`;
  chipTotal.textContent = `مجموع: ${faNum(totalRolls)} رول`;
  btnClear.hidden = records.length === 0;

  if (!records.length) {
    wrap.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/></svg>
        <p>هنوز هیچ رولی برای ستاپ‌ها ثبت نشده است.<br>از فرم بالا اولین رکورد را وارد کنید.</p>
      </div>`;
    return;
  }

  const rowsHtml = records.map((r, i) => `
    <tr>
      <td>${faNum(i + 1)}</td>
      <td>${faNum(r.setupNumber)}</td>
      <td>${faNum(r.machineNumber)}</td>
      <td>${faNum(r.rollWidth)}</td>
      <td class="type-cell ltr">${escapeHtml(r.rollType)}</td>
      <td class="count-cell">${faNum(r.rollCount)}</td>
      <td>${faDate(r.createdAt)}</td>
      <td>
        <button type="button" class="btn btn-icon" data-del="${r.id}"
                aria-label="حذف رکورد شماره ${faNum(i + 1)}" title="حذف">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </td>
    </tr>`).join('');

  wrap.innerHTML = `
    <table class="data-table setup-table">
      <thead>
        <tr>
          <th>ردیف</th>
          <th>شماره ستاپ</th>
          <th>شماره دستگاه</th>
          <th>عرض رول (mm)</th>
          <th>نوع رول</th>
          <th>تعداد رول</th>
          <th>تاریخ ثبت</th>
          <th>عملیات</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

  // اتصال رویداد حذف به دکمه‌های هر ردیف
  wrap.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => deleteSetupRoll(Number(btn.dataset.del)));
  });
}

/* =========================================================================
   بخش ۷) داشبورد — محاسبهٔ ۴ شاخص اصلی
   ========================================================================= */

/**
 * محاسبه و نمایش چهار شاخص:
 *   ۱) رول‌های خام        = شمار ردیف‌های rolls که isRFilm ≡ true
 *   ۲) رول‌های متالایز    = شمار ردیف‌های archivedRolls که isRFilm ≡ true
 *   ۳) کل رول‌های ستاپ‌ها  = جمع فیلد rollCount در جدول setupRolls
 *   ۴) رول‌های برش‌نشده    = شاخص ۳ − (شاخص ۱ + شاخص ۲)
 */
async function refreshDashboard() {
  // خواندن هم‌زمان هر سه منبع داده
  const [rollsRows, archivedRows, setupRows, rollsInfo, archivedInfo] = await Promise.all([
    db.rolls.toArray(),
    db.archivedRolls.toArray(),
    db.setupRolls.toArray(),
    db.meta.get('rollsInfo'),
    db.meta.get('archivedInfo'),
  ]);

  // ----- شاخص ۱: رول‌های خام -----
  const rawRolls = rollsRows.filter((r) => isRFilm(r.filmType)).length;

  // ----- شاخص ۲: رول‌های متالایز شده -----
  const metallizedRolls = archivedRows.filter((r) => isRFilm(r.filmType)).length;

  // ----- شاخص ۳: مجموع تعداد رول‌های ستاپ‌ها -----
  const totalSetupRolls = setupRows.reduce((sum, r) => sum + (r.rollCount || 0), 0);

  // ----- شاخص ۴: رول‌های برش‌نشده -----
  const uncutRolls = totalSetupRolls - (rawRolls + metallizedRolls);

  // ----- به‌روزرسانی کارت‌ها -----
  document.getElementById('kpi-raw').textContent = faNum(rawRolls);
  document.getElementById('kpi-metallized').textContent = faNum(metallizedRolls);
  document.getElementById('kpi-setup-total').textContent = faNum(totalSetupRolls);
  document.getElementById('kpi-uncut').textContent = faNum(uncutRolls);

  // توضیح زیر هر کارت
  document.getElementById('kpi-raw-meta').innerHTML = rollsInfo
    ? `فایل: ${escapeHtml(rollsInfo.fileName)} — از ${faNum(rollsInfo.totalRows)} ردیف (${faDate(rollsInfo.importedAt)})`
    : 'در انتظار بارگذاری فایل رول‌های موجود…';

  document.getElementById('kpi-metallized-meta').innerHTML = archivedInfo
    ? `فایل: ${escapeHtml(archivedInfo.fileName)} — از ${faNum(archivedInfo.totalRows)} ردیف (${faDate(archivedInfo.importedAt)})`
    : 'در انتظار بارگذاری فایل سابقه رول‌ها…';

  document.getElementById('kpi-setup-meta').innerHTML = setupRows.length
    ? `${faNum(setupRows.length)} رکورد ثبت‌شده در پنل «رول‌های ستاپ»`
    : 'هنوز رولی برای ستاپ‌ها ثبت نشده است';

  const uncutMeta = document.getElementById('kpi-uncut-meta');
  if (uncutRolls < 0) {
    uncutMeta.innerHTML = '⚠ مقدار منفی! مجموع خام و متالایز از کل رول‌های ستاپ‌ها بیشتر است.';
  } else {
    uncutMeta.textContent = `${faNum(totalSetupRolls)} − (${faNum(rawRolls)} + ${faNum(metallizedRolls)}) = ${faNum(uncutRolls)}`;
  }

  // کلاس هشدار برای مقدار منفی
  document.getElementById('kpi-uncut').closest('.kpi-card')
    .classList.toggle('negative', uncutRolls < 0);

  // جعبهٔ فرمول زنده
  const formulaBox = document.getElementById('formula-box');
  formulaBox.innerHTML =
    `رول‌های برش‌نشده = ${faNum(totalSetupRolls)} − (${faNum(rawRolls)} + ${faNum(metallizedRolls)}) = <b>${faNum(uncutRolls)}</b>`;
  formulaBox.classList.toggle('negative', uncutRolls < 0);

  // نقطه‌های هشدار روی تب‌ها (وقتی داده‌ای وارد نشده)
  document.getElementById('dot-import').hidden = !(!rollsInfo || !archivedInfo);
  document.getElementById('dot-setup').hidden = setupRows.length > 0;
}

/* =========================================================================
   بخش ۸) رویدادهای اولیه و شروع برنامه
   ========================================================================= */

/** بررسی سلامت کتابخانه‌های لوکال و اتصال به پایگاه‌داده */
async function initApp() {
  const badgeDb = document.getElementById('badge-db');
  const badgeDbText = document.getElementById('badge-db-text');

  // اگر فایل‌های لوکال lib/ در دسترس نباشند، پیام دقیق نمایش داده می‌شود
  if (typeof Dexie === 'undefined' || typeof XLSX === 'undefined') {
    badgeDb.classList.add('err');
    badgeDbText.textContent = 'خطای کتابخانه‌ها';
    document.querySelector('.app-main').innerHTML = `
      <article class="panel" style="margin-top:24px;border-color:rgba(239,68,68,.5)">
        <h3 class="section-title" style="color:#fda4af">خطای بارگذاری کتابخانه‌ها</h3>
        <p class="panel-desc" style="line-height:2.2">
          فایل‌های <code>lib/dexie.min.js</code> یا <code>lib/xlsx.full.min.js</code> کنار
          <code>index.html</code> یافت نشدند.<br>
          لطفاً مطابق راهنمای فایل <code>README.md</code>، این دو فایل را در پوشهٔ <code>lib</code> قرار دهید.
        </p>
      </article>`;
    return;
  }

  try {
    await db.open();
    badgeDb.classList.add('ok');
    badgeDbText.textContent = 'پایگاه‌داده آماده';

    initTabs();
    initImportUI();
    document.getElementById('btn-clear-setups')
      .addEventListener('click', clearAllSetups);

    // بازیابی وضعیت قبلی (داده‌های ماندگار در IndexedDB)
    await Promise.all([
      refreshDashboard(),
      refreshImportCard('rolls'),
      refreshImportCard('archived'),
      renderSetupTable(),
    ]);

    console.info('✅ سامانهٔ مانیتورینگ رول‌ها آماده است — حالت کاملاً آفلاین');
  } catch (err) {
    console.error('[شروع برنامه]', err);
    badgeDb.classList.add('err');
    badgeDbText.textContent = 'خطای پایگاه‌داده';
    toast(
      'اتصال به پایگاه‌دادهٔ محلی ممکن نشد. اگر مرورگر در حالت خصوصی است، آن را ببندید و مجدداً تلاش کنید.',
      'error',
      8000
    );
  }
}

// نقطهٔ شروع: پس از آماده‌شدن کامل DOM
document.addEventListener('DOMContentLoaded', initApp);
