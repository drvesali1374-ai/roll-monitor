/* =========================================================================
   views/lists.js — زبانه‌های لیست رول‌ها در صفحهٔ «ورود داده‌ها» (تغییر ۳)
   -------------------------------------------------------------------------
   سه زبانه زیر دو کادر Import (مانند زبانه‌های صفحهٔ «رول‌ها»):
     ۱) «لیست رول های موجود»  — جدول همهٔ اطلاعات فایل رول‌های موجود
     ۲) «لیست سابقه رول ها»   — جدول همهٔ اطلاعات فایل سابقه (آرشیو)
     ۳) «رول‌های ویرایش‌شده»   — لیست رول‌های ویرایش‌شده + اطلاعات ویرایش
   امکانات هر جدول (دقیقاً مانند «گزارش تولید ستاپ‌ها»):
     - فیلتر «شامل بودن» زیر هر ستون (داینامیک با عرض ستون + دکمهٔ «≠»)
     - پنل مرتب‌سازی چندمرحله‌ای (کشیدنی + ماندگار)
     - پنل ترتیب ستون‌ها (کشیدنی + عرض px + «نمایش/مخفی‌کردن هر ستون»)
     - ویرایش هر رکورد (مودال تمام فیلدها → ذخیرهٔ ماندگار در جدول rollEdits)
   اطلاعات ویرایش‌شده از آن پس جایگزین اطلاعات فایل ایمپورت‌شده می‌شود
   (اعمال مرکزی در DB.loadAllSources — داشبورد/گزارش‌ها هم به‌روز می‌شوند)
   ========================================================================= */

'use strict';

(function () {
  const U = RM.utils;
  const UI = RM.ui;
  const DB = RM.db;
  const db = RM.db.db;
  const N = RM.normalize;

  /** فیلدهای متنی فرم ویرایش (بقیه از config — عددی/صحیح) */
  const TEXT_FIELDS = [
    'rollNumber', 'filmType', 'palletNumber', 'productionDate', 'grade', 'status',
  ];

  const ListsView = {
    /* وضعیت هر منبع — مستقل از دیگری */
    state: {
      rolls: {
        sortPipeline: null, filters: {}, sortPanelVisible: true, colsPanelVisible: true,
        columnOrder: null, columnWidths: null, hiddenCols: null, visibleRows: null,
        qualityPanelVisible: true,   // نسخهٔ ۲٫۹ — کادر جداگانهٔ کنترل‌های کیفیت
      },
      archived: {
        sortPipeline: null, filters: {}, sortPanelVisible: true, colsPanelVisible: true,
        columnOrder: null, columnWidths: null, hiddenCols: null, visibleRows: null,
        qualityPanelVisible: true,   // نسخهٔ ۲٫۹ — کادر جداگانهٔ کنترل‌های کیفیت
      },
    },
    editing: null,     // { sourceKey, recordId, imported, effective, editKey }
    _editedPage: 1,    // صفحهٔ جدول رول‌های ویرایش‌شده
  };

  /* ================================================================
     ۱) راه‌اندازی
     ================================================================ */

  ListsView.init = async function () {
    /* --- بارگذاری وضعیت ماندگار هر منبع --- */
    for (const src of ['rolls', 'archived']) {
      const st = ListsView.state[src];
      st.sortPipeline = await DB.getSetting(`list${cap(src)}Sort`, RM.config.LIST_DEFAULT_SORT);
      st.sortPanelVisible = await DB.getSetting(`list${cap(src)}SortPanelVisible`, true);
      st.colsPanelVisible = await DB.getSetting(`list${cap(src)}ColsPanelVisible`, true);
      st.visibleRows = await DB.getSetting(`list${cap(src)}VisibleRows`, RM.config.LIST_VISIBLE_ROWS);

      st.columnOrder = await DB.getSetting(
        `list${cap(src)}ColumnOrder`, RM.config.LIST_DEFAULT_COLUMN_ORDER[src]);
      st.columnWidths = Object.assign(
        {}, RM.config.LIST_DEFAULT_COLUMN_WIDTHS,
        (await DB.getSetting(`list${cap(src)}ColumnWidths`, {})) || {}
      );
      st.hiddenCols = await DB.getSetting(`list${cap(src)}HiddenCols`, []) || [];

      /* --- کادر جداگانهٔ کنترل‌های کیفیت (نسخهٔ ۲٫۹): وضعیت نمایش/مخفی ماندگار --- */
      st.qualityPanelVisible = await DB.getSetting(`list${cap(src)}QualityPanelVisible`, true);
      const qualityToggle = document.getElementById(`quality-toggle-${src}`);
      if (qualityToggle) {
        qualityToggle.addEventListener('click', () => {
          st.qualityPanelVisible = !st.qualityPanelVisible;
          DB.setSetting(`list${cap(src)}QualityPanelVisible`, st.qualityPanelVisible);
          ListsView.applyQualityVisibility(src);
        });
      }
      ListsView.applyQualityVisibility(src);

      /* --- مهاجرت نرم: کلیدهای جدید در جایگاه منطقی درج می‌شوند --- */
      if (Array.isArray(st.columnOrder)) {
        const defaults = RM.config.LIST_DEFAULT_COLUMN_ORDER[src];
        const missing = defaults.filter((k) => !st.columnOrder.includes(k));
        for (const key of missing) {
          const prevIndex = defaults.indexOf(key) - 1;
          const anchor = prevIndex >= 0 ? defaults[prevIndex] : null;
          const at = anchor !== null ? st.columnOrder.indexOf(anchor) : -1;
          if (at !== -1) st.columnOrder.splice(at + 1, 0, key);
          else st.columnOrder.push(key);
        }
        if (missing.length) await DB.setSetting(`list${cap(src)}ColumnOrder`, st.columnOrder);
      }

      ListsView.bindPanels(src);
    }

    /* --- زبانه‌های داخلی (محدود به همین صفحه — تداخلی با زبانه‌های «رول‌ها» ندارد)
           نسخهٔ ۳٫۱ — تغییر ۲: موقعیت اسکرول هر زیرنما مستقل ذخیره/بازگردانی می‌شود --- */
    document.querySelectorAll('#view-import .subtab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        // ذخیرهٔ اسکرول زیرنمای ترک‌شده (کلید نما:زیرنما)
        UI.saveCurrentScroll();

        document.querySelectorAll('#view-import .subtab-btn').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });
        const target = btn.dataset.ilsubview;
        document.querySelectorAll('#view-import .il-subview').forEach((el) => {
          const active = el.id === `ilsubview-${target}`;
          el.classList.toggle('active', active);
          el.hidden = !active;
        });

        // بازگردانی اسکرول ذخیره‌شدهٔ زیرنمای مقصد
        UI.restoreScrollPosition(UI.pageKeyOf(document.getElementById('view-import')));
      });
    });

    /* --- مودال ویرایش --- */
    document.getElementById('modal-edit-cancel').addEventListener('click', () => ListsView.closeEditModal());
    document.getElementById('modal-edit-save').addEventListener('click', () => ListsView.saveEditModal());
    document.getElementById('modal-edit').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) ListsView.closeEditModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('modal-edit').hidden) ListsView.closeEditModal();
    });
  };

  /** حرف اول بزرگ (برای کلیدهای تنظیمات: rolls → Rolls) */
  function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** اتصال دکمه‌ها/پنل‌های یک منبع */
  ListsView.bindPanels = function (src) {
    const st = ListsView.state[src];
    const id = (suffix) => document.getElementById(`list-${suffix}-${src}`);

    /* --- پنل مرتب‌سازی: افزودن/بازنشانی --- */
    const addSelect = id('sort-add-select');
    if (addSelect) {
      addSelect.innerHTML = '<option value="">افزودن فیلد…</option>' +
        Object.entries(RM.config.LIST_SORTABLE_FIELDS)
          .filter(([k]) => ListsView.editableFields(src).includes(k) || k === 'width' || k === 'cutWidth')
          .map(([k, v]) => `<option value="${k}">${U.escapeHtml(v.label)}</option>`)
          .join('');

      id('sort-add-btn').addEventListener('click', () => {
        const field = addSelect.value;
        if (!field) return;
        if (st.sortPipeline.some((s) => s.field === field)) {
          UI.toast('این فیلد قبلاً به مرتب‌سازی اضافه شده است.', 'info');
          return;
        }
        st.sortPipeline.push({ field, direction: 'asc' });
        DB.setSetting(`list${cap(src)}Sort`, st.sortPipeline);
        ListsView.renderTable(src);
      });

      id('sort-reset-btn').addEventListener('click', async () => {
        st.sortPipeline = JSON.parse(JSON.stringify(RM.config.LIST_DEFAULT_SORT));
        await DB.setSetting(`list${cap(src)}Sort`, st.sortPipeline);
        ListsView.renderTable(src);
        UI.toast('مرتب‌سازی به حالت پیش‌فرض بازگشت.', 'info');
      });
    }

    /* --- نمایش/مخفی پنل‌ها: ۳٫۹ — تغییر ۵ — دکمه‌ها به نوار بالای جدول منتقل
           شدند؛ کلیک از طریق opts.tools/onToolToggle در renderTable می‌رسد. --- */

    /* --- بازنشانی ترتیب/عرض/نمایش ستون‌ها --- */
    id('cols-reset-btn').addEventListener('click', async () => {
      st.columnOrder = [...RM.config.LIST_DEFAULT_COLUMN_ORDER[src]];
      st.columnWidths = { ...RM.config.LIST_DEFAULT_COLUMN_WIDTHS };
      st.hiddenCols = [];
      await DB.setSetting(`list${cap(src)}ColumnOrder`, st.columnOrder);
      await DB.setSetting(`list${cap(src)}ColumnWidths`, st.columnWidths);
      await DB.setSetting(`list${cap(src)}HiddenCols`, st.hiddenCols);
      ListsView.renderTable(src);
      UI.toast('ترتیب، عرض و نمایش ستون‌ها به حالت پیش‌فرض بازگشت.', 'info');
    });

    ListsView.applyPanelVisibility(src);
  };

  /** اعمال نمایش/مخفی پنل‌های یک منبع */
  ListsView.applyPanelVisibility = function (src) {
    const st = ListsView.state[src];
    const id = (suffix) => document.getElementById(`list-${suffix}-${src}`);

    /* ۳٫۹ — تغییر ۵: دکمه‌ها داخل نوار بالای جدول‌اند؛ builder ها مستقل از
       دکمه به‌روز می‌شوند تا در نبود جدول (حالت خالی) وضعیت پنل حفظ شود. */
    const sortBuilder = id('sort-builder');
    if (sortBuilder) sortBuilder.hidden = !st.sortPanelVisible;
    const sortToggle = id('sort-toggle');
    if (sortToggle) {
      sortToggle.setAttribute('aria-expanded', String(st.sortPanelVisible));
      sortToggle.classList.toggle('panel-on', st.sortPanelVisible);
    }

    const colsBuilder = id('cols-builder');
    if (colsBuilder) colsBuilder.hidden = !st.colsPanelVisible;
    const colsToggle = id('cols-toggle');
    if (colsToggle) {
      colsToggle.setAttribute('aria-expanded', String(st.colsPanelVisible));
      colsToggle.classList.toggle('panel-on', st.colsPanelVisible);
    }
  };

  /** فیلدهای موجود برای یک منبع (archived فاقد cutWidth است) */
  ListsView.editableFields = function (src) {
    return RM.config.LIST_DEFAULT_COLUMN_ORDER[src].filter((k) => k !== 'actions');
  };

  /* ================================================================
     ۲) رجیستری ستون‌ها + رندر جدول لیست هر منبع
     ================================================================ */

  /** رجیستری ستون‌های جدول لیست — برچسب‌ها از Mapping کاربر */
  ListsView.columnRegistry = async function (src) {
    const st = ListsView.state[src];
    const widths = st.columnWidths || {};
    const labels = await N.effectiveColumnLabels(src);
    const L = (k) => U.escapeHtml(labels[k] || RM.config.FIELD_LABELS[k] || k);

    /** پوشش «✎ ویرایش‌شده» روی مقدار سلول‌های ویرایش‌شده */
    const wrap = (r, key, html) =>
      (r.__editedFields && r.__editedFields.includes(key)
        ? `<span class="edited-val" title="این فیلد ویرایش شده و جایگزین اطلاعات فایل است">${html}</span>`
        : html);

    const NUM = (r, key, fmt) =>
      wrap(r, key, r[key] === null || r[key] === undefined || r[key] === ''
        ? '<span class="muted">—</span>' : fmt(r[key]));

    const registry = {
      rollNumber: {
        key: 'rollNumber', label: L('rollNumber'), className: 'ltr em-cell',
        render: (r) => wrap(r, 'rollNumber', U.escapeHtml(r.rollNumber || '—')),
        tokens: (r) => [r.rollNumber ?? ''],
      },
      width: {
        key: 'width', label: L('width'), className: 'em-cell',
        render: (r) => NUM(r, 'width', (v) => U.faWidth(v)),
        tokens: (r) => [U.faWidth(r.width), String(r.width ?? '')],
      },
      cutWidth: {
        key: 'cutWidth', label: L('cutWidth'), className: 'em-cell',
        render: (r) => NUM(r, 'cutWidth', (v) => U.faWidth(v)),
        tokens: (r) => [U.faWidth(r.cutWidth), String(r.cutWidth ?? '')],
      },
      actualLength: {
        key: 'actualLength', label: L('actualLength'),
        render: (r) => NUM(r, 'actualLength', (v) => U.faNum(v)),
        tokens: (r) => [U.faNum(r.actualLength), String(r.actualLength ?? '')],
      },
      thickness: {
        key: 'thickness', label: L('thickness'),
        render: (r) => NUM(r, 'thickness', (v) => U.faNum(v)),
        tokens: (r) => [U.faNum(r.thickness), String(r.thickness ?? '')],
      },
      filmType: {
        key: 'filmType', label: L('filmType'),
        render: (r) => wrap(r, 'filmType', r.filmType
          ? (N.hasR(r.filmType)
            ? `<span class="film-r">${U.escapeHtml(r.filmType)}</span>`
            : U.escapeHtml(r.filmType))
          : '<span class="muted">—</span>'),
        tokens: (r) => [r.filmType ?? ''],
      },
      palletNumber: {
        key: 'palletNumber', label: L('palletNumber'), className: 'ltr',
        render: (r) => wrap(r, 'palletNumber', U.escapeHtml(r.palletNumber || '—')),
        tokens: (r) => [r.palletNumber ?? ''],
      },
      setupNumber: {
        key: 'setupNumber', label: L('setupNumber'),
        render: (r) => NUM(r, 'setupNumber', (v) => U.faNum(v)),
        tokens: (r) => [U.faNum(r.setupNumber), String(r.setupNumber ?? '')],
      },
      productionDate: {
        key: 'productionDate', label: L('productionDate'),
        render: (r) => wrap(r, 'productionDate', U.escapeHtml(U.faDateTime(r.productionDate))),
        tokens: (r) => [U.faDateTime(r.productionDate), String(r.productionDate ?? '')],
      },
      netWeight: {
        key: 'netWeight', label: L('netWeight'),
        render: (r) => NUM(r, 'netWeight', (v) => U.faNum(v)),
        tokens: (r) => [U.faNum(r.netWeight), String(r.netWeight ?? '')],
      },
      grade: {
        key: 'grade', label: L('grade'), className: 'ltr',
        render: (r) => wrap(r, 'grade', U.escapeHtml(r.grade || '—')),
        tokens: (r) => [r.grade ?? ''],
      },
      status: {
        key: 'status', label: L('status'),
        render: (r) => wrap(r, 'status', U.escapeHtml(r.status || '—')),
        tokens: (r) => [r.status ?? ''],
      },
      actions: {
        key: 'actions', label: 'عملیات', filterable: false,
        render: (r) => `
          <div class="row-actions">
            <button type="button" class="btn btn-ghost btn-icon" data-list-edit="${r.id}" data-list-src="${src}"
                    title="ویرایش اطلاعات این رول (ذخیرهٔ ماندگار — جایگزین اطلاعات فایل)"
                    aria-label="ویرایش رکورد ${U.escapeHtml(r.rollNumber || '')}">${UI.icons.edit}</button>
          </div>`,
      },
    };

    for (const col of Object.values(registry)) {
      const w = Number(widths[col.key]);
      col.width = Number.isFinite(w) && w > 0 ? w : undefined;
    }
    return registry;
  };

  /** اعمال مرتب‌سازی چندمرحله‌ای (عددی/متنی) */
  ListsView.applySort = function (rows, pipeline) {
    const sorted = [...rows];
    for (let i = pipeline.length - 1; i >= 0; i--) {
      const { field, direction } = pipeline[i];
      const spec = RM.config.LIST_SORTABLE_FIELDS[field] || { numeric: true };
      sorted.sort((a, b) => {
        let r;
        if (spec.numeric) {
          r = U.compareNumeric(a[field], b[field], 'asc');
        } else {
          const ka = String(a[field] ?? '');
          const kb = String(b[field] ?? '');
          r = ka.localeCompare(kb, 'fa', { numeric: true });
          if (r !== 0 && (ka === '' || kb === '')) r = ka === '' ? 1 : -1;
        }
        return direction === 'desc' ? -r : r;
      });
    }
    return sorted;
  };

  /* ================================================================
     کادر جداگانهٔ کنترل‌های کیفیت داده (نسخهٔ ۲٫۸ → بازطراحی ۲٫۹)
     -------------------------------------------------------------------------
     طبق تغییر ۲ کاربر (نسخهٔ ۲٫۹): کنترل‌های کیفیت در «کادر جداگانه‌ای»
     مستقل از لیست (بالای جدول) با قابلیت نمایش/مخفی (ماندگار) قرار دارند.
     سه کنترل موتور quality.js روی رکوردهای نرمال‌شدهٔ همین منبع
     (ویرایش‌های کاربر اعمال‌شده):
       ۱) یکسانی ضخامت در کلید هویت (ستاپ + خط تولید + سالن + سال — نسخهٔ ۲٫۹)
       ۲) تطبیق M شمارهٔ رول با نوع فیلم (دوطرفه — نسخهٔ ۲٫۹)
       ۳) حداکثر یک بازوی برش (R/L) بعد از M
     بدون متن توضیحی، بدون سقف تعداد ردیف — همهٔ ردیف‌های مشکل‌دار در
     جدول قابل پیمایش (اسکرول عمودی) نمایش داده می‌شوند؛ قالب‌بندی کامل
     راست‌به‌چپ با اعداد فارسی. کادر حتی بدون مشکل هم پیام «پاس شدن» دارد.
     ================================================================ */

  /** سلول هویت: شماره ستاپ + خط تولید + سالن + سال (چهاربعدی — نسخهٔ ۲٫۹) */
  const qCell = (v, fa = true) => (v === null || v === undefined || v === '?')
    ? '<span class="muted">—</span>'
    : (fa ? U.faNum(v) : U.escapeHtml(String(v)));

  /** اعمال وضعیت نمایش/مخفی کادر کیفیت یک منبع (نسخهٔ ۲٫۹) */
  ListsView.applyQualityVisibility = function (src) {
    const st = ListsView.state[src];
    const zone = document.getElementById(`quality-${src}`);
    const toggle = document.getElementById(`quality-toggle-${src}`);
    if (!zone || !toggle) return;
    zone.hidden = !st.qualityPanelVisible;
    toggle.setAttribute('aria-expanded', String(st.qualityPanelVisible));
    toggle.innerHTML = st.qualityPanelVisible
      ? `${UI.icons && UI.icons.cross ? UI.icons.cross : ''} مخفی‌کردن کنترل‌های کیفیت`
      : `${UI.icons && UI.icons.plus ? UI.icons.plus : ''} نمایش کنترل‌های کیفیت`;
    toggle.title = st.qualityPanelVisible
      ? 'کادر کنترل‌های کیفیت را مخفی کن'
      : 'کادر کنترل‌های کیفیت را نمایش بده';
  };

  ListsView.renderQuality = function (src, records) {
    const zone = document.getElementById(`quality-${src}`);
    const chipsEl = document.getElementById(`quality-chips-${src}`);
    if (!zone) return;

    const Q = RM.quality;

    /* --- بدون داده: کادر خالی/مخفی می‌ماند --- */
    if (!records || !records.length) {
      zone.innerHTML = '';
      if (chipsEl) chipsEl.innerHTML = '<span class="chip">دیتایی برای بررسی نیست</span>';
      return;
    }

    const result = Q.runControls(records);
    const total = result.counts.thickness + result.counts.filmMatch + result.counts.arms;

    /* --- چیپ‌های خلاصهٔ سر کادر (همیشه دیده می‌شوند — حتی وقتی کادر مخفی است) --- */
    if (chipsEl) {
      chipsEl.innerHTML = total
        ? `<span class="chip chip-warn">${U.faNum(total)} ردیف مشکل‌دار</span>`
        : '<span class="chip chip-ok">✓ بدون مشکل</span>';
    }

    /* --- کادر باز است ولی مشکلی نیست → پیام موفقیت --- */
    if (!total) {
      zone.innerHTML = `
        <div class="quality-ok">
          <span class="status-pill pill-ok">✓ هر سه کنترل پاس شد</span>
          <span class="muted">ضخامت یکسان در هر کلید هویت (ستاپ + خط تولید + سالن + سال) · تطبیق M شمارهٔ رول با نوع فیلم · حداکثر یک بازوی برش بعد از M</span>
        </div>`;
      return;
    }

    /** جدول یک کنترل — همهٔ ردیف‌ها بدون سقف، داخل کادر اسکرول‌دار */
    const qTable = (columns, rows) => `
      <div class="table-wrap quality-scroll">
        <table class="data-table">
          <thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((r, i) => `<tr>${columns.map((c) => `<td class="${c.className || ''}">${c.render(r, i)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`;

    const rollCell = (item) => `<span class="q-roll" dir="ltr">${U.escapeHtml(String(item.record.rollNumber || '—'))}</span>`;
    /* سال چهاررقمی بدون جداکنندهٔ هزارگان (نسخهٔ ۳٫۰ — تغییر ۷):
       1405 → «۱۴۰۵» (نه «۱٬۴۰۵») */
    const yearCell = (v) => (v === null || v === undefined || v === '?')
      ? '<span class="muted">—</span>'
      : U.faYear(v);
    const identityCols = [
      { label: 'شماره رول', render: rollCell },
      { label: 'شماره ستاپ', render: (it) => qCell(it.setupNumber) },
      { label: 'خط تولید', render: (it) => qCell(it.line, false) },
      { label: 'سالن', render: (it) => qCell(it.hall) },
      { label: 'سال', render: (it) => yearCell(it.year) },
    ];

    const blocks = [];

    /* --- کنترل ۱: یکسانی ضخامت در کلید هویت (ستاپ + خط + سالن + سال) --- */
    if (result.counts.thickness) {
      blocks.push(`
        <div class="quality-block">
          <div class="quality-block-head">
            <b>۱) یکسانی ضخامت در کلید هویت ستاپ</b>
            <span class="chip chip-warn">${U.faNum(result.counts.thickness)} ردیف</span>
            <span class="chip">${U.faNum(result.thickness.groups)} کلید چندضخامتی</span>
          </div>
          ${qTable([...identityCols,
            { label: 'ضخامت', render: (it) => qCell(it.record.thickness) },
            { label: 'شرح', className: 'q-desc', render: (it) => U.escapeHtml(Q.describeIssue(it, 'thickness')) },
          ], result.thickness.warnings)}
        </div>`);
    }

    /* --- کنترل ۲: تطبیق M با نوع فیلم (دوطرفه — نسخهٔ ۲٫۹) --- */
    if (result.counts.filmMatch) {
      blocks.push(`
        <div class="quality-block">
          <div class="quality-block-head">
            <b>۲) تطبیق M شمارهٔ رول با نوع فیلم</b>
            <span class="chip chip-warn">${U.faNum(result.counts.filmMatch)} ردیف</span>
          </div>
          ${qTable([...identityCols,
            { label: 'نوع فیلم', className: 'ltr', render: (it) => U.escapeHtml(String(it.record.filmType || '—')) },
            { label: 'شرح', className: 'q-desc', render: (it) => U.escapeHtml(Q.describeIssue(it, 'filmMatch')) },
          ], result.filmMatch)}
        </div>`);
    }

    /* --- کنترل ۳: حداکثر یک بازوی برش بعد از M --- */
    if (result.counts.arms) {
      blocks.push(`
        <div class="quality-block">
          <div class="quality-block-head">
            <b>۳) بازوی برش بعد از M</b>
            <span class="chip chip-warn">${U.faNum(result.counts.arms)} ردیف</span>
          </div>
          ${qTable([...identityCols,
            { label: 'بعد از M', className: 'ltr', render: (it) => `<span class="q-roll" dir="ltr">${U.escapeHtml(it.after)}</span>` },
            { label: 'شرح', className: 'q-desc', render: (it) => U.escapeHtml(Q.describeIssue(it, 'arms')) },
          ], result.arms)}
        </div>`);
    }

    zone.innerHTML = blocks.join('');
  };

  /** رندر جدول لیست یک منبع */
  ListsView.renderTable = async function (src) {
    const st = ListsView.state[src];
    const target = RM.config.IMPORT_TARGETS[src];
    const wrap = document.getElementById(`list-table-${src}`);
    const statsEl = document.getElementById(`list-stats-${src}`);
    if (!wrap) return;

    /* --- داده: رکوردهای فایل + اعمال ویرایش‌ها (جایگزینی اطلاعات فایل) --- */
    const records = await RM.edits.applyToRecords(src, await db[target.table].toArray());
    const editedCount = RM.edits._lastAppliedCount || 0;

    /* --- ناحیهٔ کنترل‌های کیفیت (نسخهٔ ۲٫۸) — همان رکوردهای مؤثر --- */
    ListsView.renderQuality(src, records);

    const rows = ListsView.applySort(records, st.sortPipeline);

    /* --- چیپ‌های آمار --- */
    statsEl.innerHTML = `
      <span class="chip">${U.faNum(rows.length)} رکورد</span>
      ${editedCount ? `<span class="chip chip-warn" title="رکوردهایی که اطلاعات ویرایش‌شده دارند">✎ ویرایش‌شده: ${U.faNum(editedCount)}</span>` : ''}`;

    /* --- پنل مرتب‌سازی --- */
    UI.sortPanel(document.getElementById(`list-sort-pipeline-${src}`), st.sortPipeline,
      RM.config.LIST_SORTABLE_FIELDS, {
        onDir: (i) => {
          st.sortPipeline[i].direction = st.sortPipeline[i].direction === 'asc' ? 'desc' : 'asc';
          DB.setSetting(`list${cap(src)}Sort`, st.sortPipeline);
          ListsView.renderTable(src);
        },
        onRemove: (i) => {
          st.sortPipeline.splice(i, 1);
          DB.setSetting(`list${cap(src)}Sort`, st.sortPipeline);
          ListsView.renderTable(src);
        },
        onReorder: (from, to) => {
          const [moved] = st.sortPipeline.splice(from, 1);
          st.sortPipeline.splice(to, 0, moved);
          DB.setSetting(`list${cap(src)}Sort`, st.sortPipeline);
          ListsView.renderTable(src);
        },
        emptyText: 'مرتب‌سازی پیش‌فرض (شماره ستاپ، شماره رول)',
      });

    /* --- پنل ترتیب ستون‌ها + نمایش/مخفی + عرض --- */
    const all = await ListsView.columnRegistry(src);
    const hiddenSet = new Set(st.hiddenCols || []);
    const items = (st.columnOrder || RM.config.LIST_DEFAULT_COLUMN_ORDER[src])
      .map((key) => all[key])
      .filter(Boolean)
      .map((c) => ({ key: c.key, label: c.label, width: (st.columnWidths || {})[c.key] ?? 0, hidden: hiddenSet.has(c.key) }));

    UI.orderPanel(document.getElementById(`list-cols-pipeline-${src}`), items, {
      onMove: async (from, to) => {
        const order = st.columnOrder || [...RM.config.LIST_DEFAULT_COLUMN_ORDER[src]];
        const [moved] = order.splice(from, 1);
        order.splice(to, 0, moved);
        st.columnOrder = order;
        await DB.setSetting(`list${cap(src)}ColumnOrder`, order);
        ListsView.renderTable(src);
      },
      onWidth: async (key, w) => {
        st.columnWidths = st.columnWidths || {};
        st.columnWidths[key] = w;
        await DB.setSetting(`list${cap(src)}ColumnWidths`, st.columnWidths);
        ListsView.renderTable(src);
      },
      /* --- تغییر ۳: نمایش/مخفی‌کردن هر ستون --- */
      onToggle: async (key, hidden) => {
        const set = new Set(st.hiddenCols || []);
        if (hidden) set.add(key);
        else set.delete(key);
        st.hiddenCols = [...set];
        await DB.setSetting(`list${cap(src)}HiddenCols`, st.hiddenCols);
        ListsView.renderTable(src);
        UI.toast(hidden
          ? `ستون «${U.escapeHtml((all[key] || {}).label || key)}» در جدول مخفی شد — از پنل ترتیب ستون‌ها دوباره نمایش داده می‌شود.`
          : `ستون «${U.escapeHtml((all[key] || {}).label || key)}» دوباره نمایش داده شد.`, 'info');
      },
      emptyText: 'بدون ستون',
    });

    /* --- جدول اصلی (فیلتر ستون‌ها + ارتفاع داینامیک) ---
       فیلترها روی «همهٔ» رکوردها اعمال می‌شوند؛ برای پاسخ‌گویی با دیتای
       بزرگ فقط LIST_MAX_DOM_ROWS ردیف اولِ فیلترشده در DOM رندر می‌شود. */
    const columns = (st.columnOrder || RM.config.LIST_DEFAULT_COLUMN_ORDER[src])
      .map((key) => all[key])
      .filter(Boolean)
      .filter((c) => !hiddenSet.has(c.key));

    UI.filterTable(wrap, columns, rows, {
      state: st,
      visibleRows: RM.config.LIST_VISIBLE_ROWS,
      rowHeight: 40,
      /* ۳٫۹ — تغییر ۵: دکمه‌های ابزار در نوار بالای جدول (کنار «پاک‌کردن همهٔ
         فیلترها») — وضعیت فشرده از state نما و کلیک از طریق onToolToggle */
      tools: [
        { id: `list-cols-toggle-${src}`, label: 'ترتیب ستون‌ها', title: 'نمایش/بستن پنل ترتیب ستون‌ها', pressed: st.colsPanelVisible },
        { id: `list-sort-toggle-${src}`, label: 'مرتب‌سازی', title: 'نمایش/بستن پنل مرتب‌سازی', pressed: st.sortPanelVisible },
      ],
      onToolToggle: (toolId) => {
        if (toolId === `list-cols-toggle-${src}`) {
          st.colsPanelVisible = !st.colsPanelVisible;
          DB.setSetting(`list${cap(src)}ColsPanelVisible`, st.colsPanelVisible);
          ListsView.applyPanelVisibility(src);
        } else if (toolId === `list-sort-toggle-${src}`) {
          st.sortPanelVisible = !st.sortPanelVisible;
          DB.setSetting(`list${cap(src)}SortPanelVisible`, st.sortPanelVisible);
          ListsView.applyPanelVisibility(src);
        }
      },
      tableClass: 'cut-table list-table',
      maxDomRows: RM.config.LIST_MAX_DOM_ROWS,
      emptyText: src === 'rolls'
        ? 'هنوز فایل «رول‌های موجود» Import نشده — از کادر بالا فایل را بارگذاری کنید.'
        : 'هنوز فایل «سابقه رول‌ها (آرشیو)» Import نشده — از کادر بالا فایل را بارگذاری کنید.',
      filteredEmptyText: 'هیچ رکوردی با فیلترهای فعلی مطابقت ندارد — فیلترها را پاک کنید.',
      footerNote: 'فیلتر هر ستون زیر سرستون همان ستون · منطق: شامل بودن · دکمهٔ «≠» = شامل نشود · سلول‌های «✎» ویرایش‌شده و جایگزین فایل هستند',
      onRowsChange: (n) => DB.setSetting(`list${cap(src)}VisibleRows`, n),
      onRendered: () => {
        wrap.querySelectorAll('[data-list-edit]').forEach((btn) => {
          btn.addEventListener('click', () =>
            ListsView.openEditModal(btn.dataset.listSrc, Number(btn.dataset.listEdit)));
        });
      },
    });
  };

  /* ================================================================
     ۳) جدول رول‌های ویرایش‌شده (زبانهٔ سوم)
     ================================================================ */

  ListsView.renderEdited = async function () {
    const wrap = document.getElementById('edited-rolls-table');
    const badge = document.getElementById('edited-count-badge');
    if (!wrap) return;

    const edits = await RM.edits.getAll();
    if (badge) badge.textContent = U.faNum(edits.length);

    if (!edits.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          ${UI.icons.audit}
          <h4>رولی ویرایش نشده است</h4>
          <p>با دکمهٔ ✎ در جدول «لیست رول های موجود» یا «لیست سابقه رول ها» اطلاعات هر رول را ویرایش کنید — ویرایش‌ها ماندگارند، پس از هر Import جایگزین اطلاعات فایل می‌شوند و در Backup ذخیره می‌شوند.</p>
        </div>`;
      return;
    }

    /* برچسب‌های فیلد برای نمایش نام فیلدهای ویرایش‌شده */
    const labelsOf = {};
    for (const src of ['rolls', 'archived']) {
      const labels = await N.effectiveColumnLabels(src);
      Object.assign(labelsOf, { [src]: labels });
    }

    const rows = [...edits].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const columns = [
      { key: 'source', label: 'منبع', render: (r) => U.escapeHtml(RM.config.DATASET_LABELS[r.source] || r.source) },
      {
        key: 'rollNumber', label: 'شماره رول (کلید ویرایش)', className: 'ltr em-cell',
        render: (r) => U.escapeHtml(r.rollNumber || '—'),
      },
      {
        key: 'fields', label: 'اطلاعات ویرایش‌شده',
        render: (r) => `<div class="edited-fields-list">${Object.entries(r.fields || {})
          .map(([f, v]) => {
            const label = (labelsOf[r.source] || {})[f] || RM.config.FIELD_LABELS[f] || f;
            return `<span class="edited-field-chip">${U.escapeHtml(String(label))}: <b>${U.escapeHtml(String(v ?? '—'))}</b></span>`;
          }).join('')}</div>`,
      },
      { key: 'updatedAt', label: 'آخرین ویرایش', render: (r) => U.faDate(r.updatedAt) },
      {
        key: 'actions', label: 'عملیات',
        render: (r) => `
          <div class="row-actions">
            <button type="button" class="btn btn-ghost btn-icon" data-edit-again="${U.escapeHtml(r.source)}" data-edit-key="${U.escapeHtml(r.rollNumber)}"
                    title="ویرایش مجدد این رول (ویرایش جدید روی قبلی ذخیره می‌شود)" aria-label="ویرایش مجدد">${UI.icons.edit}</button>
            <button type="button" class="btn btn-ghost btn-icon" data-edit-revert="${U.escapeHtml(r.source)}" data-edit-key="${U.escapeHtml(r.rollNumber)}"
                    title="حذف ویرایش — بازگشت کامل به اطلاعات فایل" aria-label="حذف ویرایش">${UI.icons.trash}</button>
          </div>`,
      },
    ];

    const renderPage = (page) => {
      ListsView._editedPage = page;
      UI.renderTable(wrap, columns, rows, {
        page,
        pageSize: RM.config.PAGE_SIZE,
        emptyText: 'رولی ویرایش نشده است.',
        onPageChange: (next) => renderPage(next),
      });

      wrap.querySelectorAll('[data-edit-again]').forEach((btn) => {
        btn.addEventListener('click', () => ListsView.editAgain(btn.dataset.editAgain, btn.dataset.editKey));
      });
      wrap.querySelectorAll('[data-edit-revert]').forEach((btn) => {
        btn.addEventListener('click', () => ListsView.revertEdit(btn.dataset.editRevert, btn.dataset.editKey));
      });
    };
    renderPage(ListsView._editedPage);
  };

  /** ویرایش مجدد از زبانهٔ ویرایش‌شده‌ها — رکورد فعال همان رول را باز می‌کند */
  ListsView.editAgain = async function (src, rollNumber) {
    const target = RM.config.IMPORT_TARGETS[src];
    const record = await db[target.table].where('rollNumber').equals(String(rollNumber)).first();
    if (!record) {
      UI.toast('رکورد فعالی با این شماره رول در دیتای فایل نیست — ویرایش ذخیره شده و در Importهای بعدی اعمال می‌شود.', 'info', 6000);
      return;
    }
    ListsView.openEditModal(src, record.id);
  };

  /** حذف ویرایش یک رول (بازگشت به اطلاعات فایل) */
  ListsView.revertEdit = async function (src, rollNumber) {
    const labels = RM.config.DATASET_LABELS[src] || src;
    const ok = await UI.confirm({
      title: 'حذف ویرایش رول',
      html: `<div class="confirm-stats"><div>منبع: <b>${U.escapeHtml(String(labels))}</b></div>
             <div>شماره رول: <b>${U.escapeHtml(String(rollNumber))}</b></div></div>`,
      message: 'ویرایش این رول حذف می‌شود و اطلاعات اصلی فایل دوباره معتبر می‌شود. ادامه می‌دهید؟',
      confirmText: 'بله، ویرایش را حذف کن',
      danger: true,
    });
    if (!ok) return;

    await RM.edits.removeEdit(src, rollNumber);
    UI.toast('ویرایش حذف شد — اطلاعات فایل دوباره معتبر است.', 'success');
    await RM.refreshAll();
  };

  /* ================================================================
     ۴) مودال ویرایش رکورد
     ================================================================ */

  /** بازکردن مودال ویرایش یک رکورد */
  ListsView.openEditModal = async function (src, recordId) {
    const target = RM.config.IMPORT_TARGETS[src];
    const record = await db[target.table].get(recordId);
    if (!record) {
      UI.toast('رکورد یافت نشد.', 'warning');
      return;
    }

    /* مقدار مؤثر (فایل + ویرایش‌های ذخیره‌شده) برای پیش‌فرض فرم */
    const effective = { ...record };
    await RM.edits.applyToRecords(src, [effective]);
    const editKey = effective._editKey ?? record.rollNumber;   // کلید ویرایش = شمارهٔ اصلی

    const labels = await N.effectiveColumnLabels(src);
    const fields = ListsView.editableFields(src);
    const numeric = new Set(RM.config.LIST_NUMERIC_EDIT_FIELDS);
    const int = new Set(RM.config.LIST_INT_EDIT_FIELDS);

    const inputId = (f) => `lef-${f}`;

    const fieldHtml = fields.map((f) => {
      const isNum = numeric.has(f);
      const label = U.escapeHtml(labels[f] || RM.config.FIELD_LABELS[f] || f);
      const isEdited = !!(effective.__editedFields && effective.__editedFields.includes(f));

      let value = effective[f];
      if (value === null || value === undefined) value = '';
      else if (value instanceof Date) value = String(value);
      else value = String(value);

      return `
        <div class="field">
          <label for="${inputId(f)}">${label}
            ${isEdited ? '<span class="field-edit-flag" title="این فیلد ویرایش شده و مقدار فعلی جایگزین فایل است">ویرایش‌شده</span>' : ''}
            ${isNum ? '<span class="unit">(عددی)</span>' : ''}
          </label>
          <input type="text" id="${inputId(f)}" ${isNum ? 'inputmode="decimal"' : ''} dir="${f === 'rollNumber' || f === 'grade' || f === 'palletNumber' ? 'ltr' : 'auto'}"
                 autocomplete="off" value="${U.escapeHtml(value)}" data-lef="${f}"
                 aria-label="مقدار ${label}">
          <p class="field-error" id="lef-err-${f}" hidden></p>
        </div>`;
    }).join('');

    document.getElementById('modal-edit-title').textContent =
      `ویرایش رکورد — ${RM.config.DATASET_LABELS[src]} · ${U.escapeHtml(record.rollNumber || 'بدون شماره')}`;

    document.getElementById('modal-edit-body').innerHTML = `
      <div class="modal-edit-fields">${fieldHtml}</div>
      <p class="modal-edit-note">
        • مقادیر خالی = «بدون مقدار» (null) ذخیره می‌شود.<br>
        • ویرایش ذخیره می‌شود و از این پس <b>جایگزین اطلاعات فایل ایمپورت‌شده</b> می‌شود (پس از هر Import هم دوباره اعمال می‌گردد).<br>
        • هر ویرایش جدید روی ویرایش قبلی همان رول ذخیره می‌شود؛ اگر مقداری را به مقدار اصلی فایل برگردانید، ویرایش همان فیلد حذف می‌شود.
      </p>`;

    document.getElementById('modal-edit').hidden = false;

    ListsView.editing = {
      sourceKey: src,
      recordId,
      imported: record,        // رکورد اصلی فایل (مبنای تشخیص بازگشت به اصلی)
      effective,
      editKey,                 // شماره رول اصلی — کلید رکورد ویرایش
    };

    const first = document.querySelector('#modal-edit-body input');
    if (first) first.focus();
  };

  /** بستن مودال ویرایش */
  ListsView.closeEditModal = function () {
    document.getElementById('modal-edit').hidden = true;
    ListsView.editing = null;
  };

  /** ذخیرهٔ ویرایش (دکمهٔ «ذخیرهٔ تغییرات») */
  ListsView.saveEditModal = async function () {
    const ctx = ListsView.editing;
    if (!ctx) return;

    const numeric = new Set(RM.config.LIST_NUMERIC_EDIT_FIELDS);
    const int = new Set(RM.config.LIST_INT_EDIT_FIELDS);
    const fields = ListsView.editableFields(ctx.sourceKey);

    const changes = {};
    let hasInvalid = false;

    for (const f of fields) {
      const input = document.querySelector(`[data-lef="${f}"]`);
      if (!input) continue;
      const raw = input.value.trim();

      if (raw === '') {
        changes[f] = (f === 'rollNumber') ? '' : null;
        continue;
      }

      if (numeric.has(f)) {
        const v = U.parseNumber(raw);
        if (v === null) {
          UI.setFieldError(input, document.getElementById(`lef-err-${f}`), 'عدد معتبر وارد کنید.');
          hasInvalid = true;
          continue;
        }
        changes[f] = int.has(f) ? Math.trunc(v) : v;
      } else {
        changes[f] = raw;
      }
    }

    if (hasInvalid) {
      UI.toast('برخی فیلدها عدد معتبر نیستند — خطاها را برطرف کنید.', 'error');
      return;
    }

    /* شماره رول خالی؟ (کلید ویرایش) */
    if ('rollNumber' in changes && (changes.rollNumber === '' || changes.rollNumber === null)) {
      const input = document.querySelector('[data-lef="rollNumber"]');
      UI.setFieldError(input, document.getElementById('lef-err-rollNumber'), 'شماره رول نمی‌تواند خالی باشد.');
      UI.toast('شماره رول نمی‌تواند خالی باشد.', 'error');
      return;
    }

    const result = await RM.edits.saveEdit(ctx.sourceKey, ctx.editKey, changes, ctx.imported);

    ListsView.closeEditModal();

    const changed = result.applied.length + result.removed.length;
    if (!changed && Object.keys(result.fields).length === 0) {
      UI.toast('تغییری ثبت نشد — همهٔ مقادیر با اطلاعات فایل یکسان است.', 'info');
    } else {
      UI.toast(
        `ویرایش رول «${U.escapeHtml(String(ctx.editKey))}» ذخیره شد — ${U.faNum(Object.keys(result.fields).length)} فیلد ویرایش‌شده. از این پس جایگزین اطلاعات فایل است.`,
        'success',
        6000
      );
    }

    await RM.refreshAll();
  };

  /* ================================================================
     ۵) رندر کامل
     ================================================================ */

  ListsView.render = async function () {
    await ListsView.renderTable('rolls');
    await ListsView.renderTable('archived');
    await ListsView.renderEdited();
  };

  RM.views = RM.views || {};
  RM.views.lists = ListsView;
})();
