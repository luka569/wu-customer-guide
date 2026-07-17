// 前端邏輯：僅負責畫面顯示，內容全部來自 site.json / guide.json / faq.json，
// 不含任何權限判斷或敏感資訊（後端邏輯一律放在 GAS）。
(function () {
  'use strict';

  var IMG_DIR = 'assets/images/';
  var statsUrl = '';

  /* ---------- 行內標記解析（先跳脫再替換，防注入） ---------- */

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 支援四種行內標記：**粗體**、==醒目標記==、{{行內小圖}}、[文字](網址)
  function rich(text) {
    var out = escapeHtml(text);
    out = out.replace(/\{\{([^{}]+)\}\}/g, function (_, file) {
      return '<img class="inline-icon" src="' + IMG_DIR + file.trim() + '" alt="">';
    });
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, label, url) {
      return '<a class="ext-link" href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
    });
    out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    out = out.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    return out;
  }

  /* ---------- 內容區塊渲染（五種類型） ---------- */

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function renderBlock(blk, lazy) {
    switch (blk['類型']) {
      case '文字':
        return el('p', 'blk-text', rich(blk['內容']));

      case '步驟': {
        var ol = el('ol', 'blk-steps');
        (blk['步驟列表'] || []).forEach(function (step) {
          ol.appendChild(el('li', '', rich(step)));
        });
        return ol;
      }

      case '圖片': {
        var fig = el('figure', 'blk-figure');
        var img = document.createElement('img');
        img.src = IMG_DIR + blk['檔案'];
        img.alt = blk['說明'] || '';
        if (lazy !== false) img.loading = 'lazy';
        if (blk['最大寬度']) img.style.maxWidth = blk['最大寬度'] + 'px';
        img.addEventListener('click', function () {
          openLightbox(img.src, blk['說明'] || '');
        });
        fig.appendChild(img);
        if (blk['說明']) fig.appendChild(el('figcaption', '', escapeHtml(blk['說明'])));
        return fig;
      }

      case '並排圖': {
        var row = el('div', 'blk-row');
        (blk['圖片'] || []).forEach(function (item) {
          var f = el('figure', '');
          var im = document.createElement('img');
          im.src = IMG_DIR + item['檔案'];
          im.alt = item['說明'] || '';
          im.loading = 'lazy';
          if (blk['最大高度']) im.style.maxHeight = blk['最大高度'] + 'px';
          f.appendChild(im);
          if (item['說明']) f.appendChild(el('figcaption', '', escapeHtml(item['說明'])));
          row.appendChild(f);
        });
        return row;
      }

      case '提示框': {
        var tip = el('div', 'blk-tip');
        tip.appendChild(el('span', 'blk-tip__badge', '提示'));
        tip.appendChild(el('p', '', rich(blk['內容'])));
        return tip;
      }

      default:
        return null;
    }
  }

  function renderBlocks(container, blocks, firstNotLazy) {
    (blocks || []).forEach(function (blk, i) {
      var node = renderBlock(blk, !(firstNotLazy && i < 3));
      if (node) container.appendChild(node);
    });
  }

  /* ---------- 折疊項目 ---------- */

  function renderFold(item, numText, titleText, blocks) {
    var details = el('details', 'fold');
    details.id = item['編號'];

    var summary = el('summary', 'fold__summary');
    summary.appendChild(el('span', 'fold__num', escapeHtml(numText)));
    summary.appendChild(el('span', 'fold__title', rich(titleText)));
    summary.appendChild(el('span', 'fold__sym', ''));
    summary.addEventListener('click', function () {
      if (!details.open) trackEvent('expand', item['編號'], titleText);
    });
    details.appendChild(summary);

    var body = el('div', 'fold__body');
    renderBlocks(body, blocks);
    details.appendChild(body);
    return details;
  }

  /* ---------- 目錄 ---------- */

  function buildTocGroups(guide, faq) {
    var groups = guide['章節列表'].map(function (ch, i) {
      return {
        name: '第 ' + (i + 1) + ' 章　' + ch['章節標題'],
        items: (ch['項目'] || []).map(function (it) {
          return { id: it['編號'], label: it['標題'] };
        })
      };
    });
    groups.push({
      name: '常見疑問',
      items: (faq['問答列表'] || []).map(function (it) {
        return { id: it['編號'], label: it['問題'] };
      })
    });
    return groups;
  }

  function renderToc(container, groups) {
    groups.forEach(function (g) {
      var group = el('div', 'toc-group');
      group.appendChild(el('div', 'toc-group__name', escapeHtml(g.name)));
      var list = el('div', 'toc-group__items');
      g.items.forEach(function (t) {
        var btn = el('button', 'toc-link');
        btn.type = 'button';
        btn.appendChild(el('span', 'toc-link__id', escapeHtml(t.id)));
        btn.appendChild(el('span', 'toc-link__label', rich(t.label)));
        btn.addEventListener('click', function () {
          closeDrawer();
          goToItem(t.id);
        });
        list.appendChild(btn);
      });
      group.appendChild(list);
      container.appendChild(group);
    });
  }

  // 跳轉：若目標為折疊項則先展開再平滑捲動
  function goToItem(id) {
    var target = document.getElementById(id);
    if (!target) return;
    if (target.tagName === 'DETAILS') target.open = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 燈箱（F5） ---------- */

  var lightbox = document.getElementById('lightbox');
  var lbImg = document.getElementById('lightbox-img');
  var lbCap = document.getElementById('lightbox-cap');
  var lbScale = 1;

  function applyLbScale() {
    lbImg.style.transform = lbScale === 1 ? '' : 'scale(' + lbScale + ')';
  }

  function openLightbox(src, cap) {
    lbImg.src = src;
    lbImg.alt = cap;
    lbCap.textContent = cap;
    lbScale = 1;
    lightbox.classList.remove('lightbox--zoomed');
    applyLbScale();
    lightbox.hidden = false;
    document.body.classList.add('no-scroll');
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lbImg.src = '';
    document.body.classList.remove('no-scroll');
  }

  // 點圖片：放大至原始解析度 ↔ 還原；滾輪：連續縮放
  lbImg.addEventListener('click', function () {
    lbScale = 1;
    applyLbScale();
    lightbox.classList.toggle('lightbox--zoomed');
  });
  lightbox.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (!lightbox.classList.contains('lightbox--zoomed')) {
      lightbox.classList.add('lightbox--zoomed');
      lbScale = 1;
    }
    lbScale = Math.min(4, Math.max(0.3, lbScale * (e.deltaY < 0 ? 1.12 : 0.9)));
    applyLbScale();
  }, { passive: false });
  document.getElementById('lightbox-overlay').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);

  /* ---------- 目錄抽屜與浮動導覽（F6） ---------- */

  var drawer = document.getElementById('drawer');
  var fab = document.getElementById('fab');

  function openDrawer() {
    drawer.hidden = false;
    document.body.classList.add('no-scroll');
  }

  function closeDrawer() {
    drawer.hidden = true;
    if (lightbox.hidden) document.body.classList.remove('no-scroll');
  }

  document.getElementById('fab-toc').addEventListener('click', openDrawer);
  document.getElementById('fab-top').addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!lightbox.hidden) closeLightbox();
      if (!drawer.hidden) closeDrawer();
    }
  });

  function updateFab() {
    var toc = document.getElementById('toc');
    var threshold = toc ? toc.offsetTop + toc.offsetHeight : 340;
    fab.hidden = window.scrollY <= threshold;
  }

  window.addEventListener('scroll', updateFab, { passive: true });

  /* ---------- GAS 點擊統計掛鉤（F8，端點留空即停用） ---------- */

  function trackEvent(type, id, title) {
    if (!statsUrl) return;
    try {
      var payload = JSON.stringify({ event: type, id: id || '', title: title || '', page: location.pathname });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(statsUrl, payload);
      } else {
        fetch(statsUrl, { method: 'POST', mode: 'no-cors', body: payload, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* 統計失敗一律靜默，不影響閱讀 */ }
  }

  /* ---------- 頁面組裝 ---------- */

  function renderPage(site, guide, faq) {
    statsUrl = site['GAS統計網址'] || '';

    document.getElementById('site-title').textContent = site['網站標題'] || '';
    document.getElementById('site-subtitle').textContent = site['網站副標'] || '';
    document.getElementById('site-meta').textContent =
      '版本 ' + (site['版本'] || '') + '・最後更新 ' + (site['最後更新'] || '');
    document.title = (site['網站標題'] || '') + '｜' + (site['網站副標'] || '');

    // ① 平台介紹（首屏圖不 lazy）
    document.getElementById('intro-title').textContent = site['平台介紹標題'] || '';
    renderBlocks(document.getElementById('intro-body'), site['平台介紹'], true);

    // ② 目錄（頁內＋抽屜共用同一份資料）
    var groups = buildTocGroups(guide, faq);
    renderToc(document.getElementById('toc-body'), groups);
    renderToc(document.getElementById('drawer-body'), groups);

    // ③ 操作說明
    document.getElementById('guide-lede').textContent = site['操作說明引言'] || '';
    var guideBody = document.getElementById('guide-body');
    guide['章節列表'].forEach(function (ch, i) {
      var chapter = el('div', 'chapter');
      var head = el('div', 'chapter__head');
      head.appendChild(el('h3', 'chapter__name', escapeHtml('第 ' + (i + 1) + ' 章　' + ch['章節標題'])));
      head.appendChild(el('span', 'chapter__count', (ch['項目'] || []).length + ' 項'));
      chapter.appendChild(head);
      var items = el('div', 'chapter__items');
      (ch['項目'] || []).forEach(function (it) {
        items.appendChild(renderFold(it, it['編號'], it['標題'], it['內容']));
      });
      chapter.appendChild(items);
      guideBody.appendChild(chapter);
    });

    // ④ 常見疑問
    document.getElementById('faq-lede').textContent = site['常見疑問引言'] || '';
    var faqBody = document.getElementById('faq-body');
    var faqItems = el('div', 'chapter__items');
    (faq['問答列表'] || []).forEach(function (it) {
      faqItems.appendChild(renderFold(it, it['編號'], it['問題'], it['回答']));
    });
    faqBody.appendChild(faqItems);

    var tail = document.getElementById('faq-tail');
    if (site['找不到答案提示']) {
      document.getElementById('faq-tail-text').innerHTML = rich(site['找不到答案提示']);
      tail.hidden = false;
    }

    // 頁尾
    document.getElementById('site-footer').textContent =
      (site['網站標題'] || '') + '・維護單位：' + (site['維護單位'] || '');

    // 網址錨點：開啟即自動展開並定位（如 #1-1、#Q3）
    if (location.hash) {
      var id = decodeURIComponent(location.hash.slice(1));
      requestAnimationFrame(function () { goToItem(id); });
    }

    updateFab();
    trackEvent('pageview', '', document.title);
  }

  /* ---------- 載入 JSON（失敗顯示錯誤訊息，不白屏） ---------- */

  function loadJson(name) {
    return fetch(name).then(function (res) {
      if (!res.ok) throw new Error(name + ' HTTP ' + res.status);
      return res.json();
    });
  }

  Promise.all([loadJson('site.json'), loadJson('guide.json'), loadJson('faq.json')])
    .then(function (data) {
      renderPage(data[0], data[1], data[2]);
    })
    .catch(function (err) {
      console.error('內容載入失敗：', err);
      document.getElementById('load-error').hidden = false;
    });
})();
