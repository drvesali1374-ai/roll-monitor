/* =========================================================================
   views/import.js — نما ورود داده‌ها (§10-§12، §89)
   -------------------------------------------------------------------------
   فرایند: انتخاب/رهاکردن فایل → تجزیه → گزارشنمای اعتبارسنجی (§11)
   → تأیید جایگزینی با آمار قدیم/جدید (§89) → ذخیرهٔ تراکنشی → رفرش کل.
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const UI = RM.ui;
  const Import = RM.importEngine;
  const db = RM.db.db;

  const ImportView = {};

  /* ---------------- راه‌اندازی رویدادها ---------------- */

  ImportView.init = function () {
    for (const key of Object.keys(RM.config.IMPORT_TARGETS)) {
      /* نسخهٔ ۳٫۱۲ — اهداف دارای customUi (فایل پالت‌ها) رابط Import اختصاصی
         در صفحهٔ خودشان دارند؛ در تب «ورود داده‌ها» عنصری ندارند و باید رد شوند. */
      if (RM.config.IMPORT_TARGETS[key].customUi) continue;

      const dropzone = document.getElementById(`drop-${key}`);
      const input = document.getElementById(`file-${key}`);

      // کلیک یا کیبورد → باز کردن پنجرهٔ انتخاب فایل
      dropzone.addEventListener('click', () => input.click());
      dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.click();
        }
      });

      // انتخاب فایل
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
          ImportView.handleFile(key, input.files[0]);
          input.value = '';
        }
      });

      // کشیدن و رهاکردن
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
        if (file) ImportView.handleFile(key, file);
      });
    }
  };

  /* ---------------- فرایند Import یک فایل ---------------- */

  ImportView.handleFile = async function (targetKey, file) {
    const dropzone = document.getElementById(`drop-${targetKey}`);
    dropzone.classList.add('loading');

    try {
      // اجرای فرایند کامل Import با تأیید جایگزینی (§89)
      const result = await Import.run(targetKey, file, { confirm: UI.confirm });

      if (result.cancelled) {
        UI.toast('عملیات Import لغو شد؛ داده‌های قبلی دست‌نخورده باقی ماند.', 'info');
        return;
      }

      const { parsed, datasetVersion, sameFileWarning } = result;

      // اعلان موفقیت
      UI.toast(
        `فایل «${U.escapeHtml(parsed.fileName)}» وارد شد — ${U.faNum(parsed.totalRecords)} رکورد ` +
        `(Dataset #${U.faNum(datasetVersion)})`,
        'success'
      );
      if (sameFileWarning) {
        UI.toast('محتوای فایل با آخرین Import یکسان بود (هش یکسان).', 'warning', 6000);
      }

      // رفرش کل سیستم (محاسبات + همهٔ نماها — §90)
      await RM.refreshAll();

      // رندر کارت همان هدف با گزارشنما
      await ImportView.renderCard(targetKey);
    } catch (err) {
      // مدیریت خطا (§72) — پیام دقیق بدون جزئیات فنی
      console.error('[Import]', err.message);
      UI.toast(U.escapeHtml(err.message || 'خطای ناشناخته هنگام خواندن فایل.'), 'error', 7000);

      // نمایش خطا در کارت وضعیت
      const statusEl = document.getElementById(`status-${targetKey}`);
      if (statusEl) {
        statusEl.className = 'import-status err';
        statusEl.innerHTML = `<div class="status-row"><span class="status-icon err">${UI.icons.cross}</span>
          <b>${U.escapeHtml(err.message)}</b></div>`;
      }
    } finally {
      dropzone.classList.remove('loading');
    }
  };

  /* ---------------- رندر کارت Import (متادیتا + گزارشنما §11-§12) ---------------- */

  ImportView.renderCard = async function (targetKey) {
    const statusEl = document.getElementById(`status-${targetKey}`);
    const previewWrap = document.getElementById(`preview-wrap-${targetKey}`);
    const table = RM.config.IMPORT_TARGETS[targetKey].table;

    const entries = await db.importMetadata
      .where('target').equals(targetKey)
      .reverse()
      .sortBy('importedAt');
    const info = entries[0];

    if (!info) {
      statusEl.className = 'import-status';
      statusEl.innerHTML = '<p class="status-empty">هنوز فایلی بارگذاری نشده است.</p>';
      previewWrap.hidden = true;
      return;
    }

    // ------- گزارشنمای اعتبارسنجی (§11) — موارد مشکل‌دار قابل کلیک -------
    const issues = info.issues || { width: 0, length: 0, thickness: 0, setupNumber: 0, rollNumber: 0, filmType: 0 };
    const label = RM.config.DATASET_LABELS[targetKey];

    /** سطر گزارسنما: اگر مقدار > 0 باشد قابل کلیک است (Drill-down همان رکوردها) */
    const row = (issueKey, labelTxt, value, warn) => {
      const content = warn
        ? `<span class="status-icon err">${UI.icons.warning}</span>${labelTxt}: <b class="num-warn">${U.faNum(value)}</b>`
        : `<span class="status-icon ok">${UI.icons.check}</span>${labelTxt}: <span class="num">${U.faNum(value)}</span>`;
      return warn
        ? `<button type="button" class="status-row status-row-link" data-drill-issue="${issueKey}"
             title="نمایش دقیق همین رکوردهای مشکل‌دار">${content} <span class="drill-hint">مشاهده ←</span></button>`
        : `<div class="status-row">${content}</div>`;
    };

    // Mapping ناقص — فیلدهای تنظیم‌شدهٔ کاربر که در فایل نبوده‌اند
    const gaps = Array.isArray(info.mappingGaps) ? info.mappingGaps : [];
    const gapsHtml = gaps.length
      ? `<div class="status-row"><span class="status-icon err">${UI.icons.warning}</span>
           <span class="num-warn">Mapping ناقص:</span>
           ${gaps.map((g) => RM.config.FIELD_LABELS[g.field] || g.field).join('، ')} — ستون در فایل یافت نشد
         </div>`
      : '';

    statusEl.className = 'import-status ok';
    statusEl.innerHTML = `
      <div class="status-row">
        <span class="status-icon ok">${UI.icons.check}</span>
        <b>${U.escapeHtml(info.fileName)}</b>
        <span class="chip">${label}</span>
        <span class="chip">Dataset #${U.faNum(info.datasetVersion)}</span>
        <span class="chip chip-ok">وضعیت: ${info.status === 'ok' ? 'موفق' : (info.status || '—')}</span>
        ${info.fileHash ? `<span class="chip" title="هش فایل">#${U.escapeHtml(info.fileHash)}</span>` : ''}
      </div>
      <div class="report-grid">
        ${row('total', 'کل رکوردها', info.totalRecords, false)}
        ${targetKey === 'rolls' ? row('raw', 'رول خام شناسایی‌شده', info.rawRolls, false) : ''}
        ${targetKey === 'archived' ? row('unique', 'متالایز یونیک', info.rawRolls, false) : ''}
        ${row('width', 'بدون عرض', issues.width || 0, (issues.width || 0) > 0)}
        ${row('length', 'بدون متراژ', issues.length || 0, (issues.length || 0) > 0)}
        ${row('thickness', 'بدون ضخامت', issues.thickness || 0, (issues.thickness || 0) > 0)}
        ${(issues.rollNumber || 0) > 0 ? row('rollNumber', 'بدون شماره رول', issues.rollNumber, true) : ''}
        ${(issues.filmType || 0) > 0 ? row('filmType', 'نوع فیلم خالی', issues.filmType, true) : ''}
      </div>
      ${gapsHtml}
      <div class="status-row muted">تاریخ: ${U.faDate(info.importedAt)} · شییت: ${U.escapeHtml(info.sheetName || '—')}</div>
    `;

    // ------- Drill-down: کلیک روی مشکل → دقیقاً همان رکوردهای عامل -------
    statusEl.querySelectorAll('[data-drill-issue]').forEach((btn) => {
      btn.addEventListener('click', () => ImportView.showIssueDrill(targetKey, btn.dataset.drillIssue, label));
    });

    // ------- پیش‌نمایش ردیف‌ها (تغییر ۳: با اعمال ویرایش‌های کاربر) -------
    const sample = await db[table].limit(RM.config.PREVIEW_ROWS).toArray();
    ImportView.renderPreview(targetKey, await RM.edits.applyToRecords(targetKey, sample));
    previewWrap.hidden = false;
  };

  /** نمایش رکوردهای عامل یک مشکل — مودال مشترک با ستون‌های Mapping کاربر
   *  (تغییر ۳: ویرایش‌های کاربر روی رکوردها اعمال می‌شود)
   *  ۳٫۱۷ بند ۹: رول‌هایی که «در لحظهٔ Import» این مشکل را داشته‌اند ولی
   *  کاربر با دکمهٔ ویرایش (جدول‌های «لیست رول های موجود» / «لیست سابقه
   *  رول ها») اصلاح کرده است، دیگر در فهرست رکوردهای فعلی دیده نمی‌شوند؛
   *  همین رول‌ها اکنون از «لیست رول‌های ویرایش‌شده» با نمایش قبل/بعدِ
   *  هر فیلد و تاریخ ویرایش جداگانه نمایش داده می‌شوند تا کاربر بداند
   *  چه اصلاحی روی همان رول انجام شده و کی ویرایش شده است. */
  ImportView.showIssueDrill = async function (targetKey, issueKey, label) {
    const table = RM.config.IMPORT_TARGETS[targetKey].table;

    /* رکوردهای خام فایل (بدون ویرایش) — مبنای تشخیص «در لحظهٔ Import مشکل داشته» */
    const rawAll = await db[table].toArray();
    /* نسخهٔ فعلی = رکوردهای خام + ویرایش‌های ذخیره‌شده (روی کپی اعمال می‌شود) */
    const currentAll = await RM.edits.applyToRecords(
      targetKey, rawAll.map((r) => ({ ...r })));
    const currentByKey = new Map(currentAll.map((r) => [String(r._editKey ?? r.rollNumber ?? ''), r]));

    /* ویرایش‌های همین منبع — برای تاریخ ویرایش و فیلدهای تغییرکرده */
    const edits = await RM.edits.getFor(targetKey);
    const editByRoll = new Map(edits.map((e) => [String(e.rollNumber), e]));

    /* رکوردهای دارای مشکل در لحظهٔ Import (روی دیتای خام — همان معیار شمارش گزارشنما) */
    const rawIssues = RM.normalize.recordsWithIssue(rawAll, issueKey);
    const still = [];
    const fixed = [];
    for (const raw of rawIssues) {
      const key = String(raw.rollNumber ?? '');
      const cur = currentByKey.get(key) || raw;
      const curHasIssue = RM.normalize.recordsWithIssue([cur], issueKey).length > 0;
      if (curHasIssue) {
        still.push(cur);                      // هنوز مشکل دارد (فعلی)
      } else {
        const edit = editByRoll.get(key) || null;
        fixed.push({ raw, cur, edit });       // با ویرایش کاربر اصلاح شده است
      }
    }

    const titles = {
      width: 'رکوردهای بدون عرض',
      length: 'رکوردهای بدون متراژ',
      thickness: 'رکوردهای بدون ضخامت',
      rollNumber: 'رکوردهای بدون شماره رول',
      filmType: 'رکوردهای بدون نوع فیلم',
    };

    /* برچسب فیلدها برای نمایش قبل/بعد */
    const labels = await RM.normalize.effectiveColumnLabels(targetKey);
    const fieldLabel = (f) => labels[f] || RM.config.FIELD_LABELS[f] || f;
    const issueField = issueKey === 'length' ? 'actualLength' : issueKey;

    const fmtVal = (v) => {
      if (v === null || v === undefined || v === '') return '<span class="num-warn">خالی</span>';
      if (typeof v === 'number') return U.faNum(v);
      return U.escapeHtml(String(v));
    };

    UI.infoModal(`${titles[issueKey] || 'رکوردهای مشکل‌دار'} — ${label}`, `
      <div class="drill-subtitle">
        شمارش گزارشنمای Import همان لحظهٔ ورود فایل است و با ویرایش‌های بعدی تغییر نمی‌کند —
        <b>${U.faNum(rawIssues.length)}</b> رکورد در لحظهٔ Import این مشکل را داشت:
        <b>${U.faNum(still.length)}</b> هنوز مشکل دارد ·
        <b>${U.faNum(fixed.length)}</b> با ویرایش کاربر اصلاح شده است.
      </div>
      ${fixed.length ? `
        <h4 class="pack-modal-title">رول‌های ویرایش‌شده و اصلاح‌شده (${U.faNum(fixed.length)}) — از لیست «رول‌های ویرایش‌شده»</h4>
        <p class="muted" style="font-size:.72rem;margin:-6px 0 10px">
          این رول‌ها هنگام ورود فایل بدون مقدار بودند؛ مقادیر فعلی، حاصل ویرایش کاربر است (قبل ← بعد).
          فهرست کامل ویرایش‌ها در تب «ورود داده‌ها ← لیست رول‌ها ← رول‌های ویرایش‌شده» است.
        </p>
        <div class="edited-fixed-list">
          ${fixed.map(({ raw, cur, edit }) => `
            <div class="edited-fixed-item">
              <div class="edited-fixed-head">
                <b class="ltr">${U.escapeHtml(cur.rollNumber || raw.rollNumber || 'بدون شماره')}</b>
                <span class="chip chip-ok" title="این رول در لحظهٔ Import مشکل‌دار بود و با ویرایش اصلاح شد">✎ اصلاح‌شده با ویرایش</span>
                ${edit && edit.updatedAt ? `<span class="muted" style="font-size:.7rem">ویرایش: ${U.faDate(edit.updatedAt)}</span>` : ''}
              </div>
              <div class="edited-fixed-fields">
                ${(edit && edit.fields ? Object.keys(edit.fields) : [issueField]).map((f) => `
                  <span class="edited-field-chip" title="${U.escapeHtml(fieldLabel(f))}: مقدار لحظهٔ Import ← مقدار فعلی (ویرایش‌شده)">
                    ${U.escapeHtml(fieldLabel(f))}:
                    <s class="edited-before">${fmtVal(raw[f])}</s> ←
                    <b class="edited-after">${fmtVal(cur[f])}</b>
                  </span>`).join('')}
              </div>
            </div>`).join('')}
        </div>` : ''}
      <h4 class="pack-modal-title">رکوردهای همچنان مشکل‌دار (${U.faNum(still.length)})</h4>
      <div id="drill-cols-picker"></div>
      <div id="drill-table-wrap"></div>
    `, { wide: true });

    // رندر جدول با ستون‌های جاری (نسخهٔ ۳٫۴ — پس از هر تغییر پنل شخصی‌سازی دوباره صدا می‌شود)
    const renderTable = async () => {
      const columns = await UI.rollDetailColumns(targetKey);
      const tableEl = document.getElementById('drill-table-wrap');
      const renderPage = (page) => {
        UI.renderTable(tableEl, columns, still, {
          page,
          pageSize: RM.config.PAGE_SIZE,
          emptyText: fixed.length
            ? 'رکورد فعلیِ مشکل‌داری نمانده — همهٔ رکوردهای این دسته با ویرایش کاربر اصلاح شده‌اند (فهرست بالا).'
            : 'رکوردی برای نمایش یافت نشد.',
          onPageChange: (nextPage) => renderPage(nextPage),
        });
      };
      renderPage(1);
    };

    // پنل شخصی‌سازی ستون‌های جزئیات (نسخهٔ ۳٫۴) — مشترک با مودال گروه‌های خام؛
    // پس از هر تغییر، چیپ‌های پنل و جدول هر دو درجا بازسازی می‌شوند (مودال باز می‌ماند)
    const mountPicker = async () => {
      await UI.mountDetailColsPicker(
        document.getElementById('drill-cols-picker'),
        targetKey,
        async () => {
          await mountPicker();
          await renderTable();
        }
      );
    };
    await Promise.all([mountPicker(), renderTable()]);
  };

  /** رندر جدول پیش‌نمایش نرمال‌شده (مدل داخلی — نه ستون‌های خام) */
  ImportView.renderPreview = function (targetKey, records) {
    const wrapEl = document.getElementById(`preview-inner-${targetKey}`);
    if (!wrapEl || !records.length) return;

    const columns = [
      { key: 'rollNumber', label: 'شماره رول', className: 'ltr' },
      { key: 'width', label: 'عرض', render: (r) => r.width === null ? '<span class="muted">—</span>' : U.faWidth(r.width) },
      { key: 'actualLength', label: 'متراژ', render: (r) => r.actualLength === null ? '<span class="muted">—</span>' : U.faNum(r.actualLength) },
      { key: 'thickness', label: 'ضخامت', render: (r) => r.thickness === null ? '<span class="muted">—</span>' : U.faNum(r.thickness) },
      {
        key: 'filmType', label: 'نوع فیلم',
        render: (r) => {
          const isR = RM.normalize.hasR(r.filmType);
          return isR
            ? `<span class="film-r">${U.escapeHtml(r.filmType)}</span>`
            : U.escapeHtml(r.filmType || '—');
        },
      },
      { key: 'palletNumber', label: 'پالت', render: (r) => U.escapeHtml(r.palletNumber || '—') },
      { key: 'setupNumber', label: 'ستاپ', render: (r) => r.setupNumber === null ? '<span class="muted">—</span>' : U.faNum(r.setupNumber) },
    ];

    UI.renderTable(wrapEl, columns, records, { pageSize: RM.config.PREVIEW_ROWS });
  };

  /** رندر کامل نما (هنگام شروع برنامه) */
  ImportView.render = async function () {
    for (const key of Object.keys(RM.config.IMPORT_TARGETS)) {
      // نسخهٔ ۳٫۱۲ — اهداف customUi رابط اختصاصی دارند (صفحهٔ بسته‌بندی)
      if (RM.config.IMPORT_TARGETS[key].customUi) continue;
      await ImportView.renderCard(key);
    }
  };

  RM.views = RM.views || {};
  RM.views.importView = ImportView;
})();
