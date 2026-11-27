const DAY_NAMES = {
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
  7: 'Pazar'
};

const SHORT_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

const TAB_META = {
  daily: {
    icon: '⊞',
    title: 'Günlük Takip',
    sub: 'Sabah & Öğle ve Gece vardiyalarının günlük görev ve performans durumunu görüntüleyin.'
  },
  weekly: {
    icon: '📅',
    title: 'Haftalık Takip',
    sub: 'Pazartesi - Pazar haftalık görev tamamlama, canlı destek hacmi ve izin özeti.'
  },
  range: {
    icon: '📊',
    title: 'Tarih Aralığı (Total Takip)',
    sub: 'Seçtiğiniz iki tarih arasındaki toplam canlı destek adetlerini, görev yapılma sayılarını ve vardiya toplamlarını inceleyin.'
  },
  entry: {
    icon: '✎',
    title: 'Personel Veri Girişi',
    sub: 'Personel kendi vardiyasında tamamladığı görevleri ve canlı destek sayısını buradan bildirir.'
  },
  schedule: {
    icon: '🗓',
    title: 'Haftalık İzin Planı',
    sub: 'Personellerin haftalık izin günlerini düzenleyin; izinli olanlar ana tabloda İZİNLİ görünür.'
  },
  'staff-admin': {
    icon: '👥',
    title: 'Personel & Vardiya Yönetimi',
    sub: 'Sabah (09-18), Sabah 12 Saat (09-21), Öğle (12-21) ve Gece (21-09) vardiya tanımları.'
  },
  'task-admin': {
    icon: '⚙',
    title: 'İş Kolları (Tablo Sütunları)',
    sub: 'Yönetici olarak takip listesine ekstra iş kolu ve görev sütunları ekleyin.'
  },
  profile: {
    icon: '👤',
    title: 'Personel Profili & İstatistikleri',
    sub: 'Seçili personelin tüm zamanlar performansı, görev tamamlama oranları ve gün gün girdiği veriler.'
  },
  firebase: {
    icon: '☁',
    title: 'Bulut Senkron & Uzaktan Güncelleme',
    sub: 'Ofisteki tüm .exe istemcilerinin verilerini senkron tutun ve tek tıkla uzaktan yeni sürüm yayınlayın.'
  },
  'stock-check': {
    icon: '📦',
    title: 'Dijipin Stok Kontrol (Topup & E-Pin)',
    sub: 'Dijipin üzerindeki Topup ve E-Pin kategorilerini (alt kategoriler dahil) tarayarak stoğu tükenen ürünleri inceleyin.'
  }
};

let appState = {
  activeTab: 'daily',
  previousTab: 'daily',
  currentUser: null,
  syncStatus: null,
  appUpdate: null,
  isUpdatingExe: false,
  stockScanData: null,
  stockGroupFilter: 'all',
  stockSearchQuery: '',
  openStockCatSlug: '',
  today: '',
  date: '',
  isoDay: 1,
  daySubFilter: 'all',
  searchQuery: '',
  rangeStart: '',
  rangeEnd: '',
  isEditingEntry: false,
  profileStaffId: '',
  profileStart: '',
  profileEnd: '',
  profileData: null,
  shifts: {},
  tasks: [],
  staff: [],
  weekly: null,
  rangeData: null
};

function isAdmin() {
  return appState.currentUser?.role === 'admin';
}

const datePicker = document.getElementById('datePicker');
const dayNameBadge = document.getElementById('dayNameBadge');

function getLocalToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatShortTrDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]}`;
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(name || 'OP').slice(0, 2).toUpperCase();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}

async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Oturum süresi doldu.');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız');
  return data;
}

async function loadState(dateStr) {
  const targetDate = dateStr || appState.date || getLocalToday();
  if (!appState.rangeStart || !appState.rangeEnd) {
    const today = getLocalToday();
    appState.rangeStart = shiftDays(today, -6);
    appState.rangeEnd = today;
  }

  const [dailyData, weeklyData, rangeData] = await Promise.all([
    api(`/api/state?date=${encodeURIComponent(targetDate)}`),
    api(`/api/weekly?date=${encodeURIComponent(targetDate)}`),
    api(`/api/range?start=${encodeURIComponent(appState.rangeStart)}&end=${encodeURIComponent(appState.rangeEnd)}`)
  ]);

  appState = {
    ...appState,
    ...dailyData,
    weekly: weeklyData,
    rangeData
  };

  datePicker.value = appState.date;
  document.getElementById('rangeStartInput').value = appState.rangeData.startDate;
  document.getElementById('rangeEndInput').value = appState.rangeData.endDate;
  dayNameBadge.textContent = `${DAY_NAMES[appState.isoDay] || ''} • ${formatShortTrDate(appState.date)}`;
  renderAll();
}

async function loadRangeOnly(startStr, endStr) {
  appState.rangeStart = startStr;
  appState.rangeEnd = endStr;
  const rangeData = await api(
    `/api/range?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}`
  );
  appState.rangeData = rangeData;
  document.getElementById('rangeStartInput').value = rangeData.startDate;
  document.getElementById('rangeEndInput').value = rangeData.endDate;
  renderRangeTables();
}

function isNightShift(person) {
  return person.shift === 'night';
}

function matchesSearch(person) {
  const q = appState.searchQuery.trim().toLowerCase();
  if (!q) return true;
  return (
    person.name.toLowerCase().includes(q) ||
    person.shiftLabel.toLowerCase().includes(q) ||
    person.shiftHours.toLowerCase().includes(q)
  );
}

function applyRoleUi() {
  const u = appState.currentUser;
  if (!u) return;

  document.getElementById('topUserName').textContent = u.name;
  document.getElementById('sidebarAvatar').textContent = getInitials(u.name);
  document.getElementById('sidebarUserName').textContent = u.name;
  document.getElementById('sidebarUserEmail').textContent = u.email || '';

  const roleTag = document.getElementById('sidebarUserRole');
  if (u.role === 'admin') {
    roleTag.textContent = 'YETKİLİ';
    roleTag.classList.remove('role-staff');
  } else {
    roleTag.textContent = 'PERSONEL';
    roleTag.classList.add('role-staff');
  }

  document.getElementById('adminNavGroup').classList.toggle('hidden', !isAdmin());
  document.querySelectorAll('.admin-only-el').forEach((el) => {
    el.classList.toggle('hidden', !isAdmin());
  });
}

function renderSyncStatusUi() {
  const badge = document.getElementById('cloudSyncBadge');
  const st = appState.syncStatus;
  if (!badge) return;

  badge.onclick = () => {
    if (isAdmin()) window.switchTab('firebase');
  };

  if (st && st.connected) {
    badge.className = 'status-pill pill-emerald';
    badge.textContent = '☁ Canlı Senkron';
    badge.title = `Firebase bağlı: ${st.databaseURL}`;
  } else if (st && st.configured) {
    badge.className = 'status-pill pill-coral';
    badge.textContent = '☁ Bağlantı Hatası';
    badge.title = st.lastError || 'Yeniden bağlanılıyor...';
  } else {
    badge.className = 'status-pill pill-gold';
    badge.textContent = isAdmin() ? '☁ Firebase Bağla' : '☁ Yerel Mod';
    badge.title = 'Çoklu bilgisayar senkronizasyonu için Firebase URL tanımlayın';
  }

  const fbAlert = document.getElementById('fbStatusAlert');
  const fbText = document.getElementById('fbStatusText');
  const urlInput = document.getElementById('fbDbUrlInput');
  if (fbAlert && fbText) {
    if (st && st.connected) {
      fbAlert.className = 'ps-alert-emerald';
      fbText.innerHTML = `<strong>✓ Firebase Canlı Senkron Aktif!</strong><div style="font-size:12px; margin-top:3px;">Bağlı Sunucu: <code>${escapeHtml(st.databaseURL)}</code> — Ofisteki tüm bilgisayarlar anlık senkron çalışıyor.</div>`;
    } else if (st && st.configured) {
      fbAlert.className = 'ps-alert-gold';
      fbText.innerHTML = `<strong>⚠ Firebase Bağlantı Sorunu:</strong> ${escapeHtml(st.lastError || 'Sunucuya ulaşılamıyor.')}`;
    } else {
      fbAlert.className = 'ps-alert-gold';
      fbText.innerHTML = `<strong>☁ Şu an Yerel Modda çalışıyor.</strong> Aşağıya ücretsiz Firebase Realtime Database adresinizi girerek tüm ofis bilgisayarlarını senkron hale getirebilirsiniz.`;
    }
    if (urlInput && !urlInput.value && st?.databaseURL) {
      urlInput.value = st.databaseURL;
    }
  }
}

function renderAppUpdateUi() {
  const u = appState.appUpdate;
  const topBtn = document.getElementById('topAppUpdateBtn');
  const verLabel = document.getElementById('currentAppVerLabel');

  if (verLabel && u) {
    verLabel.textContent = `Mevcut: v${u.currentVersion} • Yayınlanan: v${u.latestVersion || u.currentVersion}`;
  }

  const pubVer = document.getElementById('pubVersionInput');
  const pubUrl = document.getElementById('pubUrlInput');
  const pubNotes = document.getElementById('pubNotesInput');
  const activeEl = document.activeElement;

  if (u && pubVer && activeEl !== pubVer && !pubVer.dataset.dirty) {
    pubVer.value = u.latestVersion || u.currentVersion || '1.0.1';
  }
  if (u && pubUrl && activeEl !== pubUrl && !pubUrl.dataset.dirty) {
    pubUrl.value = u.downloadUrl || '';
  }
  if (u && pubNotes && activeEl !== pubNotes && !pubNotes.dataset.dirty) {
    pubNotes.value = u.releaseNotes || '';
  }

  if (!topBtn) return;
  if (appState.isUpdatingExe) return;

  if (u && u.hasUpdate && u.downloadUrl) {
    topBtn.classList.remove('hidden');
    topBtn.textContent = `🚀 Güncelle (v${u.latestVersion})`;
    topBtn.title = u.releaseNotes
      ? `Yeni Sürüm v${u.latestVersion}: ${u.releaseNotes}`
      : `Yeni sürüm (v${u.latestVersion}) hazır — indirip yenilemek için tıklayın`;
  } else {
    topBtn.classList.add('hidden');
  }
}

function renderAll() {
  applyRoleUi();
  renderSyncStatusUi();
  renderAppUpdateUi();
  renderBentoKpis();
  renderDailyTables();
  renderWeeklyTables();
  renderRangeTables();
  renderEntryForm();
  renderScheduleTable();
  if (isAdmin()) renderAdminPanels();
}

function renderBentoKpis() {
  const dayStaff = appState.staff.filter((s) => !isNightShift(s));
  const nightStaff = appState.staff.filter((s) => isNightShift(s));

  const dayActive = dayStaff.filter((s) => !s.isOnLeave).length;
  const dayLeave = dayStaff.filter((s) => s.isOnLeave).length;

  const nightActive = nightStaff.filter((s) => !s.isOnLeave).length;
  const nightLeave = nightStaff.filter((s) => s.isOnLeave).length;

  let liveTotal = 0;
  let submitted = 0;
  const totalWorking = dayActive + nightActive;

  appState.staff.forEach((s) => {
    if (!s.isOnLeave && s.entry && s.entry.values) {
      submitted++;
      const cd = s.entry.values.canli_destek;
      if (cd && typeof cd === 'object' && Number(cd.count)) {
        liveTotal += Number(cd.count);
      }
    }
  });

  document.getElementById('kpiLiveCount').textContent = `${liveTotal} Canlı Bakıldı`;
  document.getElementById('kpiSubmitted').textContent = `${submitted} / ${totalWorking} aktif personel günlük rapor girdi`;
  document.getElementById('kpiDayShift').textContent = `${dayActive} Aktif • ${dayLeave} İzinli`;
  document.getElementById('kpiNightShift').textContent = `${nightActive} Aktif • ${nightLeave} İzinli`;
}

window.openNoteIframe = function (staffId, taskId, dateStr) {
  const frame = document.getElementById('noteViewerFrame');
  const overlay = document.getElementById('noteIframeOverlay');
  frame.src = `/note-view?date=${encodeURIComponent(dateStr)}&staffId=${encodeURIComponent(staffId)}&taskId=${encodeURIComponent(taskId)}`;
  overlay.classList.remove('hidden');
};

window.openRangeNoteIframe = function (staffId, taskId) {
  if (!appState.rangeData) return;
  const frame = document.getElementById('noteViewerFrame');
  const overlay = document.getElementById('noteIframeOverlay');
  frame.src = `/note-view?start=${encodeURIComponent(appState.rangeData.startDate)}&end=${encodeURIComponent(appState.rangeData.endDate)}&staffId=${encodeURIComponent(staffId)}&taskId=${encodeURIComponent(taskId)}`;
  overlay.classList.remove('hidden');
};

window.closeNoteIframe = function () {
  const frame = document.getElementById('noteViewerFrame');
  const overlay = document.getElementById('noteIframeOverlay');
  overlay.classList.add('hidden');
  frame.src = 'about:blank';
};

function formatStatusPill(task, val, staffId, dateOverride = null) {
  const targetDate = dateOverride || appState.date;
  if (val === undefined || val === null || val === '') {
    return `<span class="status-pill pill-muted">Bekliyor</span>`;
  }
  if (task.type === 'yapildi_not') {
    const st = typeof val === 'object' ? val.status || 'Bekliyor' : String(val);
    if (st === 'Yapıldı') {
      const canViewNote = isAdmin() || appState.currentUser?.id === staffId;
      if (canViewNote) {
        return `<span class="status-pill pill-emerald clickable-note-pill" onclick="openNoteIframe('${staffId}', '${task.id}', '${targetDate}')" title="Yapılan işi görmek için tıklayın">✓ Yapıldı • 📝 Not</span>`;
      }
      return `<span class="status-pill pill-emerald">✓ Yapıldı</span>`;
    }
    if (st === 'Yapılmadı') {
      return `<span class="status-pill pill-coral">✕ Yapılmadı</span>`;
    }
    return `<span class="status-pill pill-muted">Bekliyor</span>`;
  }
  if (task.type === 'count_bakildi') {
    if (typeof val === 'object') {
      const cnt = Number(val.count) || 0;
      const st = val.status || 'Bakıldı';
      if (st === 'Bakılmadı' && cnt === 0) {
        return `<span class="status-pill pill-coral">✕ Bakılmadı</span>`;
      }
      if (st === 'Bekliyor' && cnt === 0) {
        return `<span class="status-pill pill-muted">Bekliyor</span>`;
      }
      return `<span class="status-pill pill-emerald">✓ ${cnt} ${escapeHtml(task.unit || 'Canlı Bakıldı')}</span>`;
    }
    return `<span class="status-pill pill-emerald">✓ ${escapeHtml(String(val))}</span>`;
  }

  const str = String(val);
  if (str === 'Bakıldı' || str === 'Yapıldı') {
    return `<span class="status-pill pill-emerald">✓ ${escapeHtml(str)}</span>`;
  }
  if (str === 'Bakılmadı' || str === 'Yapılmadı') {
    return `<span class="status-pill pill-coral">✕ ${escapeHtml(str)}</span>`;
  }
  if (str === 'Bekliyor') {
    return `<span class="status-pill pill-muted">Bekliyor</span>`;
  }
  return `<span class="status-pill pill-emerald">${escapeHtml(str)}</span>`;
}

function formatAttendanceCell(entry) {
  if (!entry) {
    return `<span class="status-pill pill-muted">Bekliyor</span>`;
  }
  const att = entry.attendance || {};
  if (!att.lateArrival && !att.lateExit) {
    return `<span class="status-pill pill-emerald">✓ Zamanında</span>`;
  }
  const pills = [];
  if (att.lateArrival) {
    const sub = att.lateArrivalNote ? ` (${escapeHtml(att.lateArrivalNote)})` : '';
    pills.push(`<span class="status-pill pill-coral">⚠ Geç Katıldı${sub}</span>`);
  }
  if (att.lateExit) {
    const sub = att.lateExitNote ? ` (${escapeHtml(att.lateExitNote)})` : '';
    pills.push(`<span class="status-pill pill-gold">+ Geç Çıktı${sub}</span>`);
  }
  return `<div class="attendance-cell-stack">${pills.join('')}</div>`;
}

function buildDailyHeadHtml() {
  const cols = appState.tasks.map((t) => `<th>${escapeHtml(t.title)}</th>`).join('');
  return `
    <tr>
      <th>PERSONEL & VARDİYA</th>
      <th>GİRİŞ / ÇIKIŞ</th>
      ${cols}
      <th>NOT</th>
      <th>İŞLEM</th>
    </tr>
  `;
}

function buildPersonCellHtml(s) {
  const is12h = s.shift === 'morning_12';
  const clickAttrs = isAdmin()
    ? `class="person-cell person-clickable" onclick="openStaffProfile('${s.id}')" title="Personel profilini ve istatistiklerini görüntüle"`
    : `class="person-cell"`;
  return `
    <div ${clickAttrs}>
      <div class="person-avatar">${escapeHtml(getInitials(s.name))}</div>
      <div class="person-meta">
        <span class="person-name">${escapeHtml(s.name)}</span>
        <span class="person-shift-sub ${is12h ? 'tag-12h' : ''}">${escapeHtml(s.shiftLabel)} • ${escapeHtml(s.shiftHours)}</span>
      </div>
    </div>
  `;
}

function buildDailyRowsHtml(staffList, emptyMsg) {
  if (staffList.length === 0) {
    return `<tr><td colspan="${appState.tasks.length + 4}" style="text-align:center; padding:26px; color:#64748b;">${escapeHtml(emptyMsg)}</td></tr>`;
  }

  return staffList
    .map((s) => {
      const personCell = buildPersonCellHtml(s);

      if (s.isOnLeave) {
        const leaveCells = appState.tasks
          .map(() => `<td><span class="status-pill pill-gold">● İZİNLİ</span></td>`)
          .join('');
        return `
          <tr class="is-leave-row">
            <td>${personCell}</td>
            <td><span class="status-pill pill-gold">● İZİNLİ</span></td>
            ${leaveCells}
            <td style="color:#94a3b8;">İzinli Gün</td>
            <td>
              ${
                isAdmin()
                  ? `<button class="mini-btn" onclick="toggleDateLeave('${s.id}', 'work')">Mesaiye Aç</button>`
                  : `<span style="color:#64748b;">-</span>`
              }
            </td>
          </tr>
        `;
      }

      const values = s.entry?.values || {};
      const hasEntry = Boolean(s.entry);
      const canAct =
        isAdmin() || (appState.currentUser?.id === s.id && appState.date === appState.today);

      const taskCells = appState.tasks
        .map((t) => `<td>${formatStatusPill(t, values[t.id], s.id)}</td>`)
        .join('');
      const noteHtml = s.entry?.note
        ? `<span style="color:#cbd5e1;">${escapeHtml(s.entry.note)}</span>`
        : `<span style="color:#475569;">-</span>`;

      let actionsHtml = `<span style="color:#475569;">-</span>`;
      if (canAct || isAdmin()) {
        const entryBtn = canAct
          ? `<button class="mini-btn" onclick="openEntryForStaff('${s.id}', ${hasEntry})">${hasEntry ? '✎ Düzenle' : 'Veri Gir'}</button>`
          : '';
        const leaveBtn = isAdmin()
          ? `<button class="mini-btn" onclick="toggleDateLeave('${s.id}', 'leave')">İzinli</button>`
          : '';
        actionsHtml = `<div class="row-btn-group">${entryBtn}${leaveBtn}</div>`;
      }

      return `
        <tr>
          <td>${personCell}</td>
          <td>${formatAttendanceCell(s.entry)}</td>
          ${taskCells}
          <td>${noteHtml}</td>
          <td>${actionsHtml}</td>
        </tr>
      `;
    })
    .join('');
}

function renderDailyTables() {
  const headHtml = buildDailyHeadHtml();
  document.getElementById('dayShiftThead').innerHTML = headHtml;
  document.getElementById('nightShiftThead').innerHTML = headHtml;

  const dayList = appState.staff.filter((s) => {
    if (isNightShift(s)) return false;
    if (!matchesSearch(s)) return false;
    if (appState.daySubFilter !== 'all' && s.shift !== appState.daySubFilter) return false;
    return true;
  });

  const nightList = appState.staff.filter((s) => isNightShift(s) && matchesSearch(s));

  document.getElementById('dayShiftTbody').innerHTML = buildDailyRowsHtml(
    dayList,
    'Sabah veya Öğle vardiyasında eşleşen personel bulunamadı.'
  );
  document.getElementById('nightShiftTbody').innerHTML = buildDailyRowsHtml(
    nightList,
    'Gece vardiyasında eşleşen personel bulunamadı.'
  );
}

function renderWeeklyTables() {
  if (!appState.weekly) return;
  const { weekDays, staff } = appState.weekly;

  if (weekDays.length === 7) {
    document.getElementById('weekRangeText').textContent = `${formatShortTrDate(weekDays[0].date)} — ${formatShortTrDate(weekDays[6].date)} (${weekDays[6].date.slice(0, 4)})`;
  }

  const headCols = weekDays
    .map(
      (wd) =>
        `<th>${DAY_NAMES[wd.isoDay].toUpperCase()}<div style="font-size:10px; color:#94a3b8; margin-top:2px;">${formatShortTrDate(wd.date)}</div></th>`
    )
    .join('');

  const headHtml = `
    <tr>
      <th>PERSONEL & VARDİYA</th>
      ${headCols}
      <th>HAFTALIK TOPLAM</th>
    </tr>
  `;

  document.getElementById('weeklyDayThead').innerHTML = headHtml;
  document.getElementById('weeklyNightThead').innerHTML = headHtml;

  const dayWeekly = staff.filter((s) => !isNightShift(s) && matchesSearch(s));
  const nightWeekly = staff.filter((s) => isNightShift(s) && matchesSearch(s));

  document.getElementById('weeklyDayTbody').innerHTML = buildWeeklyRowsHtml(
    dayWeekly,
    'Sabah & Öğle vardiyasında personel yok.'
  );
  document.getElementById('weeklyNightTbody').innerHTML = buildWeeklyRowsHtml(
    nightWeekly,
    'Gece vardiyasında personel yok.'
  );
}

function buildWeeklyRowsHtml(list, emptyMsg) {
  if (list.length === 0) {
    return `<tr><td colspan="9" style="text-align:center; padding:26px; color:#64748b;">${escapeHtml(emptyMsg)}</td></tr>`;
  }

  return list
    .map((s) => {
      const personCell = buildPersonCellHtml(s);

      const dayCells = s.days
        .map((d) => {
          if (d.isOnLeave) {
            return `<td class="weekly-day-cell" onclick="jumpToDate('${d.date}')"><span class="status-pill pill-gold">● İZİNLİ</span></td>`;
          }
          if (!d.hasEntry) {
            return `<td class="weekly-day-cell" onclick="jumpToDate('${d.date}')"><span class="status-pill pill-muted">Bekliyor</span></td>`;
          }
          const label =
            d.liveCount > 0
              ? `✓ ${d.liveCount} Canlı (${d.doneTasks}/${d.totalTasks})`
              : `✓ ${d.doneTasks}/${d.totalTasks} Görev`;
          return `<td class="weekly-day-cell" onclick="jumpToDate('${d.date}')"><span class="status-pill pill-emerald">${escapeHtml(label)}</span></td>`;
        })
        .join('');

      const summaryHtml = `
        <td>
          <strong style="color:#f8fafc;">${s.summary.totalLiveCount} Canlı</strong>
          <div style="font-size:11.5px; color:#94a3b8;">${s.summary.completedDays} Mesai • ${s.summary.leaveDays} İzin</div>
        </td>
      `;

      return `
        <tr>
          <td>${personCell}</td>
          ${dayCells}
          ${summaryHtml}
        </tr>
      `;
    })
    .join('');
}

window.jumpToDate = async function (dateStr) {
  await loadState(dateStr);
  switchTab('daily');
};

function renderRangeTables() {
  if (!appState.rangeData) return;
  const { startDate, endDate, dayCount, tasks, grandSummary, staff } = appState.rangeData;

  document.getElementById('rangeTotalLive').textContent = `${grandSummary.grandLiveTotal} Canlı Bakıldı`;
  document.getElementById('rangeDateSpanLabel').textContent = `${formatShortTrDate(startDate)} — ${formatShortTrDate(endDate)} (${endDate.slice(0, 4)})`;
  document.getElementById('rangeDayCountVal').textContent = `${dayCount} Gün`;
  document.getElementById('rangeReportRatio').textContent = `${grandSummary.grandReportedDays} Rapor / ${grandSummary.grandWorkingDays} Mesai`;
  document.getElementById('rangeTotalLeave').textContent = `${grandSummary.grandLeaveDays} İzin Günü`;

  const taskHeaders = tasks.map((t) => `<th>${escapeHtml(t.title)} (TOTAL)</th>`).join('');
  const headHtml = `
    <tr>
      <th>PERSONEL & VARDİYA</th>
      <th>MESAİ / İZİN</th>
      <th>GİRİŞ / ÇIKIŞ</th>
      ${taskHeaders}
    </tr>
  `;

  document.getElementById('rangeDayThead').innerHTML = headHtml;
  document.getElementById('rangeNightThead').innerHTML = headHtml;

  const dayList = staff.filter((s) => !isNightShift(s) && matchesSearch(s));
  const nightList = staff.filter((s) => isNightShift(s) && matchesSearch(s));

  const dayBuilt = buildRangeSectionHtml(dayList, tasks, 'Sabah & Öğle vardiyasında personel bulunamadı.');
  document.getElementById('rangeDayTbody').innerHTML = dayBuilt.tbody;
  document.getElementById('rangeDayTfoot').innerHTML = dayBuilt.tfoot;

  const nightBuilt = buildRangeSectionHtml(nightList, tasks, 'Gece vardiyasında personel bulunamadı.');
  document.getElementById('rangeNightTbody').innerHTML = nightBuilt.tbody;
  document.getElementById('rangeNightTfoot').innerHTML = nightBuilt.tfoot;
}

function buildRangeSectionHtml(list, tasks, emptyMsg) {
  if (list.length === 0) {
    return {
      tbody: `<tr><td colspan="${tasks.length + 3}" style="text-align:center; padding:26px; color:#64748b;">${escapeHtml(emptyMsg)}</td></tr>`,
      tfoot: ''
    };
  }

  let sumWorking = 0;
  let sumReported = 0;
  let sumLeave = 0;
  let sumLateArr = 0;
  let sumLateEx = 0;
  const colSums = {};
  tasks.forEach((t) => {
    colSums[t.id] = { count: 0, doneDays: 0 };
  });

  const tbody = list
    .map((s) => {
      sumWorking += s.workingDays;
      sumReported += s.reportedDays;
      sumLeave += s.leaveDays;
      sumLateArr += s.lateArrivalCount || 0;
      sumLateEx += s.lateExitCount || 0;

      const personCell = buildPersonCellHtml(s);

      const shiftSummaryCell = `
        <td>
          <strong style="color:#f8fafc;">${s.reportedDays} Rapor / ${s.workingDays} Mesai</strong>
          <div style="font-size:11.5px; color:#f5b800;">${s.leaveDays} Gün İzinli</div>
        </td>
      `;

      const la = s.lateArrivalCount || 0;
      const le = s.lateExitCount || 0;
      let attTotalHtml = `<span class="status-pill pill-muted">-</span>`;
      if (s.reportedDays > 0 && la === 0 && le === 0) {
        attTotalHtml = `<span class="status-pill pill-emerald">✓ Tam Zamanında</span>`;
      } else if (la > 0 || le > 0) {
        const parts = [];
        if (la > 0) parts.push(`<span class="status-pill pill-coral">⚠ ${la} Geç Katılım</span>`);
        if (le > 0) parts.push(`<span class="status-pill pill-gold">+ ${le} Geç Çıkış</span>`);
        attTotalHtml = `<div class="attendance-cell-stack">${parts.join('')}</div>`;
      }

      const taskCells = tasks
        .map((t) => {
          const st = s.taskStats[t.id] || { count: 0, doneDays: 0, missedDays: 0 };
          colSums[t.id].count += st.count;
          colSums[t.id].doneDays += st.doneDays;

          if (t.type === 'count_bakildi') {
            const avg = s.reportedDays > 0 ? Math.round(st.count / s.reportedDays) : 0;
            if (st.count > 0 || st.doneDays > 0) {
              return `
                <td>
                  <span class="status-pill pill-emerald">✓ ${st.count} ${escapeHtml(t.unit || 'Toplam')}</span>
                  <div style="font-size:11px; color:#94a3b8; margin-top:4px; padding-left:4px;">${st.doneDays} gün • Ort: ${avg}/gün</div>
                </td>
              `;
            }
            return `<td><span class="status-pill pill-muted">0 Kayıt</span></td>`;
          }

          if (t.type === 'yapildi_not' && st.doneDays > 0) {
            const canViewNote = isAdmin() || appState.currentUser?.id === s.id;
            const pillHtml = canViewNote
              ? `<span class="status-pill pill-emerald clickable-note-pill" onclick="openRangeNoteIframe('${s.id}', '${t.id}')" title="Tarih aralığındaki ekstra görev notlarını görüntüle">✓ ${st.doneDays} Gün Yapıldı • 📝</span>`
              : `<span class="status-pill pill-emerald">✓ ${st.doneDays} Gün Yapıldı</span>`;
            return `<td>${pillHtml}</td>`;
          }

          if (st.doneDays > 0) {
            const actionWord = t.type === 'yapildi' ? 'Yapıldı' : 'Bakıldı';
            return `
              <td>
                <span class="status-pill pill-emerald">✓ ${st.doneDays} / ${s.workingDays} Gün ${actionWord}</span>
                ${
                  st.missedDays > 0
                    ? `<div style="font-size:11px; color:#ef4444; margin-top:4px; padding-left:4px;">✕ ${st.missedDays} gün eksik</div>`
                    : ''
                }
              </td>
            `;
          }

          if (st.missedDays > 0) {
            return `<td><span class="status-pill pill-coral">✕ ${st.missedDays} Gün Yapılmadı</span></td>`;
          }

          return `<td><span class="status-pill pill-muted">0 / ${s.workingDays} Gün</span></td>`;
        })
        .join('');

      return `
        <tr>
          <td>${personCell}</td>
          ${shiftSummaryCell}
          <td>${attTotalHtml}</td>
          ${taskCells}
        </tr>
      `;
    })
    .join('');

  const footTaskCells = tasks
    .map((t) => {
      const cs = colSums[t.id];
      if (t.type === 'count_bakildi') {
        return `<td style="color:#f5b800;">Toplam: ${cs.count} (${cs.doneDays} gün)</td>`;
      }
      return `<td style="color:#10b981;">Toplam: ${cs.doneDays} görev günü</td>`;
    })
    .join('');

  const tfoot = `
    <tr>
      <td>VARDİYA GENEL TOPLAMI (${list.length} Personel)</td>
      <td>${sumReported} Rapor / ${sumWorking} Mesai • ${sumLeave} İzin</td>
      <td>${sumLateArr} Geç Katılım • ${sumLateEx} Geç Çıkış</td>
      ${footTaskCells}
    </tr>
  `;

  return { tbody, tfoot };
}

window.scrollToElement = function (elId) {
  switchTab('daily');
  const el = document.getElementById(elId);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.toggleDateLeave = async function (staffId, mode) {
  await api('/api/leaves/override', 'POST', {
    date: appState.date,
    staffId,
    mode
  });
  await loadState(appState.date);
  showToast(mode === 'leave' ? 'Personel bugün İZİNLİ işaretlendi.' : 'Personel bugün mesaiye açıldı.');
};

window.openEntryForStaff = function (staffId, startInEditMode = false) {
  appState.isEditingEntry = Boolean(startInEditMode);
  switchTab('entry');
  const sel = document.getElementById('entryStaffSelect');
  sel.value = staffId;
  populateEntryFieldsForSelectedStaff();
};

function renderEntryForm() {
  const sel = document.getElementById('entryStaffSelect');
  const prevVal = sel.value;

  const allowedList = isAdmin()
    ? appState.staff
    : appState.staff.filter((s) => s.id === appState.currentUser?.id);

  sel.innerHTML = allowedList
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} — ${escapeHtml(s.shiftLabel)} (${escapeHtml(s.shiftHours)})</option>`)
    .join('');

  sel.disabled = !isAdmin();

  if (prevVal && allowedList.some((s) => s.id === prevVal)) {
    sel.value = prevVal;
  }
  populateEntryFieldsForSelectedStaff();
}

function populateEntryFieldsForSelectedStaff() {
  const sel = document.getElementById('entryStaffSelect');
  const person = appState.staff.find((s) => s.id === sel.value) || appState.staff[0];
  const container = document.getElementById('dynamicTaskInputs');
  const infoBox = document.getElementById('entryStaffInfo');
  const leaveWarn = document.getElementById('leaveWarningBox');
  const dateWarn = document.getElementById('dateRestrictionBox');
  const existsBanner = document.getElementById('entryExistsBanner');
  const existsSub = document.getElementById('entryExistsSub');
  const unlockEditBtn = document.getElementById('unlockEditBtn');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const submitBtn = document.getElementById('entrySubmitBtn');
  const markAllBtn = document.getElementById('markAllDoneBtn');
  const noteInput = document.getElementById('entryNote');

  if (!person || (!isAdmin() && person.id !== appState.currentUser?.id)) {
    container.innerHTML = '<div style="color:#94a3b8;">Yetkili hesabınız personel vardiya listesinde yer almıyor. Personel seçerek işlem yapabilirsiniz.</div>';
    infoBox.textContent = '-';
    existsBanner.classList.add('hidden');
    submitBtn.disabled = true;
    return;
  }

  const isNonTodayStaff = !isAdmin() && appState.date !== appState.today;
  dateWarn.classList.toggle('hidden', !isNonTodayStaff);

  infoBox.textContent = `${person.shiftLabel} (${person.shiftHours}) • ${person.isOnLeave ? 'İZİNLİ' : 'AKTİF MESAİ'}`;
  leaveWarn.classList.toggle('hidden', !person.isOnLeave);

  const hasEntry = Boolean(person.entry);
  if (!hasEntry) {
    appState.isEditingEntry = false;
  }

  const isLocked = isNonTodayStaff || (hasEntry && !appState.isEditingEntry);

  if (hasEntry && !isNonTodayStaff) {
    existsBanner.classList.remove('hidden');
    const updatedStr = person.entry.updatedAt
      ? new Date(person.entry.updatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
      : '';
    if (appState.isEditingEntry) {
      existsSub.textContent = `Düzenleme modu açık. Değişikliklerinizi kaydederek mevcut raporu güncelleyebilirsiniz.`;
      unlockEditBtn.classList.add('hidden');
    } else {
      existsSub.textContent = `${updatedStr ? `Son kayıt saati: ${updatedStr}. ` : ''}Bugün için tekrar yeni giriş yapılamaz; yalnızca mevcut kayıt düzenlenebilir.`;
      unlockEditBtn.classList.remove('hidden');
    }
  } else {
    existsBanner.classList.add('hidden');
  }

  cancelEditBtn.classList.toggle('hidden', !(hasEntry && appState.isEditingEntry));
  submitBtn.textContent = hasEntry ? 'Değişiklikleri Güncelle' : 'Günlük Raporu Kaydet';
  submitBtn.disabled = isLocked;
  markAllBtn.disabled = isLocked;
  noteInput.disabled = isLocked;

function syncAttendanceUi() {
  const laCheck = document.getElementById('lateArrivalCheck');
  const leCheck = document.getElementById('lateExitCheck');
  document.getElementById('lateArrivalDetailWrap').classList.toggle('hidden', !laCheck.checked);
  document.getElementById('lateExitDetailWrap').classList.toggle('hidden', !leCheck.checked);
  document.getElementById('lateArrivalBox').classList.toggle('active-coral', laCheck.checked);
  document.getElementById('lateExitBox').classList.toggle('active-gold', leCheck.checked);
}

  const existing = person.entry?.values || {};
  const att = person.entry?.attendance || {};
  noteInput.value = person.entry?.note || '';

  const laCheck = document.getElementById('lateArrivalCheck');
  const laNote = document.getElementById('lateArrivalNote');
  const leCheck = document.getElementById('lateExitCheck');
  const leNote = document.getElementById('lateExitNote');

  laCheck.checked = Boolean(att.lateArrival);
  laNote.value = att.lateArrivalNote || '';
  leCheck.checked = Boolean(att.lateExit);
  leNote.value = att.lateExitNote || '';

  laCheck.disabled = isLocked;
  laNote.disabled = isLocked;
  leCheck.disabled = isLocked;
  leNote.disabled = isLocked;
  syncAttendanceUi();

  const disAttr = isLocked ? 'disabled' : '';

  container.innerHTML = appState.tasks
    .map((t) => {
      const cur = existing[t.id];
      if (t.type === 'count_bakildi') {
        const countVal = cur && typeof cur === 'object' ? cur.count ?? 0 : 0;
        const statusVal = cur && typeof cur === 'object' ? cur.status || 'Bakıldı' : 'Bekliyor';
        return `
          <div class="task-field-card">
            <h4>${escapeHtml(t.title)}</h4>
            <div class="count-pair">
              <input type="number" min="0" class="ps-input" data-task-count="${t.id}" value="${countVal}" placeholder="Adet" ${disAttr} />
              <select class="ps-input" data-task-status="${t.id}" ${disAttr}>
                <option value="Bekliyor" ${statusVal === 'Bekliyor' ? 'selected' : ''}>Bekliyor</option>
                <option value="Bakıldı" ${statusVal === 'Bakıldı' ? 'selected' : ''}>Bakıldı</option>
                <option value="Bakılmadı" ${statusVal === 'Bakılmadı' ? 'selected' : ''}>Bakılmadı</option>
              </select>
            </div>
          </div>
        `;
      }

      if (t.type === 'bakildi') {
        const v = cur || 'Bekliyor';
        return `
          <div class="task-field-card">
            <h4>${escapeHtml(t.title)}</h4>
            <select class="ps-input" data-task-val="${t.id}" ${disAttr}>
              <option value="Bekliyor" ${v === 'Bekliyor' ? 'selected' : ''}>Bekliyor</option>
              <option value="Bakıldı" ${v === 'Bakıldı' ? 'selected' : ''}>Bakıldı</option>
              <option value="Bakılmadı" ${v === 'Bakılmadı' ? 'selected' : ''}>Bakılmadı</option>
            </select>
          </div>
        `;
      }

      if (t.type === 'yapildi') {
        const v = cur || 'Bekliyor';
        return `
          <div class="task-field-card">
            <h4>${escapeHtml(t.title)}</h4>
            <select class="ps-input" data-task-val="${t.id}" ${disAttr}>
              <option value="Bekliyor" ${v === 'Bekliyor' ? 'selected' : ''}>Bekliyor</option>
              <option value="Yapıldı" ${v === 'Yapıldı' ? 'selected' : ''}>Yapıldı</option>
              <option value="Yapılmadı" ${v === 'Yapılmadı' ? 'selected' : ''}>Yapılmadı</option>
            </select>
          </div>
        `;
      }

      if (t.type === 'yapildi_not') {
        const st = cur && typeof cur === 'object' ? cur.status || 'Bekliyor' : cur || 'Bekliyor';
        const noteVal = cur && typeof cur === 'object' ? cur.note || '' : '';
        return `
          <div class="task-field-card">
            <h4>${escapeHtml(t.title)}</h4>
            <select class="ps-input" data-extra-status="${t.id}" ${disAttr}>
              <option value="Bekliyor" ${st === 'Bekliyor' ? 'selected' : ''}>Bekliyor</option>
              <option value="Yapıldı" ${st === 'Yapıldı' ? 'selected' : ''}>Yapıldı (Not Ekle)</option>
              <option value="Yapılmadı" ${st === 'Yapılmadı' ? 'selected' : ''}>Yapılmadı / Yok</option>
            </select>
            <div id="extraNoteWrap_${t.id}" class="${st === 'Yapıldı' ? '' : 'hidden'}" style="margin-top:6px;">
              <textarea rows="2" class="ps-input" style="width:100%; resize:vertical;" data-extra-note="${t.id}" placeholder="Yaptığınız ekstra işi buraya yazın..." ${disAttr}>${escapeHtml(noteVal)}</textarea>
            </div>
          </div>
        `;
      }

      return `
        <div class="task-field-card">
          <h4>${escapeHtml(t.title)}</h4>
          <input type="text" class="ps-input" data-task-val="${t.id}" value="${escapeHtml(cur ? String(cur) : '')}" placeholder="Durum girin..." ${disAttr} />
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('[data-task-count]').forEach((cntInput) => {
    cntInput.addEventListener('input', () => {
      const tid = cntInput.dataset.taskCount;
      const stSel = container.querySelector(`[data-task-status="${tid}"]`);
      if (Number(cntInput.value) > 0 && stSel && stSel.value === 'Bekliyor') {
        stSel.value = 'Bakıldı';
      }
    });
  });

  container.querySelectorAll('[data-extra-status]').forEach((selEl) => {
    selEl.addEventListener('change', () => {
      const tid = selEl.dataset.extraStatus;
      const wrap = document.getElementById(`extraNoteWrap_${tid}`);
      if (wrap) {
        const isDone = selEl.value === 'Yapıldı';
        wrap.classList.toggle('hidden', !isDone);
        if (isDone) {
          const ta = wrap.querySelector('textarea');
          if (ta) ta.focus();
        }
      }
    });
  });
}

function formatDmySlash(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function renderScheduleTable() {
  const thead = document.getElementById('scheduleThead');
  const tbody = document.getElementById('scheduleTbody');
  const weekDays = appState.weekly?.weekDays || [];

  const dayHeadersHtml = [1, 2, 3, 4, 5, 6, 7]
    .map((isoDay) => {
      const wd = weekDays.find((w) => w.isoDay === isoDay);
      const dmy = wd ? formatDmySlash(wd.date) : '';
      const isSelectedDay = wd && wd.date === appState.date;
      const dateColor = isSelectedDay ? '#10b981' : '#f5b800';
      return `
        <th style="text-align:center;">
          <div style="font-size:11.5px; font-weight:800; color:${dateColor}; margin-bottom:3px; letter-spacing:0.3px;">${escapeHtml(dmy)}</div>
          <div>${DAY_NAMES[isoDay].toUpperCase()}</div>
        </th>
      `;
    })
    .join('');

  thead.innerHTML = `
    <tr>
      <th>PERSONEL</th>
      <th>VARDİYA GRUBU</th>
      ${dayHeadersHtml}
    </tr>
  `;

  const sorted = [
    ...appState.staff.filter((s) => !isNightShift(s)),
    ...appState.staff.filter((s) => isNightShift(s))
  ];

  tbody.innerHTML = sorted
    .map((s) => {
      const cells = [1, 2, 3, 4, 5, 6, 7]
        .map((isoDay) => {
          const isOff = Array.isArray(s.weeklyOffDays) && s.weeklyOffDays.includes(isoDay);
          const badge = isOff
            ? '<span class="status-pill pill-gold">● İZİNLİ</span>'
            : '<span class="status-pill pill-emerald">✓ Çalışıyor</span>';
          if (isAdmin()) {
            return `<td class="clickable-cell" onclick="toggleWeeklyLeave('${s.id}', ${isoDay})">${badge}</td>`;
          }
          return `<td style="text-align:center;">${badge}</td>`;
        })
        .join('');

      const shiftCellHtml = isAdmin()
        ? `
          <td>
            <select class="schedule-shift-select" onchange="updateStaffField('${s.id}', { shift: this.value })" title="Vardiyayı değiştir">
              <option value="morning" ${s.shift === 'morning' ? 'selected' : ''}>Sabah (09:00 - 18:00)</option>
              <option value="morning_12" ${s.shift === 'morning_12' ? 'selected' : ''}>Sabah (12 Saat) (09:00 - 21:00)</option>
              <option value="afternoon" ${s.shift === 'afternoon' ? 'selected' : ''}>Öğle (12:00 - 21:00)</option>
              <option value="night" ${s.shift === 'night' ? 'selected' : ''}>Gece (21:00 - 09:00)</option>
            </select>
            ${
              s.customHours
                ? `<div style="font-size:11px; color:#f5b800; margin-top:3px; padding-left:4px;">Özel Saat: ${escapeHtml(s.customHours)}</div>`
                : ''
            }
          </td>
        `
        : `<td style="color:#94a3b8;">${escapeHtml(s.shiftLabel)} (${escapeHtml(s.shiftHours)})</td>`;

      const nameHtml = isAdmin()
        ? `<span class="person-clickable" onclick="openStaffProfile('${s.id}')" title="Profili görüntüle"><strong>${escapeHtml(s.name)}</strong></span>`
        : `<strong>${escapeHtml(s.name)}</strong>`;

      return `
        <tr>
          <td>${nameHtml}</td>
          ${shiftCellHtml}
          ${cells}
        </tr>
      `;
    })
    .join('');
}

window.toggleWeeklyLeave = async function (staffId, isoDay) {
  await api('/api/leaves/weekly', 'POST', { staffId, isoDay });
  await loadState(appState.date);
  showToast('Haftalık izin planı güncellendi.');
};

function renderAdminPanels() {
  const staffList = document.getElementById('adminStaffList');
  staffList.innerHTML = appState.staff
    .map(
      (s) => `
      <div class="admin-row-card">
        <div class="person-cell person-clickable" onclick="openStaffProfile('${s.id}')" title="Personel profilini aç">
          <div class="person-avatar">${escapeHtml(getInitials(s.name))}</div>
          <div class="person-meta">
            <span class="person-name">
              ${escapeHtml(s.name)}
              <span class="role-mini-tag ${s.role === 'admin' ? '' : 'role-staff'}" style="margin-left:6px;">
                ${s.role === 'admin' ? 'YETKİLİ' : 'PERSONEL'}
              </span>
            </span>
            <span class="person-shift-sub">${escapeHtml(s.email || '')} • ${escapeHtml(s.shiftLabel)} (${escapeHtml(s.shiftHours)})</span>
          </div>
        </div>

        <div class="admin-controls">
          <select class="ps-input" onchange="updateStaffField('${s.id}', { role: this.value })" title="Yetki Rolü">
            <option value="staff" ${s.role !== 'admin' ? 'selected' : ''}>Personel</option>
            <option value="admin" ${s.role === 'admin' ? 'selected' : ''}>Yetkili</option>
          </select>
          <select class="ps-input" onchange="updateStaffField('${s.id}', { shift: this.value })">
            <option value="morning" ${s.shift === 'morning' ? 'selected' : ''}>Sabah (09:00 - 18:00)</option>
            <option value="morning_12" ${s.shift === 'morning_12' ? 'selected' : ''}>Sabah 12 Saat (09:00 - 21:00)</option>
            <option value="afternoon" ${s.shift === 'afternoon' ? 'selected' : ''}>Öğle (12:00 - 21:00)</option>
            <option value="night" ${s.shift === 'night' ? 'selected' : ''}>Gece (21:00 - 09:00)</option>
          </select>
          <input
            type="text"
            class="ps-input"
            style="width:140px;"
            placeholder="Özel saat"
            value="${escapeHtml(s.customHours || '')}"
            onchange="updateStaffField('${s.id}', { customHours: this.value })"
          />
          <input
            type="password"
            class="ps-input"
            style="width:135px;"
            placeholder="Yeni şifre..."
            onchange="if(this.value){ updateStaffField('${s.id}', { password: this.value }); this.value=''; }"
          />
          <button class="mini-btn mini-btn-danger" onclick="deleteStaff('${s.id}')">Sil</button>
        </div>
      </div>
    `
    )
    .join('');

  const typeLabels = {
    count_bakildi: 'Sayı + Bakıldı',
    bakildi: 'Bakıldı / Bakılmadı',
    yapildi: 'Yapıldı / Yapılmadı',
    yapildi_not: 'Yapıldı + Detay Notu (Iframe)',
    text: 'Serbest Metin'
  };

  document.getElementById('adminTaskList').innerHTML = appState.tasks
    .map(
      (t) => `
      <div class="admin-row-card">
        <div>
          <strong>${escapeHtml(t.title)}</strong>
          <div style="font-size:12px; color:#94a3b8;">Veri Tipi: ${typeLabels[t.type] || t.type}</div>
        </div>
        <button class="mini-btn mini-btn-danger" onclick="deleteTask('${t.id}')">Sütunu Sil</button>
      </div>
    `
    )
    .join('');
}

window.updateStaffField = async function (id, payload) {
  try {
    await api(`/api/staff/${id}`, 'PUT', payload);
    await loadState(appState.date);
    showToast('Personel bilgileri güncellendi.');
  } catch (err) {
    alert(err.message);
  }
};

window.deleteStaff = async function (id) {
  if (!confirm('Personeli silmek istediğinize emin misiniz?')) return;
  await api(`/api/staff/${id}`, 'DELETE');
  await loadState(appState.date);
  showToast('Personel silindi.');
};

window.deleteTask = async function (id) {
  if (!confirm('Bu iş kolu sütununu kaldırmak istediğinize emin misiniz?')) return;
  await api(`/api/tasks/${id}`, 'DELETE');
  await loadState(appState.date);
  showToast('İş kolu kaldırıldı.');
};

window.openAccordionGroup = function (groupEl) {
  if (!groupEl) return;
  document.querySelectorAll('.sidebar .nav-group').forEach((grp) => {
    grp.classList.toggle('open', grp === groupEl);
  });
};

window.switchTab = function (tabName) {
  if (appState.activeTab !== 'profile' && tabName === 'profile') {
    appState.previousTab = appState.activeTab;
  }
  appState.activeTab = tabName;
  document.querySelectorAll('.nav-item').forEach((btn) => {
    const isMatch = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isMatch);
    if (isMatch) {
      const parentGroup = btn.closest('.nav-group');
      if (parentGroup && !parentGroup.classList.contains('open')) {
        window.openAccordionGroup(parentGroup);
      }
    }
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });

  const meta = TAB_META[tabName] || TAB_META.daily;
  document.getElementById('pageHeadingIcon').textContent = meta.icon;
  document.getElementById('pageHeadingTitle').textContent = meta.title;
  document.getElementById('pageHeadingSub').textContent = meta.sub;
  const bento = document.querySelector('.bento-grid');
  if (bento) bento.classList.toggle('hidden', tabName === 'profile' || tabName === 'stock-check');
  if (tabName === 'stock-check' && !appState.stockScanData) {
    loadCachedStockScan();
  }
};

window.openStaffProfile = async function (staffId) {
  if (!isAdmin()) return;
  const today = appState.today || getLocalToday();
  if (!appState.profileStart || !appState.profileEnd) {
    appState.profileStart = shiftDays(today, -13);
    appState.profileEnd = today;
  }
  appState.profileStaffId = staffId;
  window.switchTab('profile');
  await loadProfileData(staffId, appState.profileStart, appState.profileEnd);
};

async function loadProfileData(staffId, startStr, endStr) {
  if (!isAdmin() || !staffId) return;
  const data = await api(
    `/api/staff/${encodeURIComponent(staffId)}/profile?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}`
  );
  appState.profileData = data;
  appState.profileStart = data.startDate;
  appState.profileEnd = data.endDate;
  document.getElementById('profStartInput').value = data.startDate;
  document.getElementById('profEndInput').value = data.endDate;
  renderProfileView();
}

window.editHistoricalEntryFromProfile = async function (staffId, dateStr, hasEntry) {
  await loadState(dateStr);
  window.openEntryForStaff(staffId, hasEntry);
};

function renderProfileView() {
  if (!appState.profileData) return;
  const { person, startDate, endDate, tasks, allTime, period, dailyLogs } = appState.profileData;

  const switcher = document.getElementById('profileStaffSwitcher');
  switcher.innerHTML = appState.staff
    .map((s) => `<option value="${s.id}" ${s.id === person.id ? 'selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(s.shiftLabel)})</option>`)
    .join('');

  document.getElementById('profAvatar').textContent = getInitials(person.name);
  document.getElementById('profName').textContent = person.name;
  const roleTag = document.getElementById('profRoleTag');
  roleTag.textContent = person.role === 'admin' ? 'YETKİLİ' : 'PERSONEL';
  roleTag.classList.toggle('role-staff', person.role !== 'admin');

  document.getElementById('profEmailShift').textContent = `${person.email || '-'} • ${person.shiftLabel} (${person.shiftHours})`;
  const offNames =
    Array.isArray(person.weeklyOffDays) && person.weeklyOffDays.length > 0
      ? person.weeklyOffDays.map((d) => DAY_NAMES[d]).join(', ')
      : 'Sabit izin günü tanımlı değil';
  document.getElementById('profOffDaysText').textContent = `Haftalık Sabit İzin: ${offNames}`;

  // Üst KPI Kartları (Tüm Zamanlar)
  document.getElementById('profAllLive').textContent = `${allTime.totalLiveCount} Canlı Bakıldı`;
  document.getElementById('profAvgLive').textContent = `Rapor başına ortalama: ${allTime.avgLivePerReport} canlı destek`;
  document.getElementById('profBestDay').textContent =
    allTime.bestLiveDay.count > 0 ? `${allTime.bestLiveDay.count} Canlı` : 'Kayıt Yok';
  document.getElementById('profBestDate').textContent = allTime.bestLiveDay.date
    ? `Tarih: ${formatDmySlash(allTime.bestLiveDay.date)}`
    : 'Henüz canlı destek girilmedi';
  document.getElementById('profReportsCount').textContent = `${allTime.totalReports} Günlük Rapor`;
  document.getElementById('profExtraCount').textContent = `${allTime.totalExtraDone} Ekstra Görev Tamamlandı`;
  document.getElementById('profAttendanceVal').textContent = `${allTime.totalLateArrivals} Geç Katılım • ${allTime.totalLateExits} Ek Mesai`;

  // Seçili Dönem Görev Bazlı İstatistikler
  document.getElementById('profPeriodSpanSub').textContent = `${formatDmySlash(startDate)} — ${formatDmySlash(endDate)} (${period.reportedDays} rapor / ${period.workingDays} mesai • ${period.leaveDays} izin)`;

  const breakdownGrid = document.getElementById('profBreakdownGrid');
  breakdownGrid.innerHTML = period.taskBreakdown
    .map((tb) => {
      const denom = period.workingDays > 0 ? period.workingDays : 1;
      const pct = Math.min(100, Math.round((tb.doneDays / denom) * 100));
      if (tb.type === 'count_bakildi') {
        const avg = tb.doneDays > 0 ? Math.round(tb.totalCount / tb.doneDays) : 0;
        return `
          <div class="prof-task-stat">
            <span class="prof-task-stat-title">${escapeHtml(tb.title)}</span>
            <strong class="prof-task-stat-val gold-text">${tb.totalCount} ${escapeHtml(tb.unit || 'Adet')}</strong>
            <div style="font-size:11.5px; color:#94a3b8;">${tb.doneDays} gün bakıldı • Ort: ${avg}/gün</div>
            <div class="prof-bar-track"><div class="prof-bar-fill" style="width:${pct}%;"></div></div>
          </div>
        `;
      }

      return `
        <div class="prof-task-stat">
          <span class="prof-task-stat-title">${escapeHtml(tb.title)}</span>
          <strong class="prof-task-stat-val">${tb.doneDays} / ${period.workingDays} Gün (%${pct})</strong>
          <div style="font-size:11.5px; color:${tb.missedDays > 0 ? '#ef4444' : '#94a3b8'};">
            ${tb.missedDays > 0 ? `${tb.missedDays} gün yapılmadı` : 'Eksik bildirim yok'}
          </div>
          <div class="prof-bar-track"><div class="prof-bar-fill" style="width:${pct}%;"></div></div>
        </div>
      `;
    })
    .join('');

  // Gün Gün Veriler Tablosu
  const taskCols = tasks.map((t) => `<th>${escapeHtml(t.title)}</th>`).join('');
  document.getElementById('profDailyThead').innerHTML = `
    <tr>
      <th>TARİH & GÜN</th>
      <th>GİRİŞ / ÇIKIŞ</th>
      ${taskCols}
      <th>NOT</th>
      <th>İŞLEM</th>
    </tr>
  `;

  const onlyEntered = document.getElementById('profOnlyEnteredCheck').checked;
  const filteredLogs = onlyEntered ? dailyLogs.filter((r) => Boolean(r.entry)) : dailyLogs;

  const tbody = document.getElementById('profDailyTbody');
  if (filteredLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${tasks.length + 4}" style="text-align:center; padding:26px; color:#64748b;">Seçilen kriterde günlük veri kaydı bulunamadı.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredLogs
    .map((row) => {
      const timeStr = row.entry?.updatedAt
        ? new Date(row.entry.updatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        : '';
      const dateCell = `
        <td>
          <strong style="color:#f5b800;">${escapeHtml(formatDmySlash(row.date))}</strong>
          <div style="font-size:11.5px; color:#94a3b8;">${DAY_NAMES[row.isoDay] || ''}${timeStr ? ` • ${timeStr}` : ''}</div>
        </td>
      `;

      if (row.isOnLeave) {
        const leaveCols = tasks.map(() => `<td><span class="status-pill pill-gold">● İZİNLİ</span></td>`).join('');
        return `
          <tr class="is-leave-row">
            ${dateCell}
            <td><span class="status-pill pill-gold">● İZİNLİ</span></td>
            ${leaveCols}
            <td style="color:#94a3b8;">Haftalık / Günlük İzin</td>
            <td>-</td>
          </tr>
        `;
      }

      const vals = row.entry?.values || {};
      const hasEnt = Boolean(row.entry);
      const rowTaskCells = tasks
        .map((t) => `<td>${formatStatusPill(t, vals[t.id], person.id, row.date)}</td>`)
        .join('');
      const noteCell = row.entry?.note
        ? `<span style="color:#cbd5e1;">${escapeHtml(row.entry.note)}</span>`
        : `<span style="color:#475569;">-</span>`;

      return `
        <tr>
          ${dateCell}
          <td>${formatAttendanceCell(row.entry)}</td>
          ${rowTaskCells}
          <td>${noteCell}</td>
          <td>
            <button class="mini-btn" onclick="editHistoricalEntryFromProfile('${person.id}', '${row.date}', ${hasEnt})">
              ${hasEnt ? '✎ Düzenle' : 'Veri Gir'}
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

// Event Listeners
document.querySelectorAll('.nav-group-toggle').forEach((toggleBtn) => {
  toggleBtn.addEventListener('click', () => {
    const targetGroup = toggleBtn.closest('.nav-group');
    if (!targetGroup) return;
    if (targetGroup.classList.contains('open')) {
      targetGroup.classList.remove('open');
    } else {
      window.openAccordionGroup(targetGroup);
    }
  });
});

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => window.switchTab(btn.dataset.tab));
});

document.querySelectorAll('#daySubFilters .subchip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#daySubFilters .subchip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    appState.daySubFilter = chip.dataset.subshift;
    renderDailyTables();
  });
});

document.getElementById('globalSearchInput').addEventListener('input', (e) => {
  appState.searchQuery = e.target.value;
  renderDailyTables();
  renderWeeklyTables();
  renderRangeTables();
});

document.getElementById('applyRangeBtn').addEventListener('click', () => {
  const s = document.getElementById('rangeStartInput').value;
  const e = document.getElementById('rangeEndInput').value;
  if (!s || !e) return;
  document.querySelectorAll('.range-presets .subchip').forEach((c) => c.classList.remove('active'));
  loadRangeOnly(s, e);
  showToast('Tarih aralığı toplamları güncellendi.');
});

document.querySelectorAll('.range-presets .subchip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.range-presets .subchip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');

    const today = getLocalToday();
    const preset = chip.dataset.preset;
    let start = today;
    const end = today;

    if (preset === '7d') start = shiftDays(today, -6);
    else if (preset === '14d') start = shiftDays(today, -13);
    else if (preset === '30d') start = shiftDays(today, -29);
    else if (preset === 'month') {
      start = `${today.slice(0, 7)}-01`;
    }

    loadRangeOnly(start, end);
  });
});

datePicker.addEventListener('change', () => {
  if (datePicker.value) loadState(datePicker.value);
});

document.getElementById('prevDayBtn').addEventListener('click', () => loadState(shiftDays(appState.date, -1)));
document.getElementById('nextDayBtn').addEventListener('click', () => loadState(shiftDays(appState.date, 1)));
document.getElementById('todayBtn').addEventListener('click', () => loadState(getLocalToday()));

document.getElementById('prevWeekBtn').addEventListener('click', () => loadState(shiftDays(appState.date, -7)));
document.getElementById('nextWeekBtn').addEventListener('click', () => loadState(shiftDays(appState.date, 7)));
document.getElementById('currentWeekBtn').addEventListener('click', () => loadState(getLocalToday()));

document.getElementById('schedPrevWeekBtn').addEventListener('click', () => loadState(shiftDays(appState.date, -7)));
document.getElementById('schedNextWeekBtn').addEventListener('click', () => loadState(shiftDays(appState.date, 7)));
document.getElementById('schedCurrWeekBtn').addEventListener('click', () => loadState(getLocalToday()));

document.getElementById('exportScheduleBtn').addEventListener('click', () => {
  const targetDate = appState.date || getLocalToday();
  window.open(`/schedule-print?date=${encodeURIComponent(targetDate)}`, '_blank');
});

document.getElementById('entryStaffSelect').addEventListener('change', () => {
  appState.isEditingEntry = false;
  populateEntryFieldsForSelectedStaff();
});

document.getElementById('unlockEditBtn').addEventListener('click', () => {
  appState.isEditingEntry = true;
  populateEntryFieldsForSelectedStaff();
});

document.getElementById('cancelEditBtn').addEventListener('click', () => {
  appState.isEditingEntry = false;
  populateEntryFieldsForSelectedStaff();
});

document.getElementById('jumpTodayFromEntryBtn').addEventListener('click', () => {
  loadState(appState.today || getLocalToday());
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

document.getElementById('overrideWorkBtn').addEventListener('click', async () => {
  const staffId = document.getElementById('entryStaffSelect').value;
  if (staffId) await window.toggleDateLeave(staffId, 'work');
});

document.getElementById('markAllDoneBtn').addEventListener('click', () => {
  document.querySelectorAll('[data-task-status]').forEach((el) => (el.value = 'Bakıldı'));
  document.querySelectorAll('select[data-task-val]').forEach((el) => {
    const hasYapildi = Array.from(el.options).some((o) => o.value === 'Yapıldı');
    el.value = hasYapildi ? 'Yapıldı' : 'Bakıldı';
  });
});

document.getElementById('lateArrivalCheck').addEventListener('change', () => {
  const laCheck = document.getElementById('lateArrivalCheck');
  document.getElementById('lateArrivalDetailWrap').classList.toggle('hidden', !laCheck.checked);
  document.getElementById('lateArrivalBox').classList.toggle('active-coral', laCheck.checked);
});

document.getElementById('lateExitCheck').addEventListener('change', () => {
  const leCheck = document.getElementById('lateExitCheck');
  document.getElementById('lateExitDetailWrap').classList.toggle('hidden', !leCheck.checked);
  document.getElementById('lateExitBox').classList.toggle('active-gold', leCheck.checked);
});

document.getElementById('staffEntryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const staffId = document.getElementById('entryStaffSelect').value;
  const person = appState.staff.find((s) => s.id === staffId);
  const hasEntry = Boolean(person?.entry);

  if (hasEntry && !appState.isEditingEntry) {
    showToast('Önce "Raporu Düzenle" butonuna tıklayın.');
    return;
  }

  const note = document.getElementById('entryNote').value;
  const attendance = {
    lateArrival: document.getElementById('lateArrivalCheck').checked,
    lateArrivalNote: document.getElementById('lateArrivalNote').value,
    lateExit: document.getElementById('lateExitCheck').checked,
    lateExitNote: document.getElementById('lateExitNote').value
  };
  const values = {};

  for (const t of appState.tasks) {
    if (t.type === 'count_bakildi') {
      const cntEl = document.querySelector(`[data-task-count="${t.id}"]`);
      const stEl = document.querySelector(`[data-task-status="${t.id}"]`);
      values[t.id] = {
        count: Number(cntEl?.value || 0),
        status: stEl?.value || 'Bakıldı'
      };
    } else if (t.type === 'yapildi_not') {
      const stEl = document.querySelector(`[data-extra-status="${t.id}"]`);
      const noteEl = document.querySelector(`[data-extra-note="${t.id}"]`);
      const stVal = stEl?.value || 'Bekliyor';
      const noteVal = (noteEl?.value || '').trim();
      if (stVal === 'Yapıldı' && !noteVal) {
        alert(`"${t.title}" için Yapıldı seçtiğinizde yaptığınız işi not kısmına yazmalısınız.`);
        if (noteEl) noteEl.focus();
        return;
      }
      values[t.id] = {
        status: stVal,
        note: stVal === 'Yapıldı' ? noteVal : ''
      };
    } else {
      const valEl = document.querySelector(`[data-task-val="${t.id}"]`);
      values[t.id] = valEl ? valEl.value : '';
    }
  }

  try {
    const method = hasEntry ? 'PUT' : 'POST';
    await api('/api/entries', method, { date: appState.date, staffId, values, attendance, note });
    appState.isEditingEntry = false;
    await loadState(appState.date);
    showToast(hasEntry ? 'Günlük rapor güncellendi!' : 'Günlük rapor oluşturuldu!');
    window.switchTab('daily');
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('addStaffForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const name = document.getElementById('newStaffName').value;
    const email = document.getElementById('newStaffEmail').value;
    const password = document.getElementById('newStaffPassword').value;
    const role = document.getElementById('newStaffRole').value;
    const shift = document.getElementById('newStaffShift').value;
    const customHours = document.getElementById('newStaffCustomHours').value;

    await api('/api/staff', 'POST', { name, email, password, role, shift, customHours, weeklyOffDays: [] });
    document.getElementById('newStaffName').value = '';
    document.getElementById('newStaffEmail').value = '';
    document.getElementById('newStaffPassword').value = '';
    document.getElementById('newStaffCustomHours').value = '';
    await loadState(appState.date);
    showToast('Yeni personel hesabı oluşturuldu.');
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('newTaskType').addEventListener('change', (e) => {
  document.getElementById('unitFieldGroup').style.display =
    e.target.value === 'count_bakildi' ? 'flex' : 'none';
});
document.getElementById('unitFieldGroup').style.display = 'none';

document.getElementById('addTaskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('newTaskTitle').value;
  const type = document.getElementById('newTaskType').value;
  const unit = document.getElementById('newTaskUnit').value;
  await api('/api/tasks', 'POST', { title, type, unit });
  document.getElementById('newTaskTitle').value = '';
  await loadState(appState.date);
  showToast('Yeni iş kolu eklendi.');
});

document.getElementById('backFromProfileBtn').addEventListener('click', () => {
  window.switchTab(appState.previousTab || 'daily');
});

document.getElementById('profileStaffSwitcher').addEventListener('change', (e) => {
  if (e.target.value) {
    appState.profileStaffId = e.target.value;
    loadProfileData(e.target.value, appState.profileStart, appState.profileEnd);
  }
});

document.getElementById('profFilterBtn').addEventListener('click', () => {
  const s = document.getElementById('profStartInput').value;
  const e = document.getElementById('profEndInput').value;
  if (s && e && appState.profileStaffId) {
    loadProfileData(appState.profileStaffId, s, e);
    showToast('Profil tarih aralığı güncellendi.');
  }
});

document.getElementById('profOnlyEnteredCheck').addEventListener('change', () => {
  renderProfileView();
});

// ================= DİJİPİN STOK KONTROL MANTIĞI =================
async function loadCachedStockScan() {
  try {
    const res = await api('/api/stock-scan');
    if (res.data) {
      appState.stockScanData = res.data;
      renderStockScanView();
    }
  } catch (_) {}
}

window.toggleStockCategory = function (seoUrl) {
  if (appState.openStockCatSlug === seoUrl) {
    appState.openStockCatSlug = '';
  } else {
    appState.openStockCatSlug = seoUrl;
  }
  document.querySelectorAll('.stock-cat-card').forEach((card) => {
    card.classList.toggle('open', card.dataset.catSlug === appState.openStockCatSlug);
  });
};

function renderStockScanView() {
  const data = appState.stockScanData;
  if (!data) return;

  const { summary, categories, scannedAt, durationSec } = data;
  document.getElementById('stockKpiStrip').classList.remove('hidden');

  const timeStr = scannedAt
    ? new Date(scannedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';
  document.getElementById('stockLastScanLabel').textContent = `Son tarama: ${timeStr} (${durationSec} sn)`;
  document.getElementById('stkScannedCats').textContent = `${summary.scannedCategories} Kategori`;
  document.getElementById('stkScannedSubs').textContent = `${summary.scannedSubcategories} alt kategori tarandı`;
  document.getElementById('stkScannedProds').textContent = `${summary.scannedProducts} Ürün`;
  document.getElementById('stkAffectedCats').textContent = `${summary.affectedCategoriesCount} Kategori`;
  document.getElementById('stkTotalZero').textContent = `${summary.totalOutOfStockProducts} Ürün`;
  document.getElementById('stkDurationText').textContent = `Tarama süresi: ${durationSec} saniye`;

  const q = appState.stockSearchQuery.trim().toLowerCase();
  const grp = appState.stockGroupFilter;

  const filteredCats = categories
    .map((cat) => {
      // Grup ve arama filtresine göre alt kategorileri/ürünleri süz
      const matchingSubs = cat.subcategories
        .filter((sub) => grp === 'all' || sub.typeLabel === grp || cat.groups.includes(grp))
        .map((sub) => {
          if (!q) return sub;
          const catMatches = cat.name.toLowerCase().includes(q) || sub.name.toLowerCase().includes(q);
          if (catMatches) return sub;
          const matchingProds = sub.outOfStockProducts.filter((p) => p.name.toLowerCase().includes(q));
          return { ...sub, outOfStockProducts: matchingProds };
        })
        .filter((sub) => sub.outOfStockProducts.length > 0);

      if (matchingSubs.length === 0) return null;
      const filteredZeroCount = matchingSubs.reduce((acc, s) => acc + s.outOfStockProducts.length, 0);
      return {
        ...cat,
        filteredZeroCount,
        subcategories: matchingSubs
      };
    })
    .filter(Boolean);

  const container = document.getElementById('stockCategoriesContainer');
  if (filteredCats.length === 0) {
    container.innerHTML = `
      <div class="activity-card" style="padding: 32px 24px; text-align:center; color:#94a3b8;">
        Bu filtrede stoğu biten ürüne sahip kategori bulunamadı.
      </div>
    `;
    return;
  }

  container.innerHTML = filteredCats
    .map((cat) => {
      const isOpen = appState.openStockCatSlug === cat.seoUrl;
      const groupTags = cat.groups
        .map(
          (g) => `<span class="stock-type-tag ${g === 'Topup' ? 'tag-topup' : ''}">${escapeHtml(g)}</span>`
        )
        .join('');

      const thumbHtml = cat.imageUrl
        ? `<img src="${escapeHtml(cat.imageUrl)}" alt="${escapeHtml(cat.name)}" class="stock-cat-thumb" loading="lazy" />`
        : `<div class="stock-cat-thumb"></div>`;

      const subcatsHtml = cat.subcategories
        .map((sub) => {
          const prodsHtml = sub.outOfStockProducts
            .map((p) => {
              const pImg = p.imageUrl
                ? `<img src="${escapeHtml(p.imageUrl)}" alt="" class="stock-prod-img" loading="lazy" />`
                : `<div class="stock-prod-img"></div>`;
              return `
                <div class="stock-prod-item">
                  <div class="stock-prod-left">
                    ${pImg}
                    <div>
                      <div class="stock-prod-name">${escapeHtml(p.name)}</div>
                      <div class="stock-prod-price">${p.price} ${escapeHtml(p.currency)} • ${escapeHtml(p.typeLabel)}</div>
                    </div>
                  </div>
                  <span class="status-pill pill-coral" style="flex-shrink:0;">✕ Stok Yok</span>
                </div>
              `;
            })
            .join('');

          return `
            <div class="stock-subcat-block">
              <div class="stock-subcat-header">
                <div class="stock-subcat-name">
                  <span>▸ Alt Kategori: ${escapeHtml(sub.name)}</span>
                  <span class="stock-type-tag ${sub.typeLabel === 'Topup' ? 'tag-topup' : ''}">${escapeHtml(sub.typeLabel)}</span>
                  <span style="font-size:11.5px; color:#94a3b8; font-weight:600;">(${sub.outOfStockProducts.length} / ${sub.totalInSubcat} ürün tükendi)</span>
                </div>
                <a href="${escapeHtml(sub.url)}" target="_blank" rel="noopener" class="mini-btn" style="text-decoration:none;">Dijipin'de Aç ↗</a>
              </div>
              <div class="stock-products-grid">
                ${prodsHtml}
              </div>
            </div>
          `;
        })
        .join('');

      return `
        <div class="stock-cat-card ${isOpen ? 'open' : ''}" data-cat-slug="${escapeHtml(cat.seoUrl)}">
          <button type="button" class="stock-cat-head" onclick="toggleStockCategory('${escapeHtml(cat.seoUrl)}')">
            <div class="stock-cat-left">
              ${thumbHtml}
              <div>
                <div class="stock-cat-title">
                  <span>${escapeHtml(cat.name)}</span>
                  ${groupTags}
                </div>
                <div class="stock-cat-submeta">${cat.subcategories.length} alt kategoride stok eksiği • Toplam ${cat.totalProducts} ürün incelendi</div>
              </div>
            </div>
            <div class="stock-cat-right">
              <span class="status-pill pill-coral">✕ ${cat.filteredZeroCount} Ürün Stok Yok</span>
              <span class="stock-cat-chevron">&rsaquo;</span>
            </div>
          </button>
          <div class="stock-cat-body">
            <div class="stock-cat-inner">
              ${subcatsHtml}
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

document.getElementById('fetchOutOfStockBtn').addEventListener('click', async () => {
  const btn = document.getElementById('fetchOutOfStockBtn');
  const lbl = document.getElementById('stockLastScanLabel');
  btn.disabled = true;
  btn.textContent = '⏳ Dijipin Taranıyor (~12 sn)...';
  lbl.textContent = 'Topup & E-Pin tüm alt kategoriler çekiliyor...';

  try {
    const res = await api('/api/stock-scan?force=1');
    appState.stockScanData = res.data;
    appState.openStockCatSlug = '';
    renderStockScanView();
    showToast(`${res.data.summary.affectedCategoriesCount} kategoride ${res.data.summary.totalOutOfStockProducts} stoksuz ürün bulundu!`);
  } catch (err) {
    alert(err.message);
    lbl.textContent = 'Tarama hatası oluştu';
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Stoğu Biten Ürünleri Çek';
  }
});

document.querySelectorAll('#stockGroupFilters .subchip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#stockGroupFilters .subchip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    appState.stockGroupFilter = chip.dataset.stockgroup;
    renderStockScanView();
  });
});

document.getElementById('stockSearchInput').addEventListener('input', (e) => {
  appState.stockSearchQuery = e.target.value;
  renderStockScanView();
});

// ================= KİŞİSEL ŞİFRE DEĞİŞTİRME =================
window.closeChangePasswordModal = function () {
  document.getElementById('changePasswordOverlay').classList.add('hidden');
  document.getElementById('cpCurrentInput').value = '';
  document.getElementById('cpNewInput').value = '';
  document.getElementById('cpConfirmInput').value = '';
};

document.getElementById('openChangePassBtn').addEventListener('click', () => {
  document.getElementById('changePasswordOverlay').classList.remove('hidden');
  document.getElementById('cpCurrentInput').focus();
});

document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById('cpCurrentInput').value;
  const newPassword = document.getElementById('cpNewInput').value.trim();
  const confirmPassword = document.getElementById('cpConfirmInput').value.trim();

  if (newPassword.length < 4) {
    alert('Yeni şifre en az 4 karakter olmalıdır.');
    return;
  }
  if (newPassword !== confirmPassword) {
    alert('Yeni şifre ve şifre tekrarı eşleşmiyor.');
    return;
  }

  const btn = document.getElementById('cpSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Güncelleniyor...';
  try {
    await api('/api/auth/change-password', 'POST', { currentPassword, newPassword });
    window.closeChangePasswordModal();
    showToast('Şifreniz başarıyla güncellendi!');
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Şifreyi Güncelle';
  }
});

document.getElementById('firebaseConfigForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('fbSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Bağlanıyor...';
  try {
    const databaseURL = document.getElementById('fbDbUrlInput').value;
    const authSecret = document.getElementById('fbSecretInput').value;
    const res = await api('/api/firebase/config', 'POST', { databaseURL, authSecret });
    appState.syncStatus = res.status;
    await loadState(appState.date);
    showToast('Firebase bağlantısı kuruldu ve veriler senkronlandı!');
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '☁ Bağlan & Verileri Senkronla';
  }
});

document.getElementById('forceResyncBtn').addEventListener('click', async () => {
  try {
    const res = await api('/api/firebase/resync', 'POST');
    appState.syncStatus = res.status;
    await loadState(appState.date);
    showToast('Bulut verisi yeniden eşitlendi.');
  } catch (err) {
    alert(err.message);
  }
});

['pubVersionInput', 'pubUrlInput', 'pubNotesInput'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', () => {
      el.dataset.dirty = '1';
    });
  }
});

document.getElementById('publishUpdateForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('pubSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Yayınlanıyor...';
  try {
    const latestVersion = document.getElementById('pubVersionInput').value.trim();
    const downloadUrl = document.getElementById('pubUrlInput').value.trim();
    const releaseNotes = document.getElementById('pubNotesInput').value.trim();
    const res = await api('/api/app-update/publish', 'POST', {
      latestVersion,
      downloadUrl,
      releaseNotes
    });
    ['pubVersionInput', 'pubUrlInput', 'pubNotesInput'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) delete el.dataset.dirty;
    });
    appState.appUpdate = res.appUpdate;
    renderAppUpdateUi();
    showToast(
      downloadUrl
        ? `v${res.appUpdate.latestVersion} güncellemesi tüm bilgisayarlara gönderildi!`
        : 'Güncelleme duyurusu kapatıldı.'
    );
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Güncellemeyi Tüm Bilgisayarlara Gönder';
  }
});

document.getElementById('topAppUpdateBtn')?.addEventListener('click', async () => {
  const u = appState.appUpdate;
  if (!u || !u.downloadUrl || appState.isUpdatingExe) return;

  const noteLine = u.releaseNotes ? `\n\nGüncelleme Notu: ${u.releaseNotes}` : '';
  const ok = confirm(
    `Yeni sürüm (v${u.latestVersion}) indirilecek ve uygulama otomatik olarak kendini yenileyip tekrar açılacaktır.${noteLine}\n\nŞimdi güncellensin mi?`
  );
  if (!ok) return;

  if (!u.isDesktopExe) {
    window.open(u.downloadUrl, '_blank', 'noopener');
    return;
  }

  const topBtn = document.getElementById('topAppUpdateBtn');
  appState.isUpdatingExe = true;
  topBtn.disabled = true;
  topBtn.textContent = '⏳ İndirme Başlatılıyor...';

  try {
    await api('/api/app-update/apply', 'POST');
    const pollTimer = setInterval(async () => {
      try {
        const p = await api('/api/app-update/progress');
        if (p.state === 'downloading') {
          const pctTxt = p.totalBytes > 0 ? `%${p.percent} (${p.downloadedMB}/${p.totalMB} MB)` : `${p.downloadedMB} MB`;
          topBtn.textContent = `⏳ İndiriliyor ${pctTxt}`;
        } else if (p.state === 'restarting') {
          clearInterval(pollTimer);
          topBtn.textContent = '🔄 Yeniden Başlatılıyor...';
          showToast('Güncelleme tamamlandı, uygulama yeniden başlatılıyor...');
        } else if (p.state === 'error') {
          clearInterval(pollTimer);
          appState.isUpdatingExe = false;
          topBtn.disabled = false;
          renderAppUpdateUi();
          alert(`Güncelleme hatası: ${p.error || 'İndirme başarısız oldu.'}`);
        }
      } catch (_) {
        // Uygulama kapanırken bağlantı kesilmesi normaldir
        clearInterval(pollTimer);
        topBtn.textContent = '🔄 Yeniden Başlatılıyor...';
      }
    }, 400);
  } catch (err) {
    appState.isUpdatingExe = false;
    topBtn.disabled = false;
    renderAppUpdateUi();
    alert(err.message);
  }
});

// Diğer bilgisayarlardan gelen Firebase değişikliklerini anlık ekrana yansıt (SSE)
function startLiveSyncListener() {
  try {
    const ev = new EventSource('/api/events');
    ev.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.syncStatus) {
          appState.syncStatus = data.syncStatus;
          renderSyncStatusUi();
        }
        if (data.appUpdate) {
          appState.appUpdate = data.appUpdate;
          renderAppUpdateUi();
        }
        if (data.type === 'sync') {
          const activeTag = document.activeElement?.tagName;
          const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
          if (!appState.isEditingEntry && !isTyping) {
            loadState(appState.date);
          }
        }
      } catch (_) {}
    };
  } catch (_) {}
}

// Başlangıç
loadState(getLocalToday()).then(() => startLiveSyncListener());
