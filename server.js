const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FirebaseSyncStore } = require('./firebase-sync');
const { scanDijipinOutOfStock, getCachedStockScan } = require('./stock-scanner');
const {
  compareVersions,
  downloadAndApplyExeUpdate,
  getUpdateProgress,
  getTargetExePath
} = require('./updater');
const APP_VERSION = require('./package.json').version || '1.0.0';

const app = express();
const PORT = process.env.PORT || 3131;
const STORAGE_DIR = process.env.OP_USER_DATA_DIR || __dirname;

app.use(express.json());

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, origHash] = stored.split(':');
  const candidate = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(origHash, 'hex'), Buffer.from(candidate, 'hex'));
}

function slugifyTr(str) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u' };
  return String(str || '')
    .toLowerCase()
    .replace(/[çğıiöşü]/g, (ch) => map[ch] || ch)
    .replace(/[^a-z0-9]/g, '') || 'personel';
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      out[k] = v;
    }
  });
  return out;
}

function sanitizeStaff(s) {
  const { passwordHash, ...safe } = s;
  return safe;
}

function getLocalTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ISO Day of Week: 1 = Pazartesi ... 7 = Pazar
function getIsoDayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  return day === 0 ? 7 : day;
}

function formatDateLocal(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekDates(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const current = new Date(y, m - 1, d);
  const iso = getIsoDayOfWeek(dateStr);
  const monday = new Date(current);
  monday.setDate(current.getDate() - (iso - 1));

  const days = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + i);
    days.push({
      isoDay: i + 1,
      date: formatDateLocal(dt)
    });
  }
  return days;
}

function getDatesBetween(startStr, endStr) {
  let [sy, sm, sd] = startStr.split('-').map(Number);
  let [ey, em, ed] = endStr.split('-').map(Number);
  let startDt = new Date(sy, sm - 1, sd);
  let endDt = new Date(ey, em - 1, ed);

  if (startDt > endDt) {
    const tmp = startDt;
    startDt = endDt;
    endDt = tmp;
  }

  const dates = [];
  const cursor = new Date(startDt);
  let guard = 0;
  while (cursor <= endDt && guard < 366) {
    dates.push(formatDateLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard++;
  }
  return dates;
}

const DEFAULT_SHIFTS = {
  morning: { id: 'morning', label: 'Sabah', hours: '09:00 - 18:00' },
  morning_12: { id: 'morning_12', label: 'Sabah (12 Saat)', hours: '09:00 - 21:00' },
  afternoon: { id: 'afternoon', label: 'Öğle', hours: '12:00 - 21:00' },
  night: { id: 'night', label: 'Gece', hours: '21:00 - 09:00' }
};

function createInitialData() {
  const today = getLocalTodayStr();
  const todayIso = getIsoDayOfWeek(today);

  return {
    shifts: DEFAULT_SHIFTS,
    tasks: [
      { id: 'canli_destek', title: 'Canlı Destek', type: 'count_bakildi', unit: 'Canlı Bakıldı' },
      { id: 'whatsapp', title: 'WhatsApp', type: 'bakildi' },
      { id: 'instagram', title: 'Instagram', type: 'bakildi' },
      { id: 'destek_talebi', title: 'Destek Talebi', type: 'bakildi' },
      { id: 'musteri_geri_kazanim', title: 'Müşteri Geri Kazanım', type: 'yapildi' },
      { id: 'rakip_fiyat', title: 'Rakip Fiyat Kontrol', type: 'yapildi' },
      { id: 'rakip_etkinlik', title: 'Rakip Etkinlik Kontrol', type: 'yapildi' },
      { id: 'ekstra_gorev', title: 'Ekstra Görev', type: 'yapildi_not' }
    ],
    staff: [
      {
        id: 'st_1',
        name: 'Sertan',
        shift: 'morning',
        customHours: '',
        weeklyOffDays: [7] // Pazar izinli
      },
      {
        id: 'st_2',
        name: 'Asil',
        shift: 'morning_12',
        customHours: '',
        weeklyOffDays: [6] // Cumartesi izinli
      },
      {
        id: 'st_3',
        name: 'Burak',
        shift: 'afternoon',
        customHours: '',
        weeklyOffDays: [todayIso] // Bugün izinli örneği
      },
      {
        id: 'st_4',
        name: 'Emre',
        shift: 'night',
        customHours: '',
        weeklyOffDays: [1] // Pazartesi izinli
      }
    ],
    // entries[dateStr][staffId] = { values: { taskId: val }, note: '' }
    entries: {
      [today]: {
        st_1: {
          values: {
            canli_destek: { count: 150, status: 'Bakıldı' },
            whatsapp: 'Bakıldı',
            instagram: 'Bakıldı',
            destek_talebi: 'Bakıldı',
            musteri_geri_kazanim: 'Yapıldı',
            rakip_fiyat: 'Yapıldı',
            rakip_etkinlik: 'Yapıldı'
          },
          note: 'Vardiya sorunsuz tamamlandı.',
          updatedAt: new Date().toISOString()
        },
        st_2: {
          values: {
            canli_destek: { count: 250, status: 'Bakıldı' },
            whatsapp: 'Bakıldı',
            instagram: 'Bakıldı',
            destek_talebi: 'Bakıldı',
            musteri_geri_kazanim: 'Yapıldı',
            rakip_fiyat: 'Yapıldı',
            rakip_etkinlik: 'Yapıldı'
          },
          note: '12 saatlik sabah vardiyası yoğun geçti.',
          updatedAt: new Date().toISOString()
        }
      }
    },
    // leaveOverrides[dateStr][staffId] = 'leave' | 'work'
    leaveOverrides: {}
  };
}

function ensureAuthSchema(db) {
  let changed = false;

  if (!Array.isArray(db.admins)) {
    db.admins = [];
    changed = true;
  }

  // Yetkili hesap kurulumu (tek seferlik versiyonlu geçiş — sonradan yapılan şifre değişikliklerini ezmez)
  if (!db.adminSeedVersion || db.adminSeedVersion < 2) {
    // Eski test hesabını temizle
    db.admins = db.admins.filter((a) => a.email && a.email.toLowerCase() !== 'admin@operasyon.com');

    const upsertSystemAdmin = (id, name, email, plainPass) => {
      const existingStaff = Array.isArray(db.staff)
        ? db.staff.find((s) => s.email && s.email.toLowerCase() === email.toLowerCase())
        : null;
      if (existingStaff) {
        existingStaff.role = 'admin';
        existingStaff.passwordHash = hashPassword(plainPass);
        return;
      }
      const existingAdm = db.admins.find((a) => a.email.toLowerCase() === email.toLowerCase());
      if (existingAdm) {
        existingAdm.name = name;
        existingAdm.role = 'admin';
        existingAdm.passwordHash = hashPassword(plainPass);
      } else {
        db.admins.push({
          id,
          name,
          email: email.toLowerCase(),
          passwordHash: hashPassword(plainPass),
          role: 'admin'
        });
      }
    };

    upsertSystemAdmin('adm_dev', 'Developer', 'developer@dijipin.com', '122345567889D1j!');
    upsertSystemAdmin('adm_dodo', 'Doğukan', 'dogukan@dijipin.com', 'dodo123');
    upsertSystemAdmin('adm_ozgur', 'Özgür', 'ozgur@dijipin.com', 'asd123asd');

    db.adminSeedVersion = 2;
    changed = true;
  }

  if (!db.sessions || typeof db.sessions !== 'object') {
    db.sessions = {};
    changed = true;
  }

  if (Array.isArray(db.tasks) && !db.tasks.some((t) => t.id === 'ekstra_gorev')) {
    db.tasks.push({ id: 'ekstra_gorev', title: 'Ekstra Görev', type: 'yapildi_not' });
    changed = true;
  }

  const usedEmails = new Set(db.admins.map((a) => a.email.toLowerCase()));
  db.staff.forEach((s, idx) => {
    if (!s.email) {
      let base = `${slugifyTr(s.name)}@operasyon.com`;
      if (usedEmails.has(base)) base = `${slugifyTr(s.name)}${idx + 1}@operasyon.com`;
      s.email = base;
      changed = true;
    }
    usedEmails.add(s.email.toLowerCase());

    if (!s.passwordHash) {
      s.passwordHash = hashPassword('123456');
      changed = true;
    }
    if (!s.role) {
      s.role = 'staff';
      changed = true;
    }
  });

  return changed;
}

const store = new FirebaseSyncStore({
  bundledDir: __dirname,
  storageDir: STORAGE_DIR,
  createInitialData,
  ensureSchema: ensureAuthSchema
});

function loadDb() {
  return store.getDb();
}

function saveDb(db, subPath = '', subVal = undefined) {
  store.saveDb(db, subPath, subVal);
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.op_sid;
  if (!token) return null;
  const db = loadDb();
  const sess = db.sessions?.[token];
  if (!sess) return null;

  const adminUser = db.admins.find((a) => a.id === sess.userId);
  if (adminUser) {
    return { id: adminUser.id, name: adminUser.name, email: adminUser.email, role: 'admin', isSystemAdmin: true };
  }

  const staffUser = db.staff.find((s) => s.id === sess.userId);
  if (staffUser) {
    return {
      id: staffUser.id,
      name: staffUser.name,
      email: staffUser.email,
      role: staffUser.role === 'admin' ? 'admin' : 'staff',
      shift: staffUser.shift
    };
  }
  return null;
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Bu işlem için yetkili (yönetici) izni gereklidir.' });
  }
  next();
}

function escapeServerHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Sayfa yönlendirmeleri: giriş yapmamış kullanıcı direkt /login sayfasına yönlendirilir
app.get(['/login', '/login.html'], (req, res) => {
  if (getSessionUser(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get(['/', '/index.html'], (req, res) => {
  if (!getSessionUser(req)) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Haftalık Vardiya & İzin Çizelgesi — Çıktı / WhatsApp Paylaşım Sayfası (Yeni Sekme HTML)
app.get('/schedule-print', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.redirect('/login');

  const db = loadDb();
  const refDate = req.query.date || getLocalTodayStr();
  const weekDays = getWeekDates(refDate);
  const dayNamesTr = {
    1: 'PAZARTESİ',
    2: 'SALI',
    3: 'ÇARŞAMBA',
    4: 'PERŞEMBE',
    5: 'CUMA',
    6: 'CUMARTESİ',
    7: 'PAZAR'
  };

  const toDmy = (dStr) => {
    const [y, m, d] = String(dStr).split('-');
    return `${d}/${m}/${y}`;
  };

  const rangeTitle = `${toDmy(weekDays[0].date)} — ${toDmy(weekDays[6].date)}`;

  const shiftOrder = { morning: 1, morning_12: 2, afternoon: 3, night: 4 };
  const shiftDisplayLabel = (s) => {
    if (s.shift === 'afternoon') return 'Ara';
    const def = db.shifts[s.shift] || DEFAULT_SHIFTS.morning;
    return def.label;
  };
  const shiftDisplayHours = (s) => {
    if (s.customHours && s.customHours.trim()) return s.customHours.trim();
    const def = db.shifts[s.shift] || DEFAULT_SHIFTS.morning;
    return def.hours;
  };

  const dayAndMidStaff = db.staff
    .filter((s) => s.shift !== 'night')
    .sort((a, b) => (shiftOrder[a.shift] || 9) - (shiftOrder[b.shift] || 9));

  const nightStaff = db.staff.filter((s) => s.shift === 'night');

  const dayHeadCols = weekDays
    .map(
      (wd) => `
      <th class="day-col">
        <div class="th-date">${escapeServerHtml(toDmy(wd.date))}</div>
        <div class="th-day">${dayNamesTr[wd.isoDay]}</div>
      </th>`
    )
    .join('');

  const buildPrintRows = (list, emptyText) => {
    if (list.length === 0) {
      return `<tr><td colspan="9" class="empty-row">${escapeServerHtml(emptyText)}</td></tr>`;
    }
    return list
      .map((s) => {
        const is12h = s.shift === 'morning_12';
        const cells = weekDays
          .map((wd) => {
            const off = isStaffOnLeave(db, s, wd.date);
            return `<td class="day-col">${
              off
                ? '<span class="pill pill-leave">● İZİNLİ</span>'
                : '<span class="pill pill-work">✓ Çalışıyor</span>'
            }</td>`;
          })
          .join('');

        return `
          <tr>
            <td class="person-col"><strong>${escapeServerHtml(s.name)}</strong></td>
            <td class="shift-col">
              <span class="shift-text ${is12h ? 'shift-12h' : ''}">${escapeServerHtml(shiftDisplayLabel(s))}</span>
              <span class="hours-text">${escapeServerHtml(shiftDisplayHours(s))}</span>
            </td>
            ${cells}
          </tr>
        `;
      })
      .join('');
  };

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Haftalık Vardiya & İzin Çizelgesi (${escapeServerHtml(rangeTitle)})</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0b0d13;
      color: #f8fafc;
      padding: 26px 30px 44px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      max-width: 1380px;
      margin: 0 auto;
    }
    .top-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      background: #12151e;
      border: 1px solid #1f2536;
      border-radius: 16px;
      padding: 18px 24px;
      margin-bottom: 20px;
    }
    .brand-side {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .brand-logo {
      height: 38px;
      width: auto;
      display: block;
    }
    .title-block h1 {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.2px;
    }
    .title-block p {
      font-size: 13px;
      font-weight: 700;
      color: #f5b800;
      margin-top: 2px;
    }
    .print-actions {
      display: flex;
      gap: 10px;
    }
    .btn-print {
      background: #f5b800;
      color: #0b0d13;
      border: none;
      font-family: inherit;
      font-size: 13px;
      font-weight: 800;
      padding: 10px 18px;
      border-radius: 10px;
      cursor: pointer;
    }
    .section-card {
      background: #12151e;
      border: 1px solid #1f2536;
      border-radius: 16px;
      overflow: hidden;
      margin-bottom: 20px;
    }
    .section-bar {
      padding: 14px 20px;
      background: #151925;
      border-bottom: 1px solid #1f2536;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .section-bar h2 {
      font-size: 15px;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-bar span {
      font-size: 12px;
      color: #ea1d5d;
      font-weight: 700;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 12px 12px;
      border-bottom: 1px solid #1c2130;
      font-size: 12.5px;
      white-space: nowrap;
    }
    th {
      background: #0f121a;
      color: #94a3b8;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-align: left;
    }
    tbody tr:last-child td { border-bottom: none; }
    .day-col { text-align: center !important; }
    .th-date {
      color: #f5b800;
      font-size: 11.5px;
      font-weight: 800;
      margin-bottom: 2px;
    }
    .th-day {
      color: #cbd5e1;
      font-size: 10.5px;
    }
    .person-col {
      font-size: 13.5px;
      color: #ffffff;
      min-width: 135px;
    }
    .shift-col {
      min-width: 210px;
    }
    .shift-text {
      font-weight: 700;
      color: #e2e8f0;
      margin-right: 6px;
    }
    .shift-12h {
      color: #f5b800;
    }
    .hours-text {
      display: inline-block;
      background: #181d2b;
      border: 1px solid #283046;
      color: #ea1d5d;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 800;
    }
    .pill {
      display: inline-block;
      padding: 4px 11px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 700;
    }
    .pill-work {
      background: rgba(16, 185, 129, 0.13);
      border: 1px solid rgba(16, 185, 129, 0.30);
      color: #10b981;
    }
    .pill-leave {
      background: rgba(245, 184, 0, 0.14);
      border: 1px solid rgba(245, 184, 0, 0.35);
      color: #f5b800;
    }
    .empty-row {
      text-align: center;
      color: #64748b;
      padding: 20px;
    }
    @media print {
      .no-print { display: none !important; }
      body { padding: 8px; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="top-head">
      <div class="brand-side">
        <img src="/dijipin-operasyon-logo.png" alt="Dijipin Operasyon Takip" class="brand-logo" />
        <div class="title-block">
          <h1>Haftalık Vardiya & İzin Çizelgesi</h1>
          <p>📅 ${escapeServerHtml(rangeTitle)}</p>
        </div>
      </div>
    </div>

    <!-- ÜST TABLO: SABAH & ARA VARDİYA -->
    <div class="section-card">
      <div class="section-bar">
        <h2>☀ Sabah & Ara Vardiya</h2>
        <span>09:00 - 18:00 • 09:00 - 21:00 (12 Saat) • 12:00 - 21:00</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>PERSONEL</th>
            <th>VARDİYA & MESAİ SAATİ</th>
            ${dayHeadCols}
          </tr>
        </thead>
        <tbody>
          ${buildPrintRows(dayAndMidStaff, 'Sabah / Ara vardiyasında personel bulunmuyor.')}
        </tbody>
      </table>
    </div>

    <!-- ALT TABLO: GECE VARDİYASI -->
    <div class="section-card">
      <div class="section-bar">
        <h2>🌙 Gece Vardiyası</h2>
        <span>21:00 - 09:00</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>PERSONEL</th>
            <th>VARDİYA & MESAİ SAATİ</th>
            ${dayHeadCols}
          </tr>
        </thead>
        <tbody>
          ${buildPrintRows(nightStaff, 'Gece vardiyasında personel bulunmuyor.')}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`);
});

// Yetkili (veya ilgili personel) için Ekstra Görev Detay Notu Iframe Sayfası
app.get('/note-view', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).send('Oturum açmanız gerekiyor.');

  const { date, start, end, staffId, taskId } = req.query;
  if (user.role !== 'admin' && user.id !== staffId) {
    return res.status(403).send('Bu notu görüntüleme yetkiniz yok.');
  }

  const db = loadDb();
  const person = db.staff.find((s) => s.id === staffId);
  const task = db.tasks.find((t) => t.id === taskId) || { title: 'Ekstra Görev' };
  const shiftDef = person ? db.shifts[person.shift] || DEFAULT_SHIFTS.morning : DEFAULT_SHIFTS.morning;
  const shiftHours = person?.customHours?.trim() ? person.customHours.trim() : shiftDef.hours;

  const items = [];
  const targetDates = start && end ? getDatesBetween(start, end) : date ? [date] : [];

  targetDates.forEach((dStr) => {
    const entry = db.entries?.[dStr]?.[staffId];
    const val = entry?.values?.[taskId];
    if (val && typeof val === 'object' && val.status === 'Yapıldı') {
      items.push({
        date: dStr,
        note: val.note || '(Not girilmemiş)',
        updatedAt: entry.updatedAt
      });
    }
  });

  const notesHtml =
    items.length === 0
      ? `<div class="empty">Bu kayıt için görüntülenecek ekstra görev notu bulunamadı.</div>`
      : items
          .map((it) => {
            const timeStr = it.updatedAt
              ? new Date(it.updatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
              : '';
            return `
              <div class="note-card">
                <div class="note-meta">
                  <span class="date-tag">📅 ${escapeServerHtml(it.date)}</span>
                  ${timeStr ? `<span class="time-tag">Saat: ${escapeServerHtml(timeStr)}</span>` : ''}
                </div>
                <div class="note-content">${escapeServerHtml(it.note)}</div>
              </div>
            `;
          })
          .join('');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #12151e;
      color: #f8fafc;
      padding: 20px 22px;
      line-height: 1.55;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 14px;
      border-bottom: 1px solid #1e2332;
      margin-bottom: 16px;
    }
    .eyebrow {
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.8px;
      color: #f5b800;
      text-transform: uppercase;
    }
    h1 {
      font-size: 17px;
      font-weight: 800;
      margin-top: 2px;
    }
    .sub {
      font-size: 12px;
      color: #94a3b8;
      margin-top: 2px;
    }
    .pill {
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.32);
      color: #10b981;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .note-card {
      background: #0d1017;
      border: 1px solid #252b3d;
      border-radius: 12px;
      padding: 15px 16px;
      margin-bottom: 12px;
    }
    .note-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.5px;
      color: #94a3b8;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px dashed #1e2332;
    }
    .date-tag {
      color: #f5b800;
      font-weight: 700;
    }
    .note-content {
      font-size: 13.5px;
      color: #f1f5f9;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .empty {
      color: #94a3b8;
      font-size: 13px;
      padding: 18px 0;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="head">
    <div>
      <div class="eyebrow">${escapeServerHtml(task.title)} DETAYI</div>
      <h1>${escapeServerHtml(person ? person.name : 'Personel')}</h1>
      <div class="sub">${escapeServerHtml(shiftDef.label)} • ${escapeServerHtml(shiftHours)}</div>
    </div>
    <span class="pill">✓ Yapıldı (${items.length})</span>
  </div>
  ${notesHtml}
</body>
</html>`);
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Kimlik Doğrulama API
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'E-posta ve şifre zorunludur.' });
  }
  const normalized = String(email).trim().toLowerCase();
  const db = loadDb();

  let matched = db.admins.find((a) => a.email.toLowerCase() === normalized);
  if (!matched) {
    matched = db.staff.find((s) => s.email && s.email.toLowerCase() === normalized);
  }

  if (!matched || !verifyPassword(password, matched.passwordHash)) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = {
    userId: matched.id,
    createdAt: new Date().toISOString()
  };
  saveDb(db, `sessions/${token}`, db.sessions[token]);

  res.setHeader('Set-Cookie', `op_sid=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`);
  res.json({
    ok: true,
    user: {
      id: matched.id,
      name: matched.name,
      email: matched.email,
      role: matched.role === 'admin' ? 'admin' : 'staff'
    }
  });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.op_sid) {
    const db = loadDb();
    delete db.sessions[cookies.op_sid];
    saveDb(db, `sessions/${cookies.op_sid}`, null);
  }
  res.setHeader('Set-Cookie', 'op_sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Giriş yapmış kullanıcının (Yetkili veya Personel) kendi şifresini değiştirmesi
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Mevcut şifre ve yeni şifre alanları zorunludur.' });
  }
  if (String(newPassword).trim().length < 4) {
    return res.status(400).json({ error: 'Yeni şifre en az 4 karakter olmalıdır.' });
  }

  const db = loadDb();
  const admIdx = db.admins.findIndex((a) => a.id === req.user.id);
  if (admIdx > -1) {
    if (!verifyPassword(currentPassword, db.admins[admIdx].passwordHash)) {
      return res.status(401).json({ error: 'Mevcut şifreniz hatalı.' });
    }
    db.admins[admIdx].passwordHash = hashPassword(String(newPassword).trim());
    saveDb(db, 'admins', db.admins);
    return res.json({ ok: true });
  }

  const stIdx = db.staff.findIndex((s) => s.id === req.user.id);
  if (stIdx > -1) {
    if (!verifyPassword(currentPassword, db.staff[stIdx].passwordHash)) {
      return res.status(401).json({ error: 'Mevcut şifreniz hatalı.' });
    }
    db.staff[stIdx].passwordHash = hashPassword(String(newPassword).trim());
    saveDb(db, 'staff', db.staff);
    return res.json({ ok: true });
  }

  return res.status(404).json({ error: 'Kullanıcı kaydı bulunamadı.' });
});

// Bundan sonraki tüm /api uç noktaları oturum gerektirir
app.use('/api', requireAuth);

function buildAppUpdateInfo(db) {
  const rel = db?.appRelease || {};
  const latestVersion = rel.latestVersion || APP_VERSION;
  const downloadUrl = rel.downloadUrl || '';
  const hasUpdate = Boolean(downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0);
  return {
    currentVersion: APP_VERSION,
    latestVersion,
    downloadUrl,
    releaseNotes: rel.releaseNotes || '',
    publishedAt: rel.publishedAt || '',
    hasUpdate,
    isDesktopExe: Boolean(getTargetExePath())
  };
}

// Canlı senkronizasyon bildirim akışı (SSE)
const sseClients = new Set();
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(
    `data: ${JSON.stringify({
      type: 'connected',
      syncStatus: store.getStatus(),
      appUpdate: buildAppUpdateInfo(loadDb())
    })}\n\n`
  );
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcastSyncEvent() {
  const msg = `data: ${JSON.stringify({
    type: 'sync',
    syncStatus: store.getStatus(),
    appUpdate: buildAppUpdateInfo(loadDb())
  })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch (_) {}
  }
}

store.on('remote_change', broadcastSyncEvent);
store.on('synced', broadcastSyncEvent);

// Yetkili: Firebase Bulut Senkron Durumu & Ayarları
app.get('/api/firebase/status', requireAdmin, (req, res) => {
  res.json({ status: store.getStatus() });
});

app.post('/api/firebase/config', requireAdmin, async (req, res) => {
  try {
    const { databaseURL, authSecret } = req.body;
    const status = await store.configureAndConnect({ databaseURL, authSecret });
    broadcastSyncEvent();
    res.json({ ok: true, status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/firebase/resync', requireAdmin, async (req, res) => {
  await store.syncFromCloudOrSeed();
  res.json({ ok: true, status: store.getStatus() });
});

// Uzaktan .exe Güncelleme Yayınlama (Yetkili) & Uygulama (Tüm Kullanıcılar)
app.post('/api/app-update/publish', requireAdmin, (req, res) => {
  const { latestVersion, downloadUrl, releaseNotes } = req.body;
  if (!latestVersion || !String(latestVersion).trim()) {
    return res.status(400).json({ error: 'Yeni sürüm numarası zorunludur (Örn: 1.0.1).' });
  }
  const cleanUrl = downloadUrl ? String(downloadUrl).trim() : '';
  if (cleanUrl && !/^https?:\/\//i.test(cleanUrl)) {
    return res.status(400).json({ error: 'İndirme bağlantısı http:// veya https:// ile başlamalıdır.' });
  }

  const db = loadDb();
  db.appRelease = {
    latestVersion: String(latestVersion).trim().replace(/^v/i, ''),
    downloadUrl: cleanUrl,
    releaseNotes: releaseNotes ? String(releaseNotes).trim() : '',
    publishedAt: new Date().toISOString()
  };
  saveDb(db, 'appRelease', db.appRelease);
  broadcastSyncEvent();
  res.json({ ok: true, appUpdate: buildAppUpdateInfo(db) });
});

app.get('/api/app-update/progress', (req, res) => {
  res.json(getUpdateProgress());
});

app.post('/api/app-update/apply', (req, res) => {
  const db = loadDb();
  const info = buildAppUpdateInfo(db);
  if (!info.downloadUrl) {
    return res.status(400).json({ error: 'Yayınlanmış bir güncelleme indirme linki bulunamadı.' });
  }
  if (!info.isDesktopExe) {
    return res.status(400).json({
      error: 'Otomatik kendi kendini yenileme yalnızca masaüstü .exe uygulaması içinde çalışır.'
    });
  }

  // Arka planda indirme ve yenileme sürecini başlat, istemci /api/app-update/progress ile yüzdeyi izler
  downloadAndApplyExeUpdate(info.downloadUrl).catch(() => {});
  res.json({ ok: true, started: true });
});

// Dijipin Canlı Stok Kontrol API (Topup & E-Pin + Alt Kategoriler)
app.get('/api/stock-scan', async (req, res) => {
  try {
    const force = req.query.force === '1';
    if (!force) {
      const cached = getCachedStockScan();
      if (cached) return res.json({ ok: true, data: cached });
      return res.json({ ok: true, data: null });
    }
    const result = await scanDijipinOutOfStock(true);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ error: `Stok taraması başarısız: ${err.message}` });
  }
});

function isStaffOnLeave(db, staffMember, dateStr) {
  const override = db.leaveOverrides?.[dateStr]?.[staffMember.id];
  if (override === 'leave') return true;
  if (override === 'work') return false;
  const isoDay = getIsoDayOfWeek(dateStr);
  return Array.isArray(staffMember.weeklyOffDays) && staffMember.weeklyOffDays.includes(isoDay);
}

// Tüm durum + seçili gün verisi
app.get('/api/state', (req, res) => {
  const db = loadDb();
  const date = req.query.date || getLocalTodayStr();
  const dayEntries = db.entries[date] || {};
  const dayOverrides = db.leaveOverrides[date] || {};

  const staffWithStatus = db.staff.map((s) => {
    const shiftDef = db.shifts[s.shift] || DEFAULT_SHIFTS.morning;
    return {
      ...sanitizeStaff(s),
      shiftLabel: shiftDef.label,
      shiftHours: s.customHours && s.customHours.trim() ? s.customHours.trim() : shiftDef.hours,
      isOnLeave: isStaffOnLeave(db, s, date),
      leaveOverride: dayOverrides[s.id] || null,
      entry: dayEntries[s.id] || null
    };
  });

  res.json({
    currentUser: req.user,
    syncStatus: store.getStatus(),
    appUpdate: buildAppUpdateInfo(db),
    today: getLocalTodayStr(),
    date,
    isoDay: getIsoDayOfWeek(date),
    shifts: db.shifts,
    tasks: db.tasks,
    staff: staffWithStatus
  });
});

// Haftalık takip özeti (Pazartesi - Pazar)
app.get('/api/weekly', (req, res) => {
  const db = loadDb();
  const refDate = req.query.date || getLocalTodayStr();
  const weekDays = getWeekDates(refDate);

  const staffWeekly = db.staff.map((s) => {
    const shiftDef = db.shifts[s.shift] || DEFAULT_SHIFTS.morning;
    let totalLiveCount = 0;
    let completedDays = 0;
    let leaveDays = 0;

    const days = weekDays.map((wd) => {
      const onLeave = isStaffOnLeave(db, s, wd.date);
      if (onLeave) leaveDays++;
      const entry = db.entries?.[wd.date]?.[s.id] || null;

      let liveCount = 0;
      let doneTasks = 0;
      if (!onLeave && entry && entry.values) {
        completedDays++;
        const cd = entry.values.canli_destek;
        if (cd && typeof cd === 'object' && Number(cd.count)) {
          liveCount = Number(cd.count);
          totalLiveCount += liveCount;
        }
        db.tasks.forEach((t) => {
          const v = entry.values[t.id];
          if (t.type === 'count_bakildi') {
            if (v && (v.status === 'Bakıldı' || Number(v.count) > 0)) doneTasks++;
          } else if (t.type === 'yapildi_not') {
            if ((v && typeof v === 'object' && v.status === 'Yapıldı') || v === 'Yapıldı') doneTasks++;
          } else if (v === 'Bakıldı' || v === 'Yapıldı' || (t.type === 'text' && v)) {
            doneTasks++;
          }
        });
      }

      return {
        isoDay: wd.isoDay,
        date: wd.date,
        isOnLeave: onLeave,
        hasEntry: Boolean(entry),
        liveCount,
        doneTasks,
        totalTasks: db.tasks.length,
        lateArrival: Boolean(entry?.attendance?.lateArrival),
        lateExit: Boolean(entry?.attendance?.lateExit)
      };
    });

    return {
      ...sanitizeStaff(s),
      shiftLabel: shiftDef.label,
      shiftHours: s.customHours && s.customHours.trim() ? s.customHours.trim() : shiftDef.hours,
      days,
      summary: {
        totalLiveCount,
        completedDays,
        leaveDays
      }
    };
  });

  res.json({
    refDate,
    weekDays,
    tasks: db.tasks,
    staff: staffWeekly
  });
});

// Tarih aralığı kümülatif toplam raporu
app.get('/api/range', (req, res) => {
  const db = loadDb();
  const today = getLocalTodayStr();
  const start = req.query.start || today;
  const end = req.query.end || today;
  const dateList = getDatesBetween(start, end);

  let grandLiveTotal = 0;
  let grandWorkingDays = 0;
  let grandReportedDays = 0;
  let grandLeaveDays = 0;
  let grandLateArrivals = 0;
  let grandLateExits = 0;

  const grandTaskTotals = {};
  db.tasks.forEach((t) => {
    grandTaskTotals[t.id] = { count: 0, doneDays: 0, missedDays: 0 };
  });

  const staffTotals = db.staff.map((s) => {
    const shiftDef = db.shifts[s.shift] || DEFAULT_SHIFTS.morning;
    let workingDays = 0;
    let leaveDays = 0;
    let reportedDays = 0;
    let lateArrivalCount = 0;
    let lateExitCount = 0;

    const taskStats = {};
    db.tasks.forEach((t) => {
      taskStats[t.id] = { count: 0, doneDays: 0, missedDays: 0 };
    });

    dateList.forEach((dStr) => {
      const onLeave = isStaffOnLeave(db, s, dStr);
      if (onLeave) {
        leaveDays++;
        grandLeaveDays++;
        return;
      }

      workingDays++;
      grandWorkingDays++;

      const entry = db.entries?.[dStr]?.[s.id];
      if (!entry || !entry.values) return;
      reportedDays++;
      grandReportedDays++;

      if (entry.attendance?.lateArrival) {
        lateArrivalCount++;
        grandLateArrivals++;
      }
      if (entry.attendance?.lateExit) {
        lateExitCount++;
        grandLateExits++;
      }

      db.tasks.forEach((t) => {
        const val = entry.values[t.id];
        if (t.type === 'count_bakildi') {
          const cnt = val && typeof val === 'object' ? Number(val.count) || 0 : Number(val) || 0;
          const st = val && typeof val === 'object' ? val.status : '';
          taskStats[t.id].count += cnt;
          grandTaskTotals[t.id].count += cnt;
          if (t.id === 'canli_destek') grandLiveTotal += cnt;

          if (st === 'Bakıldı' || cnt > 0) {
            taskStats[t.id].doneDays++;
            grandTaskTotals[t.id].doneDays++;
          } else if (st === 'Bakılmadı') {
            taskStats[t.id].missedDays++;
            grandTaskTotals[t.id].missedDays++;
          }
        } else if (t.type === 'yapildi_not') {
          const st = val && typeof val === 'object' ? val.status : val;
          if (st === 'Yapıldı') {
            taskStats[t.id].doneDays++;
            grandTaskTotals[t.id].doneDays++;
          } else if (st === 'Yapılmadı') {
            taskStats[t.id].missedDays++;
            grandTaskTotals[t.id].missedDays++;
          }
        } else if (val === 'Bakıldı' || val === 'Yapıldı' || (t.type === 'text' && val && String(val).trim())) {
          taskStats[t.id].doneDays++;
          grandTaskTotals[t.id].doneDays++;
        } else if (val === 'Bakılmadı' || val === 'Yapılmadı') {
          taskStats[t.id].missedDays++;
          grandTaskTotals[t.id].missedDays++;
        }
      });
    });

    return {
      ...sanitizeStaff(s),
      shiftLabel: shiftDef.label,
      shiftHours: s.customHours && s.customHours.trim() ? s.customHours.trim() : shiftDef.hours,
      workingDays,
      leaveDays,
      reportedDays,
      lateArrivalCount,
      lateExitCount,
      taskStats
    };
  });

  res.json({
    startDate: dateList[0] || start,
    endDate: dateList[dateList.length - 1] || end,
    dayCount: dateList.length,
    tasks: db.tasks,
    grandSummary: {
      grandLiveTotal,
      grandWorkingDays,
      grandReportedDays,
      grandLeaveDays,
      grandLateArrivals,
      grandLateExits,
      grandTaskTotals
    },
    staff: staffTotals
  });
});

function isEmailTaken(db, email, excludeId = null) {
  const norm = String(email).trim().toLowerCase();
  const inAdmins = db.admins.some((a) => a.id !== excludeId && a.email.toLowerCase() === norm);
  const inStaff = db.staff.some((s) => s.id !== excludeId && s.email && s.email.toLowerCase() === norm);
  return inAdmins || inStaff;
}

function normalizeTaskValues(db, values) {
  const normalized = { ...values };
  db.tasks.forEach((t) => {
    if (t.type === 'count_bakildi' && normalized[t.id] && typeof normalized[t.id] === 'object') {
      const cnt = Number(normalized[t.id].count) || 0;
      let st = normalized[t.id].status || 'Bekliyor';
      if (cnt > 0 && st === 'Bekliyor') st = 'Bakıldı';
      normalized[t.id] = { count: cnt, status: st };
    } else if (t.type === 'yapildi_not') {
      const raw = normalized[t.id];
      const st = raw && typeof raw === 'object' ? raw.status || 'Bekliyor' : String(raw || 'Bekliyor');
      const note = raw && typeof raw === 'object' && st === 'Yapıldı' ? String(raw.note || '').trim() : '';
      normalized[t.id] = { status: st, note };
    }
  });
  return normalized;
}

function validateExtraTaskNotes(db, values) {
  for (const t of db.tasks) {
    if (t.type === 'yapildi_not') {
      const raw = values[t.id];
      const st = raw && typeof raw === 'object' ? raw.status : raw;
      const note = raw && typeof raw === 'object' ? String(raw.note || '').trim() : '';
      if (st === 'Yapıldı' && !note) {
        return `"${t.title}" için Yapıldı seçildiğinde yapılan işin açıklaması (notu) yazılmalıdır.`;
      }
    }
  }
  return null;
}

// Yetkili: Personel ekle (isim, e-posta, şifre, rol ve vardiya ile)
app.post('/api/staff', requireAdmin, (req, res) => {
  const { name, email, password, role, shift, customHours, weeklyOffDays } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Personel adı zorunludur.' });
  }
  if (!email || !email.trim() || !email.includes('@')) {
    return res.status(400).json({ error: 'Geçerli bir e-posta adresi zorunludur.' });
  }
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: 'Şifre en az 4 karakter olmalıdır.' });
  }

  const db = loadDb();
  if (isEmailTaken(db, email)) {
    return res.status(409).json({ error: 'Bu e-posta adresi zaten kayıtlı.' });
  }

  const newStaff = {
    id: 'st_' + Date.now(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    passwordHash: hashPassword(password),
    role: role === 'admin' ? 'admin' : 'staff',
    shift: db.shifts[shift] ? shift : 'morning',
    customHours: customHours ? customHours.trim() : '',
    weeklyOffDays: Array.isArray(weeklyOffDays) ? weeklyOffDays.map(Number) : []
  };
  db.staff.push(newStaff);
  saveDb(db, 'staff', db.staff);
  res.json({ ok: true, staff: sanitizeStaff(newStaff) });
});

// Yetkili: Personel güncelle (isim, e-posta, şifre, rol, vardiya, özel saat)
app.put('/api/staff/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, email, password, role, shift, customHours, weeklyOffDays } = req.body;
  const db = loadDb();
  const idx = db.staff.findIndex((s) => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Personel bulunamadı.' });

  if (email !== undefined && email.trim()) {
    if (isEmailTaken(db, email, id)) {
      return res.status(409).json({ error: 'Bu e-posta adresi başka bir kullanıcıda kayıtlı.' });
    }
    db.staff[idx].email = email.trim().toLowerCase();
  }
  if (name !== undefined && name.trim()) db.staff[idx].name = name.trim();
  if (password !== undefined && String(password).trim()) {
    if (String(password).trim().length < 4) {
      return res.status(400).json({ error: 'Yeni şifre en az 4 karakter olmalıdır.' });
    }
    db.staff[idx].passwordHash = hashPassword(String(password).trim());
  }
  if (role !== undefined) db.staff[idx].role = role === 'admin' ? 'admin' : 'staff';
  if (shift !== undefined && db.shifts[shift]) db.staff[idx].shift = shift;
  if (customHours !== undefined) db.staff[idx].customHours = String(customHours).trim();
  if (Array.isArray(weeklyOffDays)) db.staff[idx].weeklyOffDays = weeklyOffDays.map(Number);

  saveDb(db, 'staff', db.staff);
  res.json({ ok: true, staff: sanitizeStaff(db.staff[idx]) });
});

// Yetkili: Personel detaylı profil, istatistik ve gün gün geçmiş verisi
app.get('/api/staff/:id/profile', requireAdmin, (req, res) => {
  const { id } = req.params;
  const db = loadDb();
  const person = db.staff.find((s) => s.id === id);
  if (!person) return res.status(404).json({ error: 'Personel bulunamadı.' });

  const shiftDef = db.shifts[person.shift] || DEFAULT_SHIFTS.morning;
  const shiftHours = person.customHours && person.customHours.trim() ? person.customHours.trim() : shiftDef.hours;

  const today = getLocalTodayStr();
  let defaultStartDt = new Date();
  defaultStartDt.setDate(defaultStartDt.getDate() - 13);
  const start = req.query.start || formatDateLocal(defaultStartDt);
  const end = req.query.end || today;
  const dateListAsc = getDatesBetween(start, end);
  const dateListDesc = [...dateListAsc].reverse();

  // Tüm zamanlar istatistiği
  let allTimeReports = 0;
  let allTimeLiveCount = 0;
  let bestLiveDay = { count: 0, date: '' };
  let allTimeLateArrivals = 0;
  let allTimeLateExits = 0;
  let allTimeExtraDone = 0;

  Object.keys(db.entries || {}).forEach((dStr) => {
    const ent = db.entries[dStr]?.[id];
    if (!ent || !ent.values) return;
    allTimeReports++;
    if (ent.attendance?.lateArrival) allTimeLateArrivals++;
    if (ent.attendance?.lateExit) allTimeLateExits++;

    const cd = ent.values.canli_destek;
    const cnt = cd && typeof cd === 'object' ? Number(cd.count) || 0 : Number(cd) || 0;
    allTimeLiveCount += cnt;
    if (cnt > bestLiveDay.count) {
      bestLiveDay = { count: cnt, date: dStr };
    }

    const ex = ent.values.ekstra_gorev;
    if ((ex && typeof ex === 'object' && ex.status === 'Yapıldı') || ex === 'Yapıldı') {
      allTimeExtraDone++;
    }
  });

  // Seçili dönem istatistik ve gün gün satırlar
  let periodWorkingDays = 0;
  let periodLeaveDays = 0;
  let periodReportedDays = 0;
  let periodLiveTotal = 0;
  let periodLateArrivals = 0;
  let periodLateExits = 0;

  const taskBreakdown = db.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
    unit: t.unit || '',
    totalCount: 0,
    doneDays: 0,
    missedDays: 0
  }));
  const tbMap = {};
  taskBreakdown.forEach((tb) => {
    tbMap[tb.id] = tb;
  });

  const dailyLogs = dateListDesc.map((dStr) => {
    const onLeave = isStaffOnLeave(db, person, dStr);
    const entry = db.entries?.[dStr]?.[id] || null;

    if (onLeave) {
      periodLeaveDays++;
    } else {
      periodWorkingDays++;
      if (entry && entry.values) {
        periodReportedDays++;
        if (entry.attendance?.lateArrival) periodLateArrivals++;
        if (entry.attendance?.lateExit) periodLateExits++;

        db.tasks.forEach((t) => {
          const val = entry.values[t.id];
          const tb = tbMap[t.id];
          if (t.type === 'count_bakildi') {
            const cnt = val && typeof val === 'object' ? Number(val.count) || 0 : Number(val) || 0;
            const st = val && typeof val === 'object' ? val.status : '';
            tb.totalCount += cnt;
            if (t.id === 'canli_destek') periodLiveTotal += cnt;
            if (st === 'Bakıldı' || cnt > 0) tb.doneDays++;
            else if (st === 'Bakılmadı') tb.missedDays++;
          } else if (t.type === 'yapildi_not') {
            const st = val && typeof val === 'object' ? val.status : val;
            if (st === 'Yapıldı') tb.doneDays++;
            else if (st === 'Yapılmadı') tb.missedDays++;
          } else if (val === 'Bakıldı' || val === 'Yapıldı' || (t.type === 'text' && val && String(val).trim())) {
            tb.doneDays++;
          } else if (val === 'Bakılmadı' || val === 'Yapılmadı') {
            tb.missedDays++;
          }
        });
      }
    }

    return {
      date: dStr,
      isoDay: getIsoDayOfWeek(dStr),
      isOnLeave: onLeave,
      entry
    };
  });

  res.json({
    person: {
      ...sanitizeStaff(person),
      shiftLabel: shiftDef.label,
      shiftHours
    },
    startDate: dateListAsc[0] || start,
    endDate: dateListAsc[dateListAsc.length - 1] || end,
    dayCount: dateListAsc.length,
    tasks: db.tasks,
    allTime: {
      totalReports: allTimeReports,
      totalLiveCount: allTimeLiveCount,
      avgLivePerReport: allTimeReports > 0 ? Math.round(allTimeLiveCount / allTimeReports) : 0,
      bestLiveDay,
      totalLateArrivals: allTimeLateArrivals,
      totalLateExits: allTimeLateExits,
      totalExtraDone: allTimeExtraDone
    },
    period: {
      workingDays: periodWorkingDays,
      leaveDays: periodLeaveDays,
      reportedDays: periodReportedDays,
      liveTotal: periodLiveTotal,
      avgLive: periodReportedDays > 0 ? Math.round(periodLiveTotal / periodReportedDays) : 0,
      lateArrivals: periodLateArrivals,
      lateExits: periodLateExits,
      taskBreakdown
    },
    dailyLogs
  });
});

// Yetkili: Personel sil
app.delete('/api/staff/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const db = loadDb();
  db.staff = db.staff.filter((s) => s.id !== id);
  saveDb(db, 'staff', db.staff);
  res.json({ ok: true });
});

// Yetkili: Yeni iş kolu / görev sütunu ekle
app.post('/api/tasks', requireAdmin, (req, res) => {
  const { title, type, unit } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Görev başlığı zorunludur.' });
  }
  const validTypes = ['count_bakildi', 'bakildi', 'yapildi', 'yapildi_not', 'text'];
  const db = loadDb();
  const newTask = {
    id: 'tsk_' + Date.now(),
    title: title.trim(),
    type: validTypes.includes(type) ? type : 'yapildi',
    unit: unit && unit.trim() ? unit.trim() : 'Adet Bakıldı'
  };
  db.tasks.push(newTask);
  saveDb(db, 'tasks', db.tasks);
  res.json({ ok: true, task: newTask });
});

// Yetkili: İş kolu sil
app.delete('/api/tasks/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const db = loadDb();
  db.tasks = db.tasks.filter((t) => t.id !== id);
  saveDb(db, 'tasks', db.tasks);
  res.json({ ok: true });
});

function normalizeAttendance(att) {
  if (!att || typeof att !== 'object') {
    return {
      lateArrival: false,
      lateArrivalNote: '',
      lateExit: false,
      lateExitNote: ''
    };
  }
  return {
    lateArrival: Boolean(att.lateArrival),
    lateArrivalNote: att.lateArrival && att.lateArrivalNote ? String(att.lateArrivalNote).trim() : '',
    lateExit: Boolean(att.lateExit),
    lateExitNote: att.lateExit && att.lateExitNote ? String(att.lateExitNote).trim() : ''
  };
}

// Günlük İLK veri girişi oluştur (aynı gün ikinci kez yeni kayıt oluşturulamaz!)
app.post('/api/entries', (req, res) => {
  const { date, staffId, values, attendance, note } = req.body;
  if (!date || !staffId || typeof values !== 'object') {
    return res.status(400).json({ error: 'Eksik veri gönderildi.' });
  }

  const today = getLocalTodayStr();
  if (req.user.role !== 'admin') {
    if (staffId !== req.user.id) {
      return res.status(403).json({ error: 'Yalnızca kendi adınıza veri girişi yapabilirsiniz.' });
    }
    if (date !== today) {
      return res.status(403).json({ error: 'Personel yalnızca bugünün verisini girebilir.' });
    }
  }

  const db = loadDb();
  const noteErr = validateExtraTaskNotes(db, values);
  if (noteErr) {
    return res.status(400).json({ error: noteErr });
  }
  if (!db.entries[date]) db.entries[date] = {};

  if (db.entries[date][staffId]) {
    return res.status(409).json({
      error: 'Bu gün için zaten veri girişi yaptınız. Tekrar yeni giriş yapılamaz; mevcut kaydı düzenleyebilirsiniz.'
    });
  }

  const nowIso = new Date().toISOString();
  db.entries[date][staffId] = {
    values: normalizeTaskValues(db, values),
    attendance: normalizeAttendance(attendance),
    note: note ? String(note).trim() : '',
    createdAt: nowIso,
    updatedAt: nowIso
  };
  saveDb(db, `entries/${date}/${staffId}`, db.entries[date][staffId]);
  res.json({ ok: true, entry: db.entries[date][staffId] });
});

// Mevcut günlük veri girişini DÜZENLE (güncelle)
app.put('/api/entries', (req, res) => {
  const { date, staffId, values, attendance, note } = req.body;
  if (!date || !staffId || typeof values !== 'object') {
    return res.status(400).json({ error: 'Eksik veri gönderildi.' });
  }

  const today = getLocalTodayStr();
  if (req.user.role !== 'admin') {
    if (staffId !== req.user.id) {
      return res.status(403).json({ error: 'Yalnızca kendi raporunuzu düzenleyebilirsiniz.' });
    }
    if (date !== today) {
      return res.status(403).json({ error: 'Personel yalnızca bugünün raporunu düzenleyebilir.' });
    }
  }

  const db = loadDb();
  const existing = db.entries?.[date]?.[staffId];
  if (!existing) {
    return res.status(404).json({ error: 'Düzenlenecek kayıt bulunamadı, önce günlük giriş oluşturun.' });
  }
  const noteErr = validateExtraTaskNotes(db, values);
  if (noteErr) {
    return res.status(400).json({ error: noteErr });
  }

  db.entries[date][staffId] = {
    ...existing,
    values: normalizeTaskValues(db, values),
    attendance: attendance !== undefined ? normalizeAttendance(attendance) : normalizeAttendance(existing.attendance),
    note: note ? String(note).trim() : '',
    updatedAt: new Date().toISOString()
  };
  saveDb(db, `entries/${date}/${staffId}`, db.entries[date][staffId]);
  res.json({ ok: true, entry: db.entries[date][staffId] });
});

// Haftalık izin günü toggle (Yetkili)
app.post('/api/leaves/weekly', requireAdmin, (req, res) => {
  const { staffId, isoDay } = req.body;
  const dayNum = Number(isoDay);
  if (!staffId || dayNum < 1 || dayNum > 7) {
    return res.status(400).json({ error: 'Geçersiz parametre.' });
  }
  const db = loadDb();
  const person = db.staff.find((s) => s.id === staffId);
  if (!person) return res.status(404).json({ error: 'Personel bulunamadı.' });

  if (!Array.isArray(person.weeklyOffDays)) person.weeklyOffDays = [];
  if (person.weeklyOffDays.includes(dayNum)) {
    person.weeklyOffDays = person.weeklyOffDays.filter((d) => d !== dayNum);
  } else {
    person.weeklyOffDays.push(dayNum);
  }
  saveDb(db, 'staff', db.staff);
  res.json({ ok: true, weeklyOffDays: person.weeklyOffDays });
});

// Günlük özel izin istisnası (Yetkili)
app.post('/api/leaves/override', requireAdmin, (req, res) => {
  const { date, staffId, mode } = req.body;
  if (!date || !staffId) {
    return res.status(400).json({ error: 'Tarih ve personel zorunludur.' });
  }
  const db = loadDb();
  if (!db.leaveOverrides[date]) db.leaveOverrides[date] = {};
  const nextVal = mode === 'clear' || !mode ? null : mode;
  if (nextVal === null) {
    delete db.leaveOverrides[date][staffId];
  } else {
    db.leaveOverrides[date][staffId] = nextVal;
  }
  saveDb(db, `leaveOverrides/${date}/${staffId}`, nextVal);
  res.json({ ok: true });
});

async function startServer(listenPort = PORT, host = '0.0.0.0') {
  await store.init();
  return new Promise((resolve, reject) => {
    const srv = app.listen(listenPort, host, () => {
      const actualPort = srv.address().port;
      console.log(`Operasyon İş Takip Sistemi çalışıyor: http://localhost:${actualPort}`);
      resolve({ server: srv, port: actualPort, store });
    });
    srv.on('error', reject);
  });
}

if (require.main === module) {
  startServer(PORT);
}

module.exports = { startServer };
